import {M} from './dre-model.js';

'use strict';

const $=id=>document.getElementById(id);
const api=(method='GET',body)=>{if(window.parent===window||typeof window.parent.caixaDreRequest!=='function')throw Error('Abra a DRE pelo menu do Caixa Claro e entre na sua conta.');return window.parent.caixaDreRequest(method,body);};
let revision=0,saving=false;

const esc=v=>String(v).replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

const money=n=>(n/100).toLocaleString('pt-BR',{
  style:'currency',currency:'BRL'
});

const pct=n=>n===null?'—':n.toLocaleString('pt-BR',{
  minimumFractionDigits:1,maximumFractionDigits:1
})+'%';

const label=m=>new Date(
  +m.slice(0,4),+m.slice(5)-1,1,12
).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});

const now=()=>new Date().getFullYear()+'-'+
  String(new Date().getMonth()+1).padStart(2,'0');

let month=now(),company='all',ytd=false,view='dashboard',
  page=1,writable=true,db,action,timer;

const defaults=()=>({version:1,mode:'real',real:M.empty(),demo:M.demo(now())});
db=defaults();
window.dreNeedsReload=true;
try{
  const saved=await api();
  M.validate(saved.document);
  db.real=saved.document;
  revision=saved.revision;
  window.dreNeedsReload=false;
}catch(error){
  writable=false;
  queueMicrotask(()=>warn('Não foi possível carregar a DRE. Seus dados não foram substituídos. '+error.message+' Reabra esta área para tentar novamente.'));
}
$('dre-main').setAttribute('aria-busy','false');

const data=()=>db[db.mode];
const name=id=>data().companies.find(c=>c.id===id)?.name||'Empresa';
const previous=()=>ytd
  ?(+month.slice(0,4)-1)+month.slice(4)
  :M.shift(month,-1);
const scope=()=>company==='all'?'Todas as empresas':name(company);
const period=()=>ytd?'Acumulado de janeiro até '+label(month):label(month);

function toast(t){
  clearTimeout(timer);
  $('toast').textContent=t;
  $('toast').hidden=false;
  timer=setTimeout(()=>$('toast').hidden=true,6500);
}

function warn(t){
  $('warning').hidden=false;
  $('warning').textContent=t;
}

async function save(){
  if(db.mode==='demo')return;
  const result=await api('PUT',{revision,document:db.real});
  revision=result.revision;
}

async function mutate(fn){
  if(!writable){window.dreNeedsReload=true;toast('Os dados não foram carregados. Reabra a DRE para tentar novamente.');return false;}
  if(saving){toast('Aguarde o salvamento.');return false;}
  const old=JSON.parse(JSON.stringify(db));
  saving=true;
  document.body.inert=true;
  $('dre-main').setAttribute('aria-busy','true');
  try{
    fn();
    M.validate(data());
    await save();
    render();
    return true;
  }catch(error){
    db=old;
    if(error.status===409){
      try{const fresh=await api();M.validate(fresh.document);db.real=fresh.document;revision=fresh.revision;render();}catch{writable=false;window.dreNeedsReload=true;warn('Reabra a DRE para carregar os dados atualizados.');}
    }
    if(error.status===401){writable=false;window.dreNeedsReload=true;warn('Sua sessão terminou. Entre novamente na sua conta.');}
    toast(error.message);
    return false;
  }finally{
    saving=false;
    document.body.inert=false;
    $('dre-main').setAttribute('aria-busy','false');
  }
}

function ask(t,fn){
  $('confirm-text').textContent=t;
  action=fn;
  $('confirm-dialog').showModal();
}

$('confirm').onclick=()=>{
  $('confirm-dialog').close();
  const fn=action;
  action=null;
  fn?.();
};

function show(v){
  view=v;
  page=1;
  render();
}

