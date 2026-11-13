import {api} from './api.js';
import {M} from './dre-model.js';
import {companyScopes,companyRecords,recordCompany,withCompany} from './cash-model.js';
const $=id=>document.getElementById(id);
const option=(value,label)=>{const o=document.createElement('option');o.value=JSON.stringify(value);o.textContent=label;return o;};

export function createCashCompanies({getRecords,persist,render,toast,isSaving}){
 let dreDocument=M.empty(),revision=0,selected=null,identity=null,ready=false,busy=false,editing=null,base=null;
 const scopes=()=>companyScopes(dreDocument.companies,getRecords());
 const current=()=>scopes().find(c=>c.id===selected);
 const preference=()=>identity?'cc-cash-company:'+identity:null;
 function remember(){try{if(preference())localStorage.setItem(preference(),JSON.stringify(selected));}catch{}}
 function choose(id){selected=id;remember();render();}
 function accept(saved){M.validate(saved.document);dreDocument=structuredClone(saved.document);revision=saved.revision;ready=true;}
 function refreshDreView(){const frame=$('dre-frame');if(frame.contentWindow)frame.contentWindow.dreNeedsReload=true;}
 async function load(userId){
  accept(await api('dre'));identity=userId;
  try{const value=localStorage.getItem(preference());selected=value===null?null:JSON.parse(value);}catch{selected=null;}
  const list=scopes();if(!list.some(c=>c.id===selected))selected=list[0]?.id??null;
 }
 function paint(){
  const list=scopes();if(!list.some(c=>c.id===selected))selected=list[0]?.id??null;
  $('cash-company').replaceChildren(...list.map(c=>option(c.id,c.name+(c.archived?' · cadastro removido':''))));
  if(!list.length)$('cash-company').append(option(null,'Cadastre uma empresa para começar'));
  $('cash-company').value=JSON.stringify(selected);$('cash-company').disabled=!list.length||busy||isSaving();
  const c=current();$('cash-company-name').textContent=c?.name||'Nenhuma empresa selecionada';
  $('cash-company-status').textContent=c?.legacy?'Seus lançamentos anteriores foram preservados. Vincule-os à empresa correta abaixo.':c?.archived?'O cadastro foi removido da DRE. O histórico deste caixa continua preservado.':c?'Exibindo somente o caixa de '+c.name+'. O cadastro da empresa é compartilhado com a DRE.':'Cadastre uma empresa ou use uma empresa já cadastrada na DRE.';
  $('cash-company-edit').disabled=!c||c.legacy||c.archived||busy||isSaving();
  $('cash-company-new').disabled=!ready||busy||isSaving();$('cash-company-refresh').disabled=busy||isSaving();
  $('new').disabled=!c||c.legacy||c.archived||busy||isSaving();$('demo').disabled=$('new').disabled;
  $('cash-legacy').hidden=!c?.legacy;
  const target=$('cash-legacy-target'),old=target.value;target.replaceChildren(...dreDocument.companies.map(c=>option(c.id,c.name)));if([...target.options].some(o=>o.value===old))target.value=old;
  $('cash-legacy-assign').disabled=!dreDocument.companies.length||busy||isSaving();
 }
 function fillRecord(record){
  const choices=[...dreDocument.companies];
  if(record&&!choices.some(c=>c.id===recordCompany(record)))choices.unshift(scopes().find(c=>c.id===recordCompany(record)));
  $('record-company').replaceChildren(...choices.filter(Boolean).map(c=>option(c.id,c.name)));
  $('record-company').value=JSON.stringify(record?recordCompany(record):selected);
 }
 function attach(record,value){const id=JSON.parse(value),c=scopes().find(c=>c.id===id);if(!c)throw Error('Selecione uma empresa válida.');return withCompany(record,c);}
 function open(edit){
  if(isSaving()||busy)return toast('Aguarde o salvamento em andamento.');
  editing=edit?current()?.id:null;base={revision,document:structuredClone(dreDocument)};
  const c=edit?current():null;$('cash-company-title').textContent=c?'Editar empresa':'Cadastrar empresa';
  $('cash-company-form').reset();$('cash-company-error').textContent='';$('cash-company-input').value=c?.name||'';$('cash-company-sector').value=c?.sector||'';
  $('cash-company-dialog').showModal();
 }
 $('cash-company').onchange=()=>{if(isSaving()||busy){paint();return toast('Aguarde o salvamento antes de trocar de empresa.');}choose(JSON.parse($('cash-company').value));};
 $('cash-company-new').onclick=()=>open(false);$('cash-company-edit').onclick=()=>open(true);
 $('cash-company-close').onclick=()=>$('cash-company-dialog').close();
 $('cash-company-refresh').onclick=async()=>{if(isSaving()||busy)return;busy=true;paint();try{accept(await api('dre'));refreshDreView();render();toast('Cadastro de empresas atualizado.');}catch(e){toast(e.message);}finally{busy=false;paint();}};
 $('cash-company-form').onsubmit=async e=>{
  e.preventDefault();if(busy||isSaving())return;busy=true;paint();$('cash-company-error').textContent='';
  const form=e.target;for(const input of form.elements)input.disabled=true;
  try{
   const c={id:editing??M.uid(),name:$('cash-company-input').value.trim(),sector:$('cash-company-sector').value.trim()};
   if(base.document.companies.some(x=>x.id!==c.id&&x.name.trim().toLocaleLowerCase('pt-BR')===c.name.toLocaleLowerCase('pt-BR')))throw Error('Essa empresa já está cadastrada. Selecione-a na lista.');
   const next=structuredClone(base.document),index=next.companies.findIndex(x=>x.id===c.id);
   if(editing!==null&&index<0)throw Error('A empresa foi removida em outra janela. Atualize o cadastro.');
   if(index<0)next.companies.push(c);else next.companies[index]=c;M.validate(next);
   const result=await api('dre','PUT',{revision:base.revision,document:next});accept({revision:result.revision,document:next});
   refreshDreView();
   selected=c.id;remember();$('cash-company-dialog').close();render();toast('Empresa salva no cadastro compartilhado com a DRE.');
  }catch(error){
   if(error.status===409){try{accept(await api('dre'));base={revision,document:structuredClone(dreDocument)};render();}catch{ready=false;}}
   $('cash-company-error').textContent=error.message;
  }finally{busy=false;for(const input of form.elements)input.disabled=false;paint();}
 };
 $('cash-legacy-assign').onclick=async()=>{
  if(isSaving()||busy||selected!=='')return;
  const id=JSON.parse($('cash-legacy-target').value),c=dreDocument.companies.find(c=>c.id===id),rows=companyRecords(getRecords(),'');
  if(!c||!rows.length)return;
  if(!confirm('Vincular os '+rows.length+' lançamentos sem empresa a “'+c.name+'”? Confira se todos pertencem a esta empresa.'))return;
  if(await persist(getRecords().map(r=>recordCompany(r)?r:withCompany(r,c)))){choose(id);toast('Lançamentos vinculados à empresa selecionada.');}
 };
 return {load,paint,fillRecord,attach,current,select:choose,records:()=>companyRecords(getRecords(),selected),get busy(){return busy;},
  acceptDre(saved){accept(saved);render();}};
}
