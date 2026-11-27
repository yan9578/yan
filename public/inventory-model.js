import {M} from './dre-model.js';

export const purchaseName='Compra de mercadorias para revenda';
export const adjustmentTypes=Object.freeze({
 freight:{label:'Frete de aquisição',sign:1},
 returns:{label:'Devolução a fornecedor',sign:-1},
 tax:{label:'Tributo recuperável',sign:-1},
 increase:{label:'Outro acréscimo ao custo de aquisição',sign:1},
 decrease:{label:'Outra redução do custo de aquisição',sign:-1},
 loss:{label:'Perda já refletida no estoque final',sign:0}
});
const blank=()=>({closings:[],adjustments:[],reviews:[]});
export const inventoryBook=state=>state.inventory||blank();

function fingerprint(row) {
 return {company:row.company,id:row.id,date:row.date,amount:row.amount,category:row.category};
}
export function legacyDecision(state,source,row) {
 const {company,id,date,amount,category}=fingerprint(row);
 return inventoryBook(state).reviews.find(r=>r.source===source&&r.company===company&&r.id===id&&
  r.date===date&&r.amount===amount&&r.category===category)?.decision;
}
export function legacyItems(state,book,company,month) {
 const entries=book.entries.filter(e=>e.category==='cost'||e.category==='inventory')
  .map(row=>({source:'dre',row}));
 const operations=state.operations.filter(o=>o.category==='cost'&&!o.cancelled)
  .map(row=>({source:'operation',row}));
 return [...entries,...operations].filter(({row})=>row.company===company&&row.date.slice(0,7)===month)
  .map(item=>({...item,decision:legacyDecision(state,item.source,item.row)}));
}
export function inventorySummary(state,book,company,month) {
 const {closings,adjustments}=inventoryBook(state);
 const closing=closings.find(c=>c.company===company&&c.month===month);
 const prior=closings.find(c=>c.company===company&&c.month===M.shift(month,-1));
 const carried=prior?.ending!=null;
 const opening=carried?prior.ending:closing?.opening??null;
 const ending=closing?.ending??null;
 const history=legacyItems(state,book,company,month);
 const acquisitions=state.operations.filter(o=>!o.cancelled&&o.company===company&&o.date.slice(0,7)===month&&o.category==='inventory');
 const purchases=acquisitions.reduce((sum,o)=>sum+o.amount,0)+
  history.reduce((sum,item)=>sum+(item.decision==='purchase'?item.row.amount:0),0);
 const entries=adjustments.filter(a=>a.company===company&&a.month===month);
 const net=purchases+entries.reduce((sum,a)=>sum+a.amount*adjustmentTypes[a.kind].sign,0);
 const losses=entries.reduce((sum,a)=>sum+(a.kind==='loss'?a.amount:0),0);
 const calculated=opening===null||ending===null?null:opening+net-ending;
 const issues=[];
 if(opening===null)issues.push('Informe o estoque inicial pelo custo.');
 if(ending===null)issues.push('Informe o estoque final pelo custo.');
 if(history.some(item=>!item.decision))issues.push('Revise os lançamentos históricos antes de concluir o mês.');
 const inconsistent=calculated!==null&&(calculated<0||losses>calculated||!Number.isSafeInteger(calculated)||calculated>1e12);
 if(calculated!==null&&calculated<0)issues.push('O estoque final supera o estoque disponível. Confira os valores e os ajustes.');
 if(calculated!==null&&calculated>=0&&losses>calculated)issues.push('As perdas informadas superam a redução de estoque apurada.');
 if(calculated!==null&&(!Number.isSafeInteger(calculated)||calculated>1e12))issues.push('O CMV calculado ultrapassa o limite de valores.');
 return {closing,carried,opening,ending,purchases,net,losses,entries,history,acquisitions,
  calculated,inconsistent,issues,cmv:issues.length?null:calculated};
}

export function projectInventoryReport(state,book,linked) {
 const entries=book.entries.map(row=>{
  if(row.category!=='cost'&&row.category!=='inventory')return row;
  const decision=legacyDecision(state,'dre',row);
  return {...row,category:decision==='service'?'serviceCost':decision==='purchase'?'inventory':'legacyStock',
   reviewManaged:true,reviewPending:!decision};
 });
 const generated=inventoryBook(state).closings.flatMap(({company,month})=>{
  if(!book.companies.some(c=>c.id===company))return [];
  const {cmv}=inventorySummary(state,book,company,month);
  return cmv>0?[{id:'cmv:'+company+':'+month,company,date:month+'-01',description:'CMV apurado no fechamento mensal',
   category:'monthlyCmv',amount:cmv,cmvGenerated:true}]:[];
 });
 return {...book,inventoryReporting:true,entries:[...entries,...linked,...generated]};
}