function render(){
  if(company!=='all'&&!data().companies.some(c=>c.id===company))
    company='all';

  const options=data().companies.map(c=>
    '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'
  ).join('');

  $('company').innerHTML=
    '<option value="all">Todas as empresas</option>'+options;
  $('company').value=company;
  $('month').value=month;
  $('ytd').checked=ytd;

  $('mode-label').textContent=db.mode==='demo'
    ?'DEMONSTRAÇÃO · Dados fictícios, separados dos seus dados.'
    :'MEUS DADOS · DRE da sua conta, separada do fluxo de caixa.';

  document.querySelector('.banner').classList.toggle('real',db.mode==='real');
  $('mode').textContent=db.mode==='demo'
    ?'Usar meus dados →':'Ver demonstração →';

  const empty=!data().companies.length;
  $('empty').hidden=!empty;
  $('cards').hidden=empty;
  $('csv').disabled=empty;

  ['dashboard','dre-view','ledger-view','companies-view'].forEach(id=>{
    $(id).hidden=id!==view||empty;
  });

  document.querySelectorAll('nav [data-view]').forEach(b=>{
    b.classList.toggle('active',b.dataset.view===view);
    b.setAttribute('aria-pressed',String(b.dataset.view===view));
  });

  const r=M.report(data(),company,month,ytd);
  const old=M.report(data(),company,previous(),ytd);

  for(const [id,n]of [
    ['revenue',r.netRevenue],['expenses',r.expenses],['profit',r.profit]
  ])$(id).textContent=money(n);

  $('profit').className=r.profit<0?'neg':'pos';
  $('profit-label').textContent=r.profit<0?'Prejuízo líquido':'Lucro líquido';
  $('margin').textContent=pct(r.margin);
  $('margin').className=r.margin!==null&&r.margin<0?'neg':'';

  $('insight').textContent=!r.count
    ?'Nenhum lançamento de resultado neste período. Inclua os dados antes de avaliar o lucro.'
    :r.profit<0
      ?'Os gastos superaram as receitas em '+money(-r.profit)+
        '. Veja a DRE para identificar os grupos que pesaram no resultado.'
      :'O resultado líquido foi de '+money(r.profit)+
        (r.margin===null?'.':
        ', equivalente a '+pct(r.margin)+' da receita líquida.');

  $('period-name').textContent=period();

  const cs=company==='all'
    ?data().companies
    :data().companies.filter(c=>c.id===company);

  $('portfolio').innerHTML=cs.map(c=>{
    const a=M.report(data(),c.id,month,ytd);
    return '<tr><td><button class="link" data-company="'+esc(c.id)+'">'+
      esc(c.name)+'</button><small>'+esc(c.sector)+'</small></td>'+
      '<td class="num">'+money(a.netRevenue)+'</td>'+
      '<td class="num">'+money(a.expenses)+'</td>'+
      '<td class="num '+(a.profit<0?'neg':'pos')+'">'+money(a.profit)+
      (a.count?'':'<small>Sem lançamentos</small>')+'</td>'+
      '<td>'+pct(a.margin)+'</td></tr>';
  }).join('');

  const series=Array.from({length:6},(_,i)=>{
    const m=M.shift(month,i-5);
    return {m,r:M.report(data(),company,m)};
  });
  const max=Math.max(
    1,...series.flatMap(x=>[x.r.netRevenue,x.r.expenses])
  );

  $('chart').innerHTML=series.map(x=>
    '<div class="column"><div class="bars" role="img" aria-label="'+
    esc(label(x.m)+': receita '+money(x.r.netRevenue)+
      ', gastos '+money(x.r.expenses))+'">'+
    '<div class="bar" title="'+esc(money(x.r.netRevenue))+
    '" style="height:'+Math.max(0,x.r.netRevenue/max*100)+'%"></div>'+
    '<div class="bar cost" title="'+esc(money(x.r.expenses))+
    '" style="height:'+x.r.expenses/max*100+'%"></div></div>'+
    '<button data-month="'+x.m+'">'+
    esc(new Date(+x.m.slice(0,4),+x.m.slice(5)-1,1)
      .toLocaleDateString('pt-BR',{month:'short'}))+
    '</button></div>'
  ).join('');

  $('report-title').textContent='DRE · '+scope();
  $('report-period').textContent=period()+' · BRL · Competência'+
    (db.mode==='demo'?' · DADOS FICTÍCIOS':'');

  $('heading-current').textContent=(ytd?'Acum. até ':'')+label(month);
  $('heading-old').textContent=(ytd?'Acum. até ':'')+label(previous());

  const rows=M.rows(r,$('details').checked);
  const before=M.rows(old,$('details').checked);

  $('report').innerHTML=rows.map((a,i)=>
    '<tr class="'+a.kind+'"><td>'+esc(a.label)+'</td>'+
    '<td class="num '+(a.kind==='final'&&a.value<0?'neg':'')+'">'+
    money(a.value)+'</td><td class="num">'+money(before[i].value)+
    '</td><td class="num">'+
    pct(r.netRevenue>0?a.value/r.netRevenue*100:null)+'</td></tr>'
  ).join('');

  $('outside').textContent=r.outsideCount+
    ' movimentação(ões) patrimonial(is) fora da DRE neste período.';

  renderLedger();

  $('companies').innerHTML=data().companies.map(c=>{
    const a=M.report(data(),c.id,month,ytd);
    return '<article class="company-card"><h2>'+esc(c.name)+
      '</h2><p class="muted">'+esc(c.sector||'Setor não informado')+
      '</p><div class="result '+(a.profit<0?'neg':'pos')+'">'+
      money(a.profit)+'</div><div class="actions">'+
      '<button class="link" data-company="'+esc(c.id)+'">Ver DRE →</button>'+
      '<button class="link" data-edit-company="'+esc(c.id)+'">Editar</button>'+
      '<button class="link" data-delete-company="'+esc(c.id)+
      '">Excluir</button></div></article>';
  }).join('');
}

