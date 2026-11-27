import {api} from './api.js';
import {exportAccount} from './account.js';
import {M} from './dre-model.js';
import {cents,methods} from './finance.js';
import {addDays,cashBalances,cashOperations,categoryUsage,currentProfile,defaultAccount,dreOperations,emptyOperations,isoDay,money,paid,project,remaining,situation,types} from './operations-model.js';
import {applyTheme, preferenceKey} from './theme.js';
import {legacyDecision,purchaseName} from './inventory-model.js';

const $ = id => document.getElementById(id);
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayLabel = day => day.split('-').reverse().join('/');
const fieldAmount = amount => (amount/100).toFixed(2).replace('.',',');
const option = (id,label) => '<option value="'+esc(id)+'">'+esc(label)+'</option>';
const statuses = {pending:'Pendente',partial:'Parcial',paid:'Quitada',late:'Atrasada',cancelled:'Cancelada'};
const categories = Object.keys(types).map(id=>M.map[id]).filter(Boolean);
const categoryOptions = categories.map(c=>option(c.id,c.name+(c.group==='outside'?' · Patrimonial':''))).join('');
const methodOptions = methods.map(m=>option(m,m)).join('');
const auditNames = {'save-operation':'Operação salva',settle:'Baixa registrada',reverse:'Baixa estornada',cancel:'Operação cancelada',
 'save-account':'Conta ajustada','save-category':'Categoria salva','delete-category':'Categoria excluída',preferences:'Alertas configurados',transfer:'Transferência registrada','reverse-transfer':'Transferência estornada'};

