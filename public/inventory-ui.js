import {cents} from './finance.js';
import {adjustmentTypes,inventorySummary} from './inventory-model.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value===null?'—':(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const editAmount=value=>value===null?'':(value/100).toFixed(2).replace('.',',');
const date=value=>value.split('-').reverse().join('/');
const choice=(value,label)=>'<option value="'+esc(value)+'">'+esc(label)+'</option>';
const choices={
 purchase:'Reclassificar como compra para revenda',
 service:'Confirmar como custo direto de serviços',
 covered:'Excluir do cálculo · já representado no fechamento',
 undo:'Desfazer revisão'
};

export function createInventoryView({bridge,scope,rerender,toast,ask}) {
 const panel=$('inventory-view');
 const dialog=$('inventory-adjustment-dialog');
 let model,activeAdjustment,saving=false;
 function context() {
  const current=scope(),saved=bridge.getBook();
  return {...current,...saved};
 }
 async function save(action,data,base=context(),onSaved) {
  if(saving)return;
  saving=true;
  const button=dialog.open?$('inventory-adjustment-save'):$('inventory-save');
  if(button)button.disabled=true;
  try{
   await bridge.save({company:base.company,month:base.month,action,...data},base.revision);
   onSaved?.();
   rerender();
   toast('Alteração salva no fechamento.');
  }catch(error){
   if(error.status===409&&!dialog.open)rerender();
   const notice=$(dialog.open?'inventory-adjustment-error':'inventory-error');
   if(notice)notice.textContent=error.message;
  }finally{
   saving=false;
   if(button)button.disabled=false;
  }
 }
 function render() {
  if(panel.hidden)return;
  const {company,month,original,document:state}=context();
  if(company==='all'){
   panel.innerHTML='<article class="panel"><h2>Fechamento mensal do CMV</h2><p>Selecione uma empresa no filtro para informar os estoques.</p></article>';
   return;
  }
  model=inventorySummary(state,original,company,month);
  const {carried,opening,ending,purchases,net,losses,history,entries,acquisitions,cmv,calculated,issues,inconsistent}=model;
  const sourceRows=acquisitions.map(o=>'<li>'+esc(o.description)+' · '+date(o.date)+' · '+money(o.amount)+'</li>').join('');
  panel.innerHTML=
   '<article class="panel"><h2>Fechamento mensal do CMV</h2><p>Informe os estoques em reais pelo custo, com base no inventário ou ERP. O mês da aquisição define as compras, independentemente do pagamento.</p>'+
   '<form id="inventory-form"><div class="inventory-grid">'+
    '<label>Estoque inicial (R$)<input name="opening" inputmode="decimal" value="'+editAmount(opening)+'"'+(carried?' readonly':'')+' placeholder="0,00">'+
    (carried?'<small>Transportado do fechamento do mês anterior.</small>':'<small>Informe o saldo inicial se o mês anterior ainda não tiver fechamento.</small>')+'</label>'+
    '<label>Compras líquidas no mês<strong class="financial-value" id="inventory-net">'+money(net)+'</strong><small>Compras registradas: '+money(purchases)+' · ajustes: '+money(net-purchases)+'</small></label>'+
    '<label>Estoque final (R$)<input name="ending" inputmode="decimal" value="'+editAmount(ending)+'" placeholder="0,00"></label>'+
    '<div class="inventory-result"><span>'+(cmv===null?'CMV calculado · provisório':'CMV apurado')+'</span><strong class="financial-value" id="inventory-cmv">'+money(inconsistent?null:calculated)+'</strong>'+
    '<small>Estoque inicial + compras líquidas − estoque final</small></div>'+
   '</div>'+
   (issues.length?'<p class="warning" role="status">'+issues.map(esc).join(' ')+'</p>':'<p class="notes">Fechamento salvo. O CMV deste mês está incluído na DRE.</p>')+
   '<p id="inventory-error" class="inventory-error" role="alert"></p><button id="inventory-save" class="btn primary">Salvar fechamento</button></form>'+
   (sourceRows?'<details><summary>Ver aquisições registradas em Contas ('+acquisitions.length+')</summary><ul>'+sourceRows+'</ul></details>':'')+'</article>'+
   '<article class="panel"><div class="section-head"><div><h2>Ajustes de estoque</h2><p class="muted">Registre apenas valores que ainda não estão incluídos nas compras. Pagamentos e recebimentos ficam no caixa.</p></div>'+
   '<button class="btn" id="inventory-new-adjustment">＋ Ajuste</button></div>'+
   (losses?'<p class="notes">Perdas informadas: '+money(losses)+'. O valor já está refletido no estoque final e não é somado de novo.</p>':'')+
   (entries.length?'<ul class="inventory-list">'+entries.map((a,index)=>
    '<li><div><strong>'+esc(adjustmentTypes[a.kind].label)+'</strong><small>'+esc(a.description)+' · '+money(a.amount)+'</small></div>'+
    '<div class="actions"><button type="button" class="link" data-adjust-edit="'+index+'">Editar</button>'+
    '<button type="button" class="link" data-adjust-delete="'+index+'">Excluir</button></div></li>').join('')+'</ul>':
    '<p class="muted">Nenhum ajuste registrado no mês.</p>')+'</article>'+
   (history.length?'<article class="panel"><h2>Revisão de lançamentos antigos</h2>'+
    '<p class="muted">Os originais e as baixas são preservados. Se a aquisição já estiver em Contas ou o valor já fizer parte do fechamento, escolha a opção de excluir do cálculo. Uma compra antiga registrada só na DRE não gera um novo pagamento.</p>'+
    '<ul class="inventory-list">'+history.map(({source,row,decision},index)=>'<li>'+
     '<div><strong>'+esc(row.description)+'</strong><small>'+money(row.amount)+' · '+date(row.date)+' · '+(source==='dre'?'DRE avulsa':'Contas')+
     ' · '+esc(decision?choices[decision]:'Pendente de revisão')+'</small></div>'+
     '<div class="actions"><label class="inventory-review-label">Tratamento<select id="inventory-review-'+index+'">'+choice('','Selecione')+
      ['purchase',...(row.category==='cost'?['service']:[]),'covered',...(decision?['undo']:[])].map(value=>choice(value,choices[value])).join('')+
     '</select></label><button type="button" class="btn" data-stock-review="'+index+'">Aplicar</button></div></li>').join('')+'</ul></article>':'');
  $('inventory-form').onsubmit=event=>{
   event.preventDefault();
   const form=event.currentTarget;
   const parse=value=>value.trim()===''?null:cents(value,{signed:true});
   try{
    const initial=carried?null:parse(form.elements.opening.value);
    const final=parse(form.elements.ending.value);
    if(initial<0||final<0)throw Error('Os estoques inicial e final não podem ser negativos.');
    void save('save-cmv',{opening:initial,ending:final});
   }catch(error){$('inventory-error').textContent=error.message;}
  };
  $('inventory-new-adjustment').onclick=()=>openAdjustment();
 }
 function openAdjustment(adjustment) {
  activeAdjustment={base:context(),id:adjustment?.id||crypto.randomUUID()};
  const form=$('inventory-adjustment-form');
  form.reset();
  form.elements.kind.value=adjustment?.kind||'freight';
  form.elements.amount.value=adjustment?editAmount(adjustment.amount):'';
  form.elements.description.value=adjustment?.description||'';
  $('inventory-adjustment-error').textContent='';
  $('inventory-adjustment-title').textContent=adjustment?'Editar ajuste de estoque':'Novo ajuste de estoque';
  dialog.showModal();
 }
 $('inventory-adjustment-close').onclick=()=>dialog.close();
 $('inventory-adjustment-form').elements.kind.innerHTML=Object.entries(adjustmentTypes).map(([id,type])=>choice(id,type.label)).join('');
 $('inventory-adjustment-form').onsubmit=event=>{
  event.preventDefault();
  const {kind,amount,description}=Object.fromEntries(new FormData(event.currentTarget));
  try{
   void save('save-stock-adjustment',{id:activeAdjustment.id,kind,amount:cents(amount),description},activeAdjustment.base,()=>dialog.close());
  }catch(error){$('inventory-adjustment-error').textContent=error.message;}
 };
 panel.onclick=event=>{
  const target=event.target.closest('[data-adjust-edit],[data-adjust-delete],[data-stock-review]');
  if(!target)return;
  if(target.hasAttribute('data-adjust-edit'))openAdjustment(model.entries[Number(target.dataset.adjustEdit)]);
  if(target.hasAttribute('data-adjust-delete')){
   const {id,description}=model.entries[Number(target.dataset.adjustDelete)],base=context();
   ask('Excluir o ajuste “'+description+'”? O CMV será recalculado.',()=>save('delete-stock-adjustment',{id},base));
  }
  if(target.hasAttribute('data-stock-review')){
   const index=Number(target.dataset.stockReview),base=context();
   const {row,source}=model.history[index];
   const decision=$('inventory-review-'+index).value;
   if(!decision){$('inventory-error').textContent='Escolha o tratamento do lançamento.';toast('Escolha o tratamento do lançamento.');return;}
   ask('Aplicar “'+choices[decision]+'” a “'+row.description+'”? O lançamento original e os pagamentos serão preservados.',
    ()=>save('review-stock-legacy',{id:row.id,source,decision,sourceDate:row.date,sourceAmount:row.amount,sourceCategory:row.category},base));
  }
 };
 return {render};
}