function entries(){
  const q=$('search').value.trim().toLowerCase();
  return M.selected(data(),company,month,ytd)
    .slice().reverse()
    .filter(e=>(e.description+' '+M.map[e.category].name)
      .toLowerCase().includes(q))
    .sort((a,b)=>b.date.localeCompare(a.date));
}

function renderLedger(){
  const list=entries();
  const pages=Math.max(1,Math.ceil(list.length/12));
  page=Math.max(1,Math.min(page,pages));

  $('ledger').innerHTML=list.slice((page-1)*12,page*12).map(e=>
    '<tr><td>'+e.date.split('-').reverse().join('/')+'</td><td>'+
    esc(e.description)+'<small>'+esc(M.map[e.category].name)+
    (M.map[e.category].group==='outside'?' · FORA DA DRE':'')+
    '</small></td><td>'+esc(name(e.company))+'</td>'+
    '<td class="num">'+money(e.amount)+'</td><td><div class="actions">'+
    '<button class="link" data-edit-entry="'+esc(e.id)+'">Editar</button>'+
    '<button class="link" data-delete-entry="'+esc(e.id)+
    '">Excluir</button></div></td></tr>'
  ).join('')||
    '<tr><td colspan="5">Nenhum lançamento encontrado neste período.</td></tr>';

  $('pager').hidden=pages<=1;
  $('pager').innerHTML=
    '<button class="btn" data-page="-1" '+
    (page===1?'disabled':'')+'>← Anterior</button><span>'+
    page+' / '+pages+'</span>'+
    '<button class="btn" data-page="1" '+
    (page===pages?'disabled':'')+'>Próxima →</button>';
}

function openCompany(c){
  $('company-id').value=c?.id||'';
  $('company-name').value=c?.name||'';
  $('company-sector').value=c?.sector||'';
  $('company-dialog').showModal();
}

function hint(){
  $('entry-hint').textContent=M.map[$('entry-category').value].hint;
}

function openEntry(e){
  if(!data().companies.length){
    toast('Cadastre uma empresa antes do lançamento.');
    openCompany();
    return;
  }
  $('entry-id').value=e?.id||'';
  $('entry-company').innerHTML=data().companies.map(c=>
    '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'
  ).join('');
  $('entry-company').value=e?.company||
    (company==='all'?data().companies[0].id:company);
  $('entry-description').value=e?.description||'';
  $('entry-category').value=e?.category||'sales';
  $('entry-amount').value=e?(e.amount/100).toFixed(2).replace('.',','):'';
  $('entry-date').value=e?.date||month+'-01';
  hint();
  $('entry-dialog').showModal();
}

$('entry-form').onsubmit=async event=>{
  event.preventDefault();
  let e;
  const ok=await mutate(()=>{
    e={
      id:$('entry-id').value||M.uid(),
      company:$('entry-company').value,
      description:$('entry-description').value.trim(),
      category:$('entry-category').value,
      date:$('entry-date').value,
      amount:M.cents($('entry-amount').value)
    };
    const i=data().entries.findIndex(x=>x.id===e.id);
    if(i<0)data().entries.push(e);
    else data().entries[i]=e;
  });
  if(ok){
    $('entry-dialog').close();
    month=e.date.slice(0,7);
    if(company!=='all')company=e.company;
    page=1;
    render();
    toast('Lançamento salvo. Resultado atualizado.');
  }
};

$('company-form').onsubmit=async event=>{
  event.preventDefault();
  if(await mutate(()=>{
    const c={
      id:$('company-id').value||M.uid(),
      name:$('company-name').value.trim(),
      sector:$('company-sector').value.trim()
    };
    const i=data().companies.findIndex(x=>x.id===c.id);
    if(i<0)data().companies.push(c);
    else data().companies[i]=c;
  })){
    $('company-dialog').close();
    toast('Empresa salva.');
  }
};