export function createOperations({businesses,manualRows,renderCash,activate,toast,onSave}) {
 let book = {revision:0,document:emptyOperations()};
 let enabled = false;
 let cmvPreview = false;
 let ready = false;
 let busy = false;
 let area = '';
 let range = 15;
 let month = isoDay().slice(0,7);
 let filter = {from:'',to:'',status:'',category:'',type:''};
 let preferences = {theme:'light',period:'month',date:'numeric',amount:'currency'};
 let submit;
 const panel = $('operations-area');
 const activeCompany = () => businesses.current();
 const companyId = () => activeCompany()?.id;
 const state = () => book.document;
 const profile = () => currentProfile(state(),companyId());
 const companyRows = () => [...manualRows(),...cashOperations(state())].filter(r=>(r.company||'')===companyId());
 const validCompany = () => !!companyId()&&!activeCompany().archived;
 const byId = id => state().operations.find(o=>o.id===id&&o.company===companyId());
 const accountOptions = () => profile().accounts.map(a=>option(a.id,a.name)).join('');
 const categoryName = id => profile().categories.find(c=>c.id===id)?.name||M.map[id]?.name||id;
 const displayDay = day => preferences.date==='short'
   ? new Date(day+'T12:00:00').toLocaleDateString('pt-BR',{day:'numeric',month:'short',year:'numeric'})
   : dayLabel(day);
 const displayAmount = value => preferences.amount==='number'
   ? ((value||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
   : money(value);
 function loadPreferences() {
   try { preferences={...preferences,...JSON.parse(localStorage.getItem(preferenceKey)||'{}')}; } catch {}
   applyTheme(preferences.theme);
 }
 async function load(isEnabled,isPreview=false,inventoryPreview=false) {
   enabled=!!isEnabled;
   cmvPreview=!!inventoryPreview;
   if (!enabled) return;
   book=await api('operations');
   ready=true;
   loadPreferences();
   document.documentElement.classList.add('preview-mode');
   document.querySelectorAll('[data-preview]').forEach(element=>element.hidden=false);
   $('preview-banner').hidden=!isPreview;
 }
 async function refresh() {
   if (!ready||busy) return false;
   const latest=await api('operations');
   if(latest.revision<=book.revision)return false;
   book=latest;
   return true;
 }
 async function run(action, data, expectedRevision=book.revision) {
   if (busy) throw Error('Aguarde a gravação em andamento.');
   busy=true;
   try {
     book=await api('operations','POST',{revision:expectedRevision,command:{action,company:companyId(),...data}});
     onSave(expectedRevision,book.revision);
   } catch(error) {
     if(error.status===409) {
       book=await api('operations');
       renderCash();
       draw();
     }
     throw error;
   } finally {
     busy=false;
   }
   renderCash();
   draw();
 }
 const sections = {
   operations:['Contas a pagar e a receber','Acompanhe vencimentos e registre cada recebimento ou pagamento conforme ele acontece.'],
   agenda:['Agenda financeira','Veja o que vence e como os compromissos podem afetar seu saldo.'],
   settings:['Configurações','Ajuste contas, categorias e preferências da empresa.']
 };
 function header() {
   const [title,description] = sections[area];
   const companies = businesses.companies();
   const selector = '<label class="ops-company">Empresa<select id="ops-company">'+companies.map(c=>option(c.id,c.name)).join('')+'</select></label>';
   const action = area==='operations'&&validCompany()?'<button class="primary" data-action="new-operation">＋ Nova operação</button>':'';
   return '<div class="heading ops-heading"><div><h1>'+title+'</h1><p>'+description+'</p></div>'+action+'</div>'+selector;
 }
 function opportunityCards() {
   const today=isoDay();
   const own=state().operations.filter(o=>o.company===companyId());
   const sum = fn => own.reduce((total,o)=>total+(fn(o)?remaining(o):0),0);
   return '<div class="ops-metrics">'+
     metric('A receber',displayAmount(sum(o=>o.type==='income')),'positive')+
     metric('A pagar',displayAmount(sum(o=>o.type==='expense')),'negative')+
     metric('Atrasado a receber',displayAmount(sum(o=>o.type==='income'&&o.due<today)))+
     metric('Atrasado a pagar',displayAmount(sum(o=>o.type==='expense'&&o.due<today)))+'</div>';
 }
 function pending() {
   const pending={income:0,expense:0,late:0};
   const today=isoDay();
   for(const o of state().operations){
     const open=remaining(o);
     if(o.company!==companyId()||!open)continue;
     pending[o.type]+=open;
     if(o.due<today)pending.late++;
   }
   return pending;
 }
 function metric(label,value,className='') {
   return '<article><span>'+label+'</span><strong class="financial-value '+className+'">'+value+'</strong></article>';
 }
 function filterOptions(oneDate=false) {
   const own = state().operations.filter(o=>o.company===companyId());
   const customIds = new Map(own.map(o=>[o.categoryId,o.categoryName]));
   return '<div class="ops-filters" aria-label="Filtros">'+(oneDate?'':'<label>Vencimento de<input id="ops-from" type="date"></label><label>Até<input id="ops-to" type="date"></label>')+
     '<label>Tipo<select id="ops-type">'+option('','Todos')+option('income','A receber')+option('expense','A pagar')+'</select></label>'+
     '<label>Situação<select id="ops-status">'+option('','Todas')+Object.entries(statuses).map(([id,name])=>option(id,name)).join('')+'</select></label>'+
     '<label>Categoria<select id="ops-category">'+option('','Todas')+[...customIds].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>option(id,name)).join('')+'</select></label></div>';
 }
 function selectedOperations({byDate=true}={}) {
   const today=isoDay();
   return state().operations.filter(o=>o.company===companyId()&&
     (!byDate||((!filter.from||o.due>=filter.from)&&(!filter.to||o.due<=filter.to)))&&
     (!filter.type||o.type===filter.type)&&(!filter.status||situation(o,today)===filter.status||filter.status==='partial'&&paid(o)>0&&remaining(o)>0)&&
     (!filter.category||o.categoryId===filter.category)).sort((a,b)=>a.due.localeCompare(b.due));
 }
 function operationList() {
   const today=isoDay();
   if(filter.from&&filter.to&&filter.from>filter.to)return '<p role="alert">A data inicial precisa ser anterior à final.</p>';
   const rows=selectedOperations().map(o=>{
     const status=situation(o,today);
     const partial=status==='late'&&paid(o)>0?' · Parcial':'';
     return '<tr><td>'+esc(o.description)+'<small>'+esc(o.categoryName)+'</small></td><td>'+displayDay(o.due)+'</td>'+
       '<td>'+(o.type==='income'?'A receber':'A pagar')+'</td><td><span class="ops-pill '+status+'">'+statuses[status]+partial+'</span></td>'+
       '<td>'+displayAmount(o.amount)+'</td><td>'+displayAmount(remaining(o))+'</td><td class="ops-actions">'+
       (remaining(o)>0?'<button class="secondary" data-action="settle" data-id="'+esc(o.id)+'">Registrar baixa</button>':'')+
       '<button class="secondary" data-action="details" data-id="'+esc(o.id)+'">Detalhes</button></td></tr>';
   });
   return rows.length?table(['Operação','Vencimento','Tipo','Situação','Valor','Em aberto','Ações'],rows):'<p class="ops-empty">Nenhuma operação para estes filtros.</p>';
 }
 function table(headers,rows) {
   return '<div class="table-scroll" tabindex="0" role="region" aria-label="Dados da tabela"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+
     '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
 }
 function operationsPage() {
   return opportunityCards()+'<article><h2>Operações da empresa</h2>'+filterOptions()+'<div id="ops-list">'+operationList()+'</div></article>';
 }
 function agendaPage() {
   const today=isoDay(), forecast=project(state(),companyId(),companyRows(),today,range);
   const first=month+'-01', end=M.shift(month,1)+'-01';
   const groups = new Map();
   for(const o of selectedOperations({byDate:false})) {
     if(o.due<first||o.due>=end)continue;
     if(!groups.has(o.due))groups.set(o.due,[]);
     groups.get(o.due).push(o);
   }
   const firstWeekday=(new Date(first+'T12:00:00').getDay()+6)%7;
   const cells=Array.from({length:firstWeekday},()=>'<div class="ops-day blank" aria-hidden="true"></div>');
   for(let date=first;date<end;date=addDays(date,1)) {
     const list=groups.get(date)||[];
     cells.push('<div class="ops-day'+(date===today?' current':'')+'"><strong>'+Number(date.slice(-2))+'</strong>'+
       list.map(o=>'<button class="ops-calendar-item '+o.type+'" data-action="details" data-id="'+esc(o.id)+'" aria-label="'+esc(o.description)+'">'+
         '<span>'+esc(o.description)+'</span><small>'+displayAmount(remaining(o))+' · '+statuses[situation(o,today)]+'</small></button>').join('')+'</div>');
   }
   const alertDate=addDays(today,profile().alertDays);
   const soon=state().operations.filter(o=>o.company===companyId()&&remaining(o)>0&&o.due>=today&&o.due<=alertDate);
   const forecastRows=forecast.events.map(e=>'<tr><td>'+displayDay(e.date)+'</td><td>'+displayAmount(e.income)+'</td><td>'+displayAmount(e.expense)+'</td><td>'+displayAmount(e.balance)+'</td></tr>');
   const monthLabel=new Date(first+'T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
   return '<article class="ops-panel"><div class="card-heading"><h2>Projeção de caixa</h2><div class="tabs" aria-label="Horizonte">'+
    [7,15,30].map(n=>'<button data-action="range" data-id="'+n+'" aria-pressed="'+(n===range)+'" class="'+(n===range?'selected':'')+'">'+n+' dias</button>').join('')+
    '</div></div><p>Parte do saldo realizado. Compromissos vencidos em aberto entram na previsão de hoje.</p>'+
    '<div class="ops-metrics">'+metric('Saldo realizado hoje',displayAmount(forecast.opening))+metric('Saldo previsto em '+range+' dias',displayAmount(forecast.closing),forecast.closing<0?'negative':'')+'</div>'+
    (forecast.shortage?'<p role="status" class="ops-warning">Possível falta de caixa em '+displayDay(forecast.shortage)+'.</p>':'')+
    (soon.length?'<p class="hint">'+soon.length+' compromisso(s) a vencer '+(profile().alertDays?'nos próximos '+profile().alertDays+' dias.':'hoje.')+'</p>':'')+
    (forecastRows.length?'<div class="ops-projection">'+table(['Dia previsto','A receber','A pagar','Saldo previsto'],forecastRows)+'</div>':'<p class="ops-empty">Nenhum compromisso em aberto neste horizonte.</p>')+'</article>'+
    '<article><div class="card-heading ops-calendar-head"><h2>Vencimentos · '+esc(monthLabel)+'</h2><div class="ops-actions"><button class="secondary" data-action="month-back" aria-label="Mês anterior">‹</button>'+
    '<button class="secondary" data-action="month-today">Mês atual</button><button class="secondary" data-action="month-next" aria-label="Próximo mês">›</button></div></div>'+
    filterOptions(true)+'<div class="ops-calendar" aria-label="Calendário de vencimentos">'+['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d=>'<span>'+d+'</span>').join('')+cells.join('')+'</div>'+
    '<div class="ops-calendar-mobile-list">'+[...groups].map(([date,entries])=>'<h3>'+displayDay(date)+'</h3><ul>'+entries.map(o=>
     '<li><button class="secondary" data-action="details" data-id="'+esc(o.id)+'">'+esc(o.description)+'<small>'+displayAmount(remaining(o))+' em aberto · '+statuses[situation(o,today)]+'</small></button></li>').join('')+'</ul>').join('')+'</div></article>';
 }
 function settingsPage() {
   const balances = cashBalances(state(),companyId(),companyRows(),isoDay(),isoDay());
   const accounts = balances.map(a=>'<tr><td>'+esc(a.name)+'</td><td>'+displayAmount(a.opening)+'</td><td>'+displayAmount(a.closing)+'</td>'+
     '<td><button class="secondary" data-action="account" data-id="'+esc(a.id)+'">Editar</button></td></tr>');
   const accountName = id => profile().accounts.find(a=>a.id===id)?.name||id;
   const transfers = state().transfers.filter(t=>t.company===companyId()).sort((a,b)=>b.date.localeCompare(a.date)).map(t=>'<tr><td>'+displayDay(t.date)+'</td><td>'+
     esc(accountName(t.from))+' → '+esc(accountName(t.to))+'</td><td>'+displayAmount(t.amount)+'</td>'+
     '<td><button class="secondary" data-action="undo-transfer" data-id="'+esc(t.id)+'">Estornar</button></td></tr>');
   const custom = profile().categories.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(M.map[c.category].name)+'</td>'+
     '<td><div class="ops-actions"><button class="secondary" data-action="category" data-id="'+esc(c.id)+'" aria-label="Editar categoria '+esc(c.name)+'">Editar</button>'+
     '<button class="secondary danger-text" data-action="delete-category" data-id="'+esc(c.id)+'" aria-label="Excluir categoria '+esc(c.name)+'">Excluir</button></div></td></tr>');
   const audit=state().audit.filter(a=>a.company===companyId()).slice(-15).reverse();
   return '<article class="ops-panel"><div class="card-heading"><h2>'+esc(activeCompany().name)+'</h2><button class="secondary" data-action="company">Editar empresa</button></div>'+
   '<form id="ops-preferences" class="ops-filters"><label>Tema<select name="theme">'+option('light','Claro')+option('dark','Escuro')+'</select></label>'+
   '<label>Abrir o caixa em<select name="period">'+option('month','Este mês')+option('today','Hoje')+option('all','Todo o período')+'</select></label>'+
   '<label>Datas nesta área<select name="date">'+option('numeric','Dia/mês/ano')+option('short','Mês abreviado')+'</select></label>'+
   '<label>Valores nesta área<select name="amount">'+option('currency','Com R$')+option('number','Somente número')+'</select></label>'+
   '<label>Alerta de vencimento<select name="alertDays">'+[0,3,7,15,30].map(n=>option(n,n?n+' dias antes':'No dia')).join('')+'</select></label><button class="secondary">Salvar preferências</button></form></article>'+
   '<article class="ops-panel"><div class="card-heading"><h2>Contas e saldo disponível</h2><div class="ops-actions"><button class="secondary" data-action="account">＋ Conta</button>'+
   '<button class="secondary" data-action="transfer"'+(balances.length<2?' disabled':'')+'>Transferir</button></div></div>'+
   table(['Conta','Saldo no início do dia','Saldo realizado hoje','Ações'],accounts)+
   (transfers.length?'<h3>Transferências entre contas</h3>'+table(['Data','Trajeto','Valor','Ações'],transfers):'')+'</article>'+
   '<article class="ops-panel"><div class="card-heading"><h2>Categorias personalizadas</h2><button class="secondary" data-action="category">＋ Categoria</button></div>'+
   (custom.length?table(['Nome','Classificação','Ações'],custom):'<p class="ops-empty">Use as categorias padrão ou crie nomes que façam sentido para sua empresa.</p>')+'</article>'+
   '<article><div class="card-heading"><h2>Histórico financeiro</h2><button class="secondary" data-action="backup">Baixar backup</button></div>'+
   (audit.length?table(['Alteração','Quando','Referência'],audit.map(a=>'<tr><td>'+esc(auditNames[a.action])+'</td><td>'+
   esc(new Date(a.at).toLocaleString('pt-BR'))+'</td><td>'+esc((byId(a.id)?.description||a.details?.before?.name||profile().categories.find(c=>c.id===a.id)?.name||accountName(a.id)||'Preferências'))+'</td></tr>')):'<p class="ops-empty">As alterações e estornos aparecerão aqui.</p>')+'</article>';
 }
 function draw() {
   if (!ready||!area||panel.hidden) return;
   panel.innerHTML=header()+(validCompany()?({operations:operationsPage,agenda:agendaPage,settings:settingsPage}[area])():
     '<article><p>Selecione uma empresa cadastrada ou abra o Fluxo de caixa para cadastrar uma.</p></article>');
   $('ops-company').value=companyId()||'';
   for(const key of ['from','to','type','status','category'])if($('ops-'+key))$('ops-'+key).value=filter[key];
   const form=$('ops-preferences');
   if(form){
     for(const key of ['theme','period','date','amount'])form.elements[key].value=preferences[key];
     form.elements.alertDays.value=profile().alertDays;
   }
 }
 async function openArea(next) {
   if (area!==next)filter={from:'',to:'',status:'',category:'',type:''};
   area=next;
   activate(next,sections[next][0]);
   draw();
   try{
     if(await refresh()&&area===next) {
       const form=$('ops-preferences');
       const draft=form&&form.contains(document.activeElement)?new FormData(form):null;
       draw();
       if(draft)for(const [name,value] of draft)$('ops-preferences').elements[name].value=value;
     }
   }catch(error){toast(error.message);}
 }
 function dialog(title,html,onSubmit,button='Salvar') {
   const modal=$('ops-dialog');
   if(modal.open)modal.close();
   $('ops-dialog-title').textContent=title;
   $('ops-fields').innerHTML=html;
   $('ops-error').textContent='';
   $('ops-submit').hidden=!onSubmit;
   $('ops-submit').textContent=button;
   $('ops-submit').classList.remove('danger-button');
   submit=onSubmit;
   modal.showModal();
 }
 function field(name,label,type='text',value='',extra='') {
   return '<label>'+label+'<input required name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
 }
 function select(name,label,options) {
   return '<label>'+label+'<select required name="'+name+'">'+options+'</select></label>';
 }
 function moneyField(name,label,value='') {
   return field(name,label,'text',value,'inputmode="decimal" placeholder="0,00"');
 }
 function newOperation(operation) {
   const revision=book.revision, id=operation?.id||crypto.randomUUID();
   const allowed=id=>!cmvPreview?id!=='serviceCost':id!=='cost'||operation?.category==='cost';
   const standard=categories.filter(c=>allowed(c.id)).map(c=>option(c.id,c.name+(c.group==='outside'&&c.id!=='inventory'?' · Patrimonial':''))).join('');
   const custom = profile().categories.filter(c=>allowed(c.category)).map(c=>option(c.id,c.name+' · '+M.map[c.category].name)).join('');
   const purchase=cmvPreview?'<div id="purchase-fields" hidden><label>Referência da compra (opcional)<input name="purchaseReference" maxlength="80" placeholder="Ex.: fornecedor e número da nota" value="'+esc(operation?.purchaseReference)+'"></label>'+
    (!operation?'<label>Condição da compra<select name="purchaseMode"><option value="term">A prazo</option><option value="paid">À vista · já paga</option></select></label>'+
    '<fieldset id="purchase-payment" hidden disabled><legend>Pagamento realizado</legend><div class="form-grid">'+
    field('paidDate','Data efetiva de pagamento','date',isoDay(),'max="'+isoDay()+'"')+
    select('paidAccount','Conta financeira',accountOptions())+select('paidMethod','Forma de pagamento',methodOptions)+'</div></fieldset>':'')+'</div>':'';
   dialog(operation?'Editar operação':'Nova operação',
     field('description','Descrição','text',operation?.description,'maxlength="120"')+
     select('category','Categoria',option('','Selecione')+standard+(custom?'<optgroup label="Personalizadas">'+custom+'</optgroup>':''))+
     '<p class="hint" id="ops-category-hint">Escolha a categoria para verificar o efeito na DRE.</p>'+
     '<div class="form-grid">'+moneyField('amount','Valor (R$)',operation?fieldAmount(operation.amount):'')+
     '<label><span id="ops-operation-date-label">Data da operação</span><input required name="date" type="date" value="'+esc(operation?.date||isoDay())+'" max="'+isoDay()+'"></label>'+
     field('due','Vencimento','date',operation?.due||isoDay())+'</div>'+purchase+
     '<p class="hint" id="ops-settlement-hint">Registre os recebimentos ou pagamentos na operação depois de salvar.</p>',
     async ({purchaseMode,paidDate,paidAccount,paidMethod,...values})=>{
       const settlement=!operation&&purchaseMode==='paid'&&paidDate?
        {paymentId:crypto.randomUUID(),date:paidDate,account:paidAccount,method:paidMethod}:undefined;
       await run('save-operation',{...values,id,amount:cents(values.amount),settlement},revision);
     });
   const form=$('ops-form');
   form.elements.category.value=operation?.categoryId||'';
   const hint=()=>{
     const chosen=profile().categories.find(c=>c.id===form.elements.category.value)?.category||form.elements.category.value;
     const isPurchase=cmvPreview&&chosen==='inventory';
     const extra=$('purchase-fields'),payment=$('purchase-payment');
     if(extra)extra.hidden=!isPurchase;
     if(payment){
       payment.hidden=payment.disabled=!isPurchase||form.elements.purchaseMode.value!=='paid';
       if(!isPurchase)form.elements.purchaseMode.value='term';
     }
     $('ops-operation-date-label').textContent=isPurchase?'Data da aquisição':'Data da operação';
     $('ops-settlement-hint').textContent=isPurchase?'A compra entra no mês da aquisição. A baixa é registrada apenas quando o pagamento acontece.':'Registre os recebimentos ou pagamentos na operação depois de salvar.';
     if(!M.map[chosen]){$('ops-category-hint').textContent='Escolha a categoria para verificar o efeito na DRE.';return;}
     const direction=types[chosen]==='income'?'A receber':'A pagar';
     $('ops-category-hint').textContent=direction+(M.map[chosen].group==='outside'?' · Fora do resultado da DRE. ':' · Reconhecido na DRE na data da operação. ')+M.map[chosen].hint+
       (isPurchase?' O CMV será apurado no fechamento mensal.':'');
   };
   form.elements.category.onchange=hint;
   if(form.elements.purchaseMode)form.elements.purchaseMode.onchange=hint;
   hint();
 }
 function settlement(operation) {
   const revision=book.revision, paymentId=crypto.randomUUID();
   dialog(operation.type==='income'?'Registrar recebimento':'Registrar pagamento',
     '<p>'+esc(operation.description)+' · Em aberto: <strong>'+displayAmount(remaining(operation))+'</strong></p>'+
     '<div class="form-grid">'+moneyField('amount','Valor da baixa (R$)',fieldAmount(remaining(operation)))+
     field('date','Data efetiva','date',isoDay(),'max="'+isoDay()+'"')+select('account','Conta financeira',accountOptions())+
     select('method','Forma de pagamento',methodOptions)+'</div>',
     data=>run('settle',{...data,id:operation.id,paymentId,amount:cents(data.amount)},revision),'Registrar baixa');
 }
 function details(operation) {
   const name=id=>profile().accounts.find(a=>a.id===id)?.name||id;
   const entries=operation.payments.map(p=>'<li><div><strong class="financial-value">'+displayAmount(p.amount)+'</strong><small>'+
    displayDay(p.date)+' · '+esc(name(p.account))+' · '+esc(p.method)+(p.reversed?' · Estornada':'')+'</small></div>'+
    (!p.reversed?'<button type="button" class="secondary" data-action="reverse" data-id="'+esc(operation.id)+'" data-payment="'+esc(p.id)+'">Estornar</button>':'')+'</li>');
   const inventory=cmvPreview&&(operation.category==='inventory'||legacyDecision(state(),'operation',operation)==='purchase');
   dialog(operation.description,'<p>'+esc(inventory?purchaseName:operation.categoryName)+' · '+statuses[situation(operation,isoDay())]+'</p>'+
    '<dl class="ops-details"><div><dt>'+(inventory?'Data da aquisição':'Competência')+'</dt><dd>'+displayDay(operation.date)+'</dd></div><div><dt>Vencimento</dt><dd>'+displayDay(operation.due)+'</dd></div>'+
    '<div><dt>Valor</dt><dd class="financial-value">'+displayAmount(operation.amount)+'</dd></div><div><dt>Em aberto</dt><dd class="financial-value">'+displayAmount(remaining(operation))+'</dd></div></dl>'+
    '<h3>Histórico de baixas</h3>'+(entries.length?'<ul class="ops-payments">'+entries.join('')+'</ul>':'<p>Nenhuma baixa registrada.</p>')+
    (!operation.cancelled?'<div class="ops-actions"><button type="button" class="secondary" data-action="edit-operation" data-id="'+esc(operation.id)+'">Editar operação</button>'+
      (remaining(operation)?'<button type="button" class="primary" data-action="settle" data-id="'+esc(operation.id)+'">Registrar baixa</button>':'')+
      (!paid(operation)?'<button type="button" class="secondary negative" data-action="cancel" data-id="'+esc(operation.id)+'">Cancelar operação</button>':'')+'</div>':''));
 }
 function account(id) {
   const previous=profile().accounts.find(a=>a.id===id);
   const revision=book.revision;
   dialog(previous?'Editar conta financeira':'Nova conta financeira',
     field('name','Nome da conta','text',previous?.name,'maxlength="60" placeholder="Ex.: Banco ou Caixa físico"')+
     moneyField('opening','Saldo inicial (R$)',fieldAmount(previous?.opening||0))+
     '<label>Data de referência (opcional)<input type="date" name="date" value="'+esc(previous?.date)+'" max="'+isoDay()+'"></label>'+
     '<p class="hint">Informe o saldo antes das movimentações da data de referência. Sem data, o saldo é anterior ao primeiro lançamento.</p>',
     values=>run('save-account',{...values,id:previous?.id||crypto.randomUUID(),opening:cents(values.opening,{signed:true})},revision));
 }
 function category(id) {
   const previous=profile().categories.find(c=>c.id===id);
   const revision=book.revision;
   dialog(previous?'Editar categoria':'Nova categoria',
     field('name','Nome','text',previous?.name,'maxlength="60"')+select('category','Classificação financeira',categoryOptions)+
     '<p class="hint">O nome também é atualizado nas movimentações vinculadas. A classificação escolhida vale para operações novas.</p>',
     values=>run('save-category',{...values,id:previous?.id||crypto.randomUUID()},revision));
   $('ops-form').elements.category.value=previous?.category||'admin';
 }
 function deleteCategory(id) {
   const category=profile().categories.find(c=>c.id===id);
   if(!category)throw Error('Categoria personalizada indisponível.');
   const revision=book.revision;
   const usage=categoryUsage(state(),companyId(),id);
   const count=[...usage.values()].reduce((sum,n)=>sum+n,0);
   const replacements=[...usage].map(([classification,total])=>{
     const standard=M.map[classification].name;
     const choices=profile().categories.filter(c=>c.id!==id&&c.category===classification);
     const label=usage.size===1?'Categoria de destino':standard+' ('+total+')';
     return select(classification,label,option('','Escolha uma categoria')+
       choices.map(c=>option(c.id,c.name)).join('')+option(classification,standard+' · padrão'));
   }).join('');
   dialog('Excluir categoria', '<p>Confirma a exclusão de <strong>'+esc(category.name)+'</strong>?</p>'+
     (count?'<p>'+count+(count===1?' movimentação vinculada será transferida.':' movimentações vinculadas serão transferidas.')+
       ' Os valores, as baixas e a classificação da DRE serão preservados.</p>'+replacements:
       '<p>Esta categoria não possui movimentações vinculadas.</p>')+
     '<button type="button" class="secondary" id="ops-cancel-delete">Voltar</button>',
     async destinations=>{
       await run('delete-category',{id,destinations},revision);
       if(filter.category===id)filter.category='';
       return count?'Categoria excluída e movimentações transferidas.':'Categoria excluída.';
     },count?'Transferir e excluir':'Excluir categoria');
   $('ops-cancel-delete').onclick=()=>$('ops-dialog').close();
   $('ops-submit').classList.add('danger-button');
 }
 function transfer() {
   const revision=book.revision, id=crypto.randomUUID();
   dialog('Transferir entre contas',
     select('from','Origem',option('','Selecione')+accountOptions())+select('to','Destino',option('','Selecione')+accountOptions())+
     '<div class="form-grid">'+moneyField('amount','Valor (R$)')+field('date','Data efetiva','date',isoDay(),'max="'+isoDay()+'"')+'</div>'+
     '<p class="hint">O saldo muda entre as contas. O total de caixa e a DRE não mudam.</p>',
     values=>run('transfer',{...values,id,amount:cents(values.amount)},revision),'Registrar transferência');
 }
 async function action(event) {
   const button=event.target.closest('[data-action]');
   if(!button)return;
   const {action,id,payment}=button.dataset;
   const operation=byId(id);
   try {
     switch(action){
       case 'new-operation':newOperation();break;
       case 'edit-operation':newOperation(operation);break;
       case 'settle':settlement(operation);break;
       case 'details':details(operation);break;
       case 'reverse':
         if(confirm('Estornar esta baixa e reabrir o valor?')){await run('reverse',{id,paymentId:payment});details(byId(id));toast('Baixa estornada.');}
         break;
       case 'cancel':
         if(confirm('Cancelar a operação? Ela sairá das previsões e da DRE, e o histórico será preservado.')){await run('cancel',{id});$('ops-dialog').close();toast('Operação cancelada.');}
         break;
       case 'range':range=Number(id);draw();break;
       case 'month-back':month=M.shift(month,-1);draw();break;
       case 'month-today':month=isoDay().slice(0,7);draw();break;
       case 'month-next':month=M.shift(month,1);draw();break;
       case 'company':$('cash-company-edit').click();break;
       case 'account':account(id);break;
       case 'category':category(id);break;
       case 'delete-category':deleteCategory(id);break;
       case 'transfer':transfer();break;
       case 'undo-transfer':
         if(confirm('Estornar esta transferência e recompor os dois saldos?')){await run('reverse-transfer',{id});toast('Transferência estornada.');}
         break;
       case 'backup':
         button.disabled=true;
         try{await exportAccount();toast('Backup exportado.');}finally{button.disabled=false;}
         break;
     }
   }catch(error){if($('ops-dialog').open)$('ops-error').textContent=error.message;else toast(error.message);}
 }
 panel.addEventListener('click',action);
 $('ops-dialog').addEventListener('click',action);
 panel.addEventListener('change',event=>{
   const key=event.target.id.replace(/^ops-/,'');
   if(key==='company'){filter={from:'',to:'',status:'',category:'',type:''};businesses.select(event.target.value);draw();}
   if(!Object.hasOwn(filter,key))return;
   filter[key]=event.target.value;
   if(area==='operations')$('ops-list').innerHTML=operationList();
   else {
     draw();
     $('ops-'+key)?.focus();
   }
 });
 panel.addEventListener('submit',async event=>{
   if(event.target.id!=='ops-preferences')return;
   event.preventDefault();
   const data=Object.fromEntries(new FormData(event.target));
   try {
     await run('preferences',{alertDays:Number(data.alertDays)});
     preferences={theme:data.theme,period:data.period,date:data.date,amount:data.amount};
     localStorage.setItem(preferenceKey,JSON.stringify(preferences));
     loadPreferences();
     draw();
     toast('Preferências salvas.');
   }catch(error){toast(error.message);}
 });
 $('ops-close').onclick=()=>$('ops-dialog').close();
 $('ops-form').onsubmit=async event=>{
   event.preventDefault();
   if(!submit||busy)return;
   $('ops-submit').disabled=true;
   const values=Object.fromEntries(new FormData(event.target));
   try{const message=await submit(values);$('ops-dialog').close();toast(message||'Alteração salva.');}
   catch(error){$('ops-error').textContent=error.message;}
   finally{$('ops-submit').disabled=false;}
 };
 return {load,refresh,openArea,repaint:draw,pending,enabled:()=>enabled,period:()=>preferences.period,
   cash:()=>cashOperations(state()), dre:document=>dreOperations(state(),document,cmvPreview),
   cmvEnabled:()=>cmvPreview, getBook:()=>book, isSaving:()=>busy,
   acceptBook:saved=>{book=saved;},
   advanceRevision:(previous,next)=>{if(book.revision===previous)book={...book,revision:next};},
   saveInventory:(command,revision)=>run(command.action,command,revision),
   accounts:id=>currentProfile(state(),id).accounts,
   balances:(rows,from,to)=>cashBalances(state(),companyId(),rows,from,to),
   accountDefault:defaultAccount};
}