export function pendingClosures(state,book,company,month,yearToDate) {
 const companies=company==='all'?book.companies.map(c=>c.id):[company];
 return companies.flatMap(id=>{
  const oldest=[...book.entries,...state.operations.filter(o=>!o.cancelled)].filter(e=>e.company===id&&e.date.slice(0,7)<=month)
   .map(e=>e.date.slice(0,7)).sort()[0];
  const closed=inventoryBook(state).closings.filter(c=>c.company===id&&c.month<=month).map(c=>c.month).sort()[0];
  const first=[oldest,closed,month].filter(Boolean).sort()[0];
  const from=yearToDate?[month.slice(0,4)+'-01',first].sort().at(-1):month;
  const pending=[];
  for(let cursor=from;cursor<=month;cursor=M.shift(cursor,1)){
   if(inventorySummary(state,book,id,cursor).cmv===null)pending.push({company:id,month:cursor});
  }
  return pending;
 });
}

function requireValue(condition,message) { if(!condition)throw Error(message); }
function currency(value,optional=false) {
 if(optional&&value===null)return null;
 requireValue(Number.isSafeInteger(value)&&value>=(optional?0:1)&&value<=1e12,'Informe um valor válido em reais.');
 return value;
}
export function changeInventory(state,command,{entries,companies,today,now}) {
 const {company,month,id,action}=command;
 requireValue(M.monthValid(month)&&month<=today.slice(0,7),'Selecione uma competência até o mês atual.');
 const inventory=state.inventory??=blank();
 const book={companies,entries};
 let details={month};
 if(action==='save-cmv'){
  const prior=inventory.closings.find(c=>c.company===company&&c.month===M.shift(month,-1));
  const updated={company,month,opening:prior?.ending!=null?null:currency(command.opening,true),
   ending:currency(command.ending,true),savedAt:now};
  const index=inventory.closings.findIndex(c=>c.company===company&&c.month===month);
  if(index<0)inventory.closings.push(updated);
  else {details={month,before:inventory.closings[index]};inventory.closings[index]=updated;}
  const result=inventorySummary(state,book,company,month);
  requireValue(!result.inconsistent,result.issues.find(i=>i.includes('supera')||i.includes('limite')));
 }
 if(action==='save-stock-adjustment'){
  requireValue(typeof id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(id),'Identificador inválido.');
  requireValue(Object.hasOwn(adjustmentTypes,command.kind),'Selecione o tipo de ajuste.');
  const description=typeof command.description==='string'?command.description.trim():'';
  requireValue(description.length>0&&description.length<=120,'Informe uma referência de até 120 caracteres.');
  const index=inventory.adjustments.findIndex(a=>a.id===id);
  requireValue(index<0||inventory.adjustments[index].company===company&&inventory.adjustments[index].month===month,'Ajuste indisponível.');
  requireValue(!inventory.adjustments.some(a=>a.id!==id&&a.company===company&&a.month===month&&a.kind===command.kind&&
   a.description.toLocaleLowerCase('pt-BR')===description.toLocaleLowerCase('pt-BR')),'Já existe um ajuste com este tipo e referência no mês.');
  const adjusted={id,company,month,kind:command.kind,description,amount:currency(command.amount)};
  if(index<0)inventory.adjustments.push(adjusted);
  else {details={month,before:inventory.adjustments[index]};inventory.adjustments[index]=adjusted;}
 }
 if(action==='delete-stock-adjustment'){
  const index=inventory.adjustments.findIndex(a=>a.company===company&&a.month===month&&a.id===id);
  requireValue(index>=0,'Ajuste indisponível.');
  details={month,before:inventory.adjustments.splice(index,1)[0]};
 }
 if(action==='review-stock-legacy'){
  const item=legacyItems(state,book,company,month).find(item=>item.source===command.source&&item.row.id===id);
  requireValue(item,'Lançamento histórico indisponível. Atualize a DRE.');
  requireValue(command.sourceDate===item.row.date&&command.sourceAmount===item.row.amount&&command.sourceCategory===item.row.category,
   'O lançamento histórico mudou. Reabra a DRE antes de confirmar a revisão.');
  const allowed=item.row.category==='cost'?['purchase','service','covered','undo']:['purchase','covered','undo'];
  requireValue(allowed.includes(command.decision),'Selecione um tratamento para o lançamento.');
  const old=inventory.reviews.find(r=>r.company===company&&r.id===id&&r.source===item.source);
  inventory.reviews=inventory.reviews.filter(r=>!(r.company===company&&r.id===id&&r.source===item.source));
  if(command.decision!=='undo')inventory.reviews.push({source:item.source,decision:command.decision,...fingerprint(item.row)});
  details={month,source:item.source,decision:command.decision,before:old};
 }
 return details;
}
