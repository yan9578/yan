import {api} from './api.js';
import {initAuth,showAuth} from './auth.js';
import {initAccount,setAccount,showPendingNotice} from './account.js';
import {initAdmin,loadAdmin} from './admin.js';
import {initTelemetry,track} from './telemetry.js';
import {cents,summarize,csv,methods} from './finance.js';
import {createOperations} from './operations-ui.js';
import {createCashCompanies} from './cash-companies.js';

const $=s=>document.querySelector(s),money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),date=s=>new Date(s+'T12:00:00').toLocaleDateString('pt-BR'),today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;},esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Em HTTP na rede local, randomUUID pode não estar disponível.
function newId(){if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
let records=[],editing=null,view='overview',revision=0,saving=false;
const businesses=createCashCompanies({getRecords:()=>records,persist,render,toast,isSaving:()=>saving});
const operations=createOperations({businesses,manualRows:()=>records,renderCash:render,activate:activateOperations,toast});
const allCompanyRows=()=>[...businesses.records(),...operations.cash().filter(r=>r.company===businesses.current()?.id)];
window.caixaLinkedDre=book=>operations.dre(book);
window.caixaOperationsEnabled=operations.enabled;
const operationButtons={operations:'#ops-open',agenda:'#agenda-open',settings:'#settings-open'};
function hideOperations(){
 $('#operations-area').hidden=true;
 for(const id of Object.values(operationButtons))$(id).classList.remove('active');
}
function activateOperations(area,title){
 hideOperations();
 for(const section of ['cash-content','dre-area','admin-area'])$('#'+section).hidden=true;
 document.querySelectorAll('aside nav button').forEach(b=>b.classList.toggle('active',b.matches(operationButtons[area])));
 $('#breadcrumb').textContent=title;
 $('#operations-area').hidden=false;
}
for(const [area,id] of Object.entries(operationButtons))$(id).onclick=()=>operations.openArea(area);
$('#cash-open-link').onclick=()=>operations.openArea('operations');
window.caixaDreRequest=async(method='GET',body)=>{const result=await api('dre',method,body);businesses.acceptDre(method==='GET'?result:{revision:result.revision,document:body.document});return result;};
async function loadRecords(){const data=await api('records');records=data.records;revision=data.revision;}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',4000);}
async function persist(next){if(saving){toast('Aguarde o salvamento em andamento.');return false;}saving=true;businesses.paint();try{const data=await api('records','PUT',{records:next,revision});records=next;revision=data.revision;return true;}catch(err){if(err.status===401){location.reload();return false;}if(err.status===409){await loadRecords();render();}toast(err.message);return false;}finally{saving=false;businesses.paint();}}
function period(p){const d=today();$('#from').value=p==='all'?'':p==='today'?d:d.slice(0,7)+'-01';$('#to').value=p==='all'?'':p==='today'?d:d.slice(0,7)+'-'+new Date(Number(d.slice(0,4)),Number(d.slice(5,7)),0).getDate();document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('selected',b.dataset.period===p));render();}
function filtered(){
 const from=$('#from').value,to=$('#to').value;
 return allCompanyRows().filter(r=>(!from||r.date>=from)&&(!to||r.date<=to));
}
function filteredHistory(rows){
 const type=$('#cash-movement-filter').value,category=$('#cash-category-filter').value;
 const search=$('#search').value.toLocaleLowerCase('pt-BR').trim();
 return rows.filter(r=>(!type||r.type===type)&&(!category||r.category===category)&&r.description.toLocaleLowerCase('pt-BR').includes(search));
}
function paintBalances(from,to){
 if(!operations.enabled())return;
 const rows=allCompanyRows();
 const balances=operations.balances(rows,from,to);
 $('#opening').textContent=money(balances.reduce((sum,a)=>sum+a.opening,0));
 $('#closing').textContent=money(balances.reduce((sum,a)=>sum+a.closing,0));
 const pending=operations.pending();
 $('#cash-open-income').textContent=money(pending.income);
 $('#cash-open-expense').textContent=money(pending.expense);
 $('#cash-open-late').textContent=pending.late+' em atraso';
 const picker=$('#cash-category-filter');
 const previous=picker.value;
 picker.replaceChildren(new Option('Todas',''),...[...new Set(rows.map(r=>r.category))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(c=>new Option(c,c)));
 if([...picker.options].some(o=>o.value===previous))picker.value=previous;
}
function showSavedRecord(record){
 const from=$('#from').value,to=$('#to').value;
 const outside=from&&record.date<from||to&&record.date>to;
 if(!outside&&filteredHistory([record]).length){toast('Lançamento salvo na sua conta.');return;}
 toast(outside?'Lançamento salvo em '+date(record.date)+', fora do período exibido. ':'Lançamento salvo, fora dos filtros exibidos. ');
 const button=document.createElement('button');
 button.textContent='Ver lançamento';
 button.onclick=()=>{
  period('all');
  $('#cash-movement-filter').value='';
  $('#cash-category-filter').value='';
  document.querySelector('[data-view="history"]').click();
  $('#search').value=record.description;
  render();
  $('#rows').scrollIntoView({block:'nearest'});
 };
 $('#toast').append(button);
 clearTimeout(toast.timer);
 toast.timer=setTimeout(()=>$('#toast').style.display='none',11000);
}
function render(){businesses.paint();operations.repaint();$('#cash-welcome').hidden=view!=='overview'||allCompanyRows().length>0;const from=$('#from').value,to=$('#to').value;if(from&&to&&from>to){$('#period-label').textContent='A data inicial precisa ser anterior à final.';return;}$('#period-label').textContent=from&&to?`${date(from)} a ${date(to)}`:'Todos os lançamentos';const data=filtered(),s=summarize(data);paintBalances(from,to);for(const k of ['income','expense','balance'])$('#'+k).textContent=money(s[k]);$('#payments').innerHTML=methods.map((m,i)=>`<div class="payment"><div><span>${m}</span><b class="financial-value">${money(s.payments[m])}</b></div><section class="track"><i style="width:${s.income?s.payments[m]/s.income*100:0}%;opacity:${1-i*.15}"></i></section></div>`).join('');
const days=Object.entries(s.daily).sort(([a],[b])=>a.localeCompare(b)),max=Math.max(1,...days.flatMap(([,v])=>[v.income,v.expense]));$('#chart').innerHTML=days.length?days.map(([d,v])=>`<div class="day" title="${date(d)}: entradas ${money(v.income)}, saídas ${money(v.expense)}"><div class="bars"><div class="bar" style="height:${v.income/max*100}%"></div><div class="bar out" style="height:${v.expense/max*100}%"></div></div><small>${d.slice(8)}/${d.slice(5,7)}</small></div>`).join(''):'<div class="chart-empty">Seu próximo lançamento já pode virar um gráfico.<br>Registre os movimentos para começar.</div>';
for(const [id,best,kind]of [['best-in',s.bestIncome,'entrada'],['best-out',s.bestExpense,'saída']])$('#'+id).innerHTML=`${kind==='entrada'?'↗':'↘'} Dia com maior ${kind}<strong class="financial-value">${best?`${date(best[0])} · ${money(best[1][kind==='entrada'?'income':'expense'])}`:'Aguardando lançamentos'}</strong><small>${best?'Total de movimentos desse dia no período escolhido.':'Os destaques aparecem quando você começar.'}</small>`;
const search=$('#search').value.toLocaleLowerCase('pt-BR'),rows=filteredHistory(data).sort((a,b)=>b.date.localeCompare(a.date));const shown=view==='overview'&&!search?rows.slice(0,6):rows;$('#history-title').textContent=view==='overview'?'Últimos lançamentos':'Movimentações do período';$('#rows').innerHTML=shown.map(r=>`<tr><td>${esc(r.description)}</td><td data-label="Data do caixa">${date(r.date)}</td><td data-label="Pagamento"><span class="badge">${esc(r.method)}</span></td><td data-label="Categoria">${esc(r.category)}</td><td class="financial-value ${r.type==='income'?'positive':'negative'}">${r.type==='income'?'+':'−'} ${money(r.amount)}</td><td>${r.linked?'Gerenciado em Contas':`<button data-edit="${esc(r.id)}" aria-label="Editar ${esc(r.description)}">Editar</button><button data-delete="${esc(r.id)}" aria-label="Excluir ${esc(r.description)}">Excluir</button>`}</td></tr>`).join('');$('#empty').hidden=shown.length>0;$('#empty').firstChild.textContent=allCompanyRows().length?'Nenhum lançamento encontrado neste filtro.':'Seu caixa começa aqui.';$('#overview').hidden=view!=='overview';}
function fillCashAccount(account){
 if(!operations.enabled())return;
 const f=$('#form'),id=JSON.parse(f.elements.company.value||'null');
 f.elements.account.replaceChildren(...operations.accounts(id).map(a=>new Option(a.name,a.id)));
 f.elements.account.value=operations.accounts(id).some(a=>a.id===account)?account:operations.accountDefault;
}
function movementFields(resetCategory=false){
 const form=$('#form'),out=form.elements.type.value==='expense';
 $('#sale-date-label').hidden=out;
 if(resetCategory){
  form.elements.category.value=out?'Fornecedores':'Vendas';
  if(out)form.elements.saleDate.value='';
 }
 form.elements.description.placeholder=out?'Ex.: pagamento de aluguel':'Ex.: vendas do dia';
 $('#cash-movement-hint').textContent=out?'Use a data em que o pagamento saiu da conta.':'Use a data em que o dinheiro entrou na conta e o valor líquido recebido.';
}
$('#form').elements.type.onchange=()=>movementFields(true);
$('#record-company').onchange=()=>fillCashAccount();
$('#cash-movement-filter').onchange=render;
$('#cash-category-filter').onchange=render;
function open(record){if(saving||businesses.busy)return toast('Aguarde o salvamento em andamento.');editing=record?.id||null;const f=$('#form');f.reset();businesses.fillRecord(record);$('#error').textContent='';$('#form-title').textContent=record?'Editar lançamento':'Novo lançamento';f.elements.date.value=today();if(record)for(const k of ['type','description','method','date','saleDate','category'])f.elements[k].value=record[k]||'';if(record)f.elements.amount.value=(record.amount/100).toFixed(2).replace('.',',');fillCashAccount(record?.account);movementFields();$('#modal').showModal();}
$('#new').onclick=()=>open();$('#close').onclick=()=>$('#modal').close();$('#form').onsubmit=async e=>{e.preventDefault();const f=e.target;try{const amount=cents(f.elements.amount.value.trim()),description=f.elements.description.value.trim();if(!description)throw Error('Informe uma descrição.');if(f.elements.date.value>today())throw Error('Registre somente valores já recebidos ou pagos.');if(f.elements.saleDate.value&&f.elements.saleDate.value>f.elements.date.value)throw Error('A venda não pode ser depois do recebimento.');const r={id:editing||newId(),amount,description};for(const k of ['type','method','date','saleDate','category'])r[k]=f.elements[k].value;if(r.type==='expense')r.saleDate='';if(operations.enabled())r.account=f.elements.account.value;const linked=businesses.attach(r,f.elements.company.value);const next=editing?records.map(x=>x.id===editing?linked:x):[...records,linked];if(await persist(next)){$('#modal').close();businesses.select(linked.company||'');showSavedRecord(linked);}}catch(err){$('#error').textContent=err.message;}};
$('#rows').onclick=async e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)open(records.find(r=>r.id===edit.dataset.edit));if(del&&confirm('Excluir este lançamento? Você poderá desfazer logo em seguida.')){const deleted=records.find(r=>r.id===del.dataset.delete),next=records.filter(r=>r.id!==del.dataset.delete);if(await persist(next)){render();$('#toast').replaceChildren(document.createTextNode('Lançamento excluído. '));const undo=document.createElement('button');undo.textContent='Desfazer';undo.style.color='white';undo.onclick=async ()=>{if(await persist([...records,deleted])){render();toast('Lançamento restaurado.');}};$('#toast').append(undo);$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',10000);}}};
for(const b of document.querySelectorAll('[data-period]'))b.onclick=()=>period(b.dataset.period);for(const id of ['from','to'])$('#'+id).onchange=()=>{document.querySelectorAll('[data-period]').forEach(b=>b.classList.remove('selected'));render();};$('#search').oninput=render;document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{hideOperations();$('#admin-area').hidden=true;$('#admin-open').classList.remove('active');$('#cash-content').hidden=false;$('#dre-area').hidden=true;$('#dre-open').classList.remove('active');view=b.dataset.view;track('cash');document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n===b));$('#title').textContent=view==='overview'?'Visão geral do caixa':'Histórico do caixa';$('#cash-view-help').textContent=view==='overview'?'Acompanhe o dinheiro recebido e pago no período.':'Consulte, filtre e edite movimentações já realizadas.';$('#breadcrumb').textContent=view==='overview'?'Visão geral':'Histórico';render();});
$('#export').onclick=()=>{const rows=filteredHistory(filtered()).sort((a,b)=>b.date.localeCompare(a.date));if(!rows.length)return toast('Não há lançamentos neste período para exportar.');const url=URL.createObjectURL(new Blob([csv(rows)],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download=`caixa-claro-${(businesses.current()?.name||'empresa').replace(/[^a-zA-Z0-9-]/g,'-')}-${today()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Arquivo CSV exportado. Abra no Excel.');};
$('#demo')?.addEventListener('click',async ()=>{if(businesses.records().length)return toast('Os exemplos só podem ser usados com o caixa desta empresa vazio.');if(!confirm('Adicionar lançamentos fictícios para experimentar? Eles serão identificados como exemplos.'))return;const now=new Date(),data=[];for(let i=0;i<7;i++){const d=new Date(now);d.setDate(d.getDate()-i);const day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;for(const [type,amount,description,method,category]of [['income',45000+i*1357,'[Exemplo] Vendas do dia',methods[i%4],'Vendas'],['expense',12000+i*839,'[Exemplo] Compra de materiais','Pix','Fornecedores']])data.push({id:newId(),type,amount,description,method,category,date:day,saleDate:day});}if(await persist([...records,...data.map(r=>businesses.attach(r,JSON.stringify(businesses.current().id)))])){period('all');toast('Exemplos adicionados. Você pode editar ou excluir cada um.');}});
async function enter(user){await loadRecords();await businesses.load(user.id||user.username);await operations.load(user.operationsEnabled||user.preview,user.preview);document.body.append($('#analytics-banner'));setAccount(user);$('#admin-open').hidden=user.isAdmin!==true;$('#account-name').textContent=user.username;$('#login-screen').hidden=true;$('#workspace').hidden=false;period(operations.period());await showPendingNotice();}
initAccount();initAdmin();
const config=await initAuth(async()=>enter(await api('me')));
if(config.preview){
 $('#preview-login').hidden=false;
 $('#auth-unavailable').hidden=true;
 $('#login-form').hidden=true;
 $('#preview-enter').onclick=async event=>{
  event.target.disabled=true;
  try{
   await api('login','POST',{username:'demonstracao',password:'CaixaTeste2026'});
   await enter(await api('me'));
  }catch(error){$('#auth-error').textContent=error.message;}
  finally{event.target.disabled=false;}
 };
 $('#account-delete').hidden=true;
 $('#review-analytics').hidden=true;
}else initTelemetry();
$('#logout').onclick=async ()=>{if(saving||businesses.busy)return toast('Aguarde o salvamento antes de sair.');try{await api('logout','POST',{});records=[];location.reload();}catch(err){toast(err.message);}};
try{await enter(await api('me'));}catch(err){$('#workspace').hidden=true;$('#login-screen').hidden=false;if(err.status!==401)$('#auth-error').textContent='Não foi possível conectar ao servidor. Tente recarregar.';}


$('#dre-open').onclick=async()=>{
  if(operations.enabled()){
   try{await operations.refresh();}
   catch(error){toast(error.message);}
  }
  hideOperations();
  $('#admin-area').hidden=true;$('#admin-open').classList.remove('active');$('#cash-content').hidden=true;$('#dre-area').hidden=false;track('dre');
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));
  $('#dre-open').classList.add('active');$('#breadcrumb').textContent='DRE · Resultado';
  const frame=$('#dre-frame');if(frame.contentWindow&&operations.enabled())frame.contentWindow.dreNeedsReload=true;if(!frame.getAttribute('src')||(frame.contentWindow.dreNeedsReload&&!frame.contentDocument?.querySelector('dialog[open]')&&!frame.contentDocument?.body?.inert))frame.src='/dre.html';
};

$('#admin-open').onclick=()=>{if($('#admin-open').hidden)return;hideOperations();$('#cash-content').hidden=true;$('#dre-area').hidden=true;$('#admin-area').hidden=false;document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));$('#dre-open').classList.remove('active');$('#admin-open').classList.add('active');$('#breadcrumb').textContent='Administração';track('admin');loadAdmin();};