document.addEventListener('click',event=>{
  const b=event.target.closest('button');
  if(!b)return;

  if(b.dataset.view){show(b.dataset.view);return;}
  if(b.hasAttribute('data-close')){b.closest('dialog').close();return;}
  if(b.hasAttribute('data-new-company')){openCompany();return;}

  if(b.dataset.company){
    company=b.dataset.company;
    show('dre-view');
    return;
  }

  if(b.dataset.month){
    month=b.dataset.month;
    ytd=false;
    page=1;
    render();
    return;
  }

  if(b.dataset.page){
    page+=+b.dataset.page;
    renderLedger();
    return;
  }

  if(b.dataset.editEntry){
    openEntry(data().entries.find(e=>e.id===b.dataset.editEntry));
    return;
  }

  if(b.dataset.deleteEntry){
    const id=b.dataset.deleteEntry;
    ask('Excluir o lançamento e recalcular a DRE? A ação não pode ser desfeita.',
      ()=>mutate(()=>{
        data().entries=data().entries.filter(e=>e.id!==id);
      }));
    return;
  }

  if(b.dataset.editCompany){
    openCompany(data().companies.find(c=>c.id===b.dataset.editCompany));
    return;
  }

  if(b.dataset.deleteCompany){
    const id=b.dataset.deleteCompany;
    if(data().entries.some(e=>e.company===id)){
      toast('A empresa possui lançamentos. Remova-os antes de excluir o cadastro.');
      return;
    }
    ask('Excluir esta empresa sem lançamentos?',()=>mutate(()=>{
      data().companies=data().companies.filter(c=>c.id!==id);
    }));
  }
});

$('company').onchange=()=>{
  company=$('company').value;
  page=1;
  render();
};

$('month').onchange=()=>{
  const m=$('month').value;
  if(!M.monthValid(m)||m<'1901-01'||m>'2198-12'){
    toast('Escolha um mês entre 1901 e 2198.');
    $('month').value=month;
    return;
  }
  month=m;
  page=1;
  render();
};

$('ytd').onchange=()=>{
  ytd=$('ytd').checked;
  page=1;
  render();
};

$('details').onchange=render;
$('search').oninput=()=>{page=1;renderLedger();};
$('entry-category').onchange=hint;
$('add').onclick=()=>openEntry();
$('print').onclick=()=>window.print();

$('mode').onclick=()=>{
  db.mode=db.mode==='demo'?'real':'demo';
  company='all';
  page=1;
  render();
};

function download(content,file,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement('a');
  a.href=url;
  a.download=file;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

$('export').onclick=()=>download(
  JSON.stringify(data(),null,2),
  'caixa-claro-dre-backup-'+db.mode+'.json',
  'application/json'
);

$('import').onclick=()=>$('file').click();

$('file').onchange=async()=>{
  const f=$('file').files[0];
  if(!f)return;
  try{
    if(f.size>8*1024*1024)throw Error('Máximo: 8 MB.');
    const imported=M.validate(JSON.parse(await f.text()));
    const mode=db.mode;
    ask(
      'Substituir os dados do modo '+
      (mode==='demo'?'Demonstração':'Meus dados')+
      ' por este backup? Exporte os atuais antes de confirmar.',
      async ()=>{
        db.mode=mode;
        if(await mutate(()=>{
          db[mode]=imported;
          company='all';
          page=1;
        }))toast('Backup restaurado.');
      }
    );
  }catch(e){
    toast(e.message);
  }finally{
    $('file').value='';
  }
};

function csvCell(v){
  let s=String(v??'');
  if(/^[\s]*[=+@\-\t\r]/.test(s)&&!/^-?\d+(,\d+)?$/.test(s))
    s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}

$('csv').onclick=()=>{
  const r=M.report(data(),company,month,ytd);
  const rows=[
    ['Caixa Claro · DRE',db.mode==='demo'?'DADOS FICTÍCIOS':'DRE gerencial'],
    ['Empresa',scope()],
    ['Período',period()],
    ['Base','Competência / BRL']
  ];

  if(view==='ledger-view'){
    rows.push([
      'Competência','Descrição','Empresa',
      'Categoria','Valor (R$)','Participação'
    ]);
    entries().forEach(e=>rows.push([
      e.date,e.description,name(e.company),M.map[e.category].name,
      (e.amount/100).toFixed(2).replace('.',','),
      M.map[e.category].group==='outside'?'Fora da DRE':'Resultado'
    ]));
  }else{
    rows.push(['Tipo de linha','Descrição','Valor (R$)']);
    M.rows(r,true).forEach(a=>rows.push([
      a.kind,a.label,(a.value/100).toFixed(2).replace('.',',')
    ]));
    rows.push([
      'Observação',
      'Detalhes e subtotais: não some todas as linhas. Consolidado sem eliminação entre empresas.'
    ]);
  }

  download(
    '\ufeff'+rows.map(a=>a.map(csvCell).join(';')).join('\r\n'),
    'caixa-claro-dre-'+month+'.csv',
    'text/csv;charset=utf-8'
  );
};

$('entry-category').innerHTML=M.cats.map(c=>
  '<option value="'+c.id+'">'+
  (c.group==='outside'?'Fora da DRE · ':'')+c.name+'</option>'
).join('');

render();
if(!writable)warn('Não foi possível carregar sua DRE. A edição foi bloqueada para preservar os dados. Reabra esta área após verificar a conexão e a configuração no Supabase.');
