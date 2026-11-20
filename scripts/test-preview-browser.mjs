import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createUser,makeServer} from '../auth-server.js';
import {addDays,isoDay} from '../public/operations-model.js';
import {M} from '../public/dre-model.js';
import {createPublicServer} from '../server/node-server.js';
import {platformDatabase} from '../test-support/platform-db.js';
import {seedProvider,testConfig} from '../test-support/provider.js';

const folder=await mkdtemp(join(tmpdir(),'caixaclaro-preview-'));
const hosted=process.env.CAIXA_TEST_HOSTED==='1';
const book={version:1,companies:[{id:'empresa-teste',name:'Empresa de Teste',sector:''}],entries:[]};
let platform,server,config,password;
if(hosted){
 platform=await platformDatabase();
 const seed=await seedProvider(platform);
 password=seed.password;
 config=testConfig({origin:'http://127.0.0.1'});
 server=createPublicServer(config,{provider:seed.provider,logger:()=>{}});
}else{
 const local=makeServer({database:join(folder,'test.sqlite'),preview:true,production:false});
 server=local.server;
 createUser(local.db,'demonstracao','CaixaTeste2026');
 local.db.prepare('INSERT INTO dre_books VALUES(1,1,?)').run(JSON.stringify(book));
}
server.listen(0,'127.0.0.1');
await once(server,'listening');
const url='http://127.0.0.1:'+server.address().port;
if(config)config.origin=url;
let browser;
try {
 browser=await chromium.launch({headless:true,...(process.env.CAIXA_TEST_BROWSER?{executablePath:process.env.CAIXA_TEST_BROWSER}:{})});
 const context=await browser.newContext({viewport:{width:1365,height:900},acceptDownloads:true});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);
 const signIn=async ()=>{
  if(!hosted){await page.locator('#preview-enter').click();return;}
  const response=await context.request.post(url+'/api/login',{headers:{Origin:url},data:{username:'yan',password}});
  assert.equal(response.ok(),true);
  await page.reload();
 };
 if(hosted){
  await signIn();
  assert.equal((await context.request.put(url+'/api/dre',{headers:{Origin:url},data:{revision:0,document:book}})).ok(),true);
  await page.reload();
 }else await signIn();
 await page.locator('#closing').waitFor();
 const month=isoDay().slice(0,7);
 const prior=M.shift(month,-1);
 const today=isoDay();
 const due=addDays(today,4);
 const content=async (selector,pattern,target=page)=>{
  await target.locator(selector).filter({hasText:pattern}).waitFor({timeout:7000});
 };
 const ops=page.locator('#ops-dialog');
 const fields=async values=>{
  for(const [name,value] of Object.entries(values)){
   const element=ops.locator('[name="'+name+'"]');
   const tag=await element.evaluate(el=>el.tagName);
   await (tag==='SELECT'?element.selectOption(value):element.fill(value));
  }
 };
 const clickAction=(action,scope=page)=>scope.locator('[data-action="'+action+'"]').first().click();
 const submit=async ()=>{
  await ops.locator('#ops-submit').click();
  try{await ops.waitFor({state:'hidden',timeout:7000});}
  catch(error){
   console.error('Formulário:',await ops.locator('#ops-error').textContent(),await ops.locator('form').evaluate(form=>
    [...form.elements].filter(el=>el.willValidate&&!el.validity.valid).map(el=>el.name+': '+el.validationMessage)));
   throw error;
  }
 };
 const createCategory=async (name,category)=>{
  await page.locator('#settings-open').click();
  await clickAction('category');
  await fields({name,category});
  await submit();
  return page.getByRole('button',{name:'Editar categoria '+name,exact:true}).getAttribute('data-id');
 };
 const createOperation=async values=>{
  await page.locator('#ops-open').click();
  await clickAction('new-operation');
  await fields(values);
  await submit();
 };
 const categoryId=await createCategory('Venda em parceria','sales');
 const destination=await createCategory('Vendas digitais','sales');
 await page.getByRole('button',{name:'Editar categoria Venda em parceria',exact:true}).click();
 await fields({name:'Vendas de parceiros'});
 await submit();
 assert.equal(await page.getByRole('button',{name:'Editar categoria Vendas de parceiros',exact:true}).count(),1);
 await page.locator('#ops-open').click();
 await clickAction('new-operation');
 await fields({description:'Venda de teste a prazo',category:categoryId,amount:'R$ 10.000,00',date:prior+'-05',due});
 await submit();
 await content('#ops-list',/Pendente/);
 await page.locator('[data-view="overview"]').click();
 await content('#income',/0,00/);
 await page.locator('#dre-open').click();
 const dre=page.frameLocator('#dre-frame');
 await dre.locator('#month').fill(prior);
 await content('#revenue',/10\.000,00/,dre);
 await page.locator('#ops-open').click();
 await clickAction('settle',page.locator('#ops-list'));
 await fields({amount:'6.000,00',date:today,account:'caixa-geral',method:'Pix'});
 await submit();
 await content('#ops-list',/Parcial/);
 await content('#ops-list',/4\.000,00/);
 await page.locator('#settings-open').click();
 await page.getByRole('button',{name:'Excluir categoria Vendas de parceiros',exact:true}).click();
 await content('#ops-dialog',/1 movimentação vinculada/);
 await ops.locator('#ops-submit').click();
 assert.equal(await ops.locator('[name="sales"]').evaluate(select=>select.validity.valueMissing),true);
 await ops.locator('#ops-cancel-delete').click();
 await page.getByRole('button',{name:'Excluir categoria Vendas de parceiros',exact:true}).click();
 await fields({sales:destination});
 await submit();
 assert.equal(await page.getByRole('button',{name:'Editar categoria Vendas de parceiros',exact:true}).count(),0);
 const unused=await createCategory('Grupo sem movimentações','admin');
 await page.locator('[data-action="delete-category"][data-id="'+unused+'"]').click();
 await content('#ops-dialog',/não possui movimentações vinculadas/);
 await submit();
 assert.equal(await page.locator('[data-action="delete-category"][data-id="'+unused+'"]').count(),0);
 await page.locator('#ops-open').click();
 await content('#ops-list',/Vendas digitais/);
 await content('#ops-list',/Parcial/);
 await page.locator('[data-view="overview"]').click();
 await content('#income',/6\.000,00/);
 await page.locator('#settings-open').click();
 await clickAction('account');
 await fields({name:'Banco de Teste',opening:'1.200,50',date:today});
 await submit();
 await content('#operations-area',/Banco de Teste/);
 await clickAction('transfer');
 const bank=await ops.locator('[name="to"] option').filter({hasText:'Banco de Teste'}).getAttribute('value');
 await fields({from:'caixa-geral',to:bank,amount:'500,00',date:today});
 await submit();
 await content('#operations-area',/1\.700,50/);
 const backupDownload=page.waitForEvent('download');
 await clickAction('backup');
 const backup=JSON.parse(await readFile(await (await backupDownload).path(),'utf8'));
 assert.equal(backup.operations.document.transfers.length,1);
 assert.equal(backup.operations.document.operations[0].payments[0].amount,600_000);
 assert.equal(backup.operations.document.operations[0].categoryId,destination);
 await page.locator('[data-view="overview"]').click();
 await content('#closing',/7\.200,50/);
 await page.locator('#agenda-open').click();
 await content('#operations-area',/Saldo previsto em 15 dias/);
 await content('#operations-area',/11\.200,50/);
 await createOperation({description:'Fornecedor a vencer',category:'inventory',amount:'17.000,00',date:today,due:addDays(today,10)});
 await createOperation({description:'Serviço a receber',category:'services',amount:'20.000,00',date:today,due:addDays(today,22)});
 await page.locator('#agenda-open').click();
 for(const [range,total] of [[7,/11\.200,50/],[15,/-\s*R\$\s*5\.799,50/],[30,/14\.200,50/]]){
  await page.locator('[data-action="range"][data-id="'+range+'"]').click();
  await content('.ops-projection',total);
  if(range===15)await content('.ops-warning',/Possível falta de caixa/);
 }
 await page.locator('[data-view="history"]').click();
 await page.locator('#new').click();
 const cash=page.locator('#form');
 await cash.locator('[name="type"]').selectOption('expense');
 await cash.locator('[name="description"]').fill('Despesa de teste');
 await cash.locator('[name="amount"]').fill('R$ 1.200,50');
 await cash.locator('[name="date"]').fill(today);
 await cash.locator('button[type="submit"], button.full').click();
 await page.locator('#modal').waitFor({state:'hidden'});
 const downloaded=page.waitForEvent('download');
 await page.locator('#export').click();
 const csv=await readFile(await (await downloaded).path(),'utf8');
 assert.match(csv,/;"";"Despesa de teste";"Saída"/);
 assert.match(csv,/;"Venda de teste a prazo";"Entrada"/);
 assert.match(csv,/"Vendas digitais";"Pix";"6000,00"/);
 await content('#title',/Histórico do caixa/);
 await content('#new',/Registrar no caixa/);
 await page.locator('#cash-movement-filter').selectOption('expense');
 assert.equal(await page.locator('#rows tr').count(),1);
 await page.locator('#cash-category-filter').selectOption('Fornecedores');
 await content('#rows',/Despesa de teste/);
 await page.locator('#search').fill('inexistente');
 assert.equal(await page.locator('#rows tr').count(),0);
 await page.locator('#search').fill('despesa');
 await page.getByRole('button',{name:'Editar Despesa de teste'}).click();
 await cash.locator('[name="amount"]').fill('1.250,50');
 await cash.locator('button.full').click();
 await page.locator('#modal').waitFor({state:'hidden'});
 await content('#rows',/1\.250,50/);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Excluir Despesa de teste'}).click();
 await page.locator('#toast').getByRole('button',{name:'Desfazer'}).waitFor();
 assert.equal(await page.locator('#rows tr').count(),0);
 await page.locator('#toast').getByRole('button',{name:'Desfazer'}).click();
 await content('#rows',/1\.250,50/);
 await page.reload();
 await content('#closing',/5\.950,00/);
 await page.locator('#dre-open').click();
 await dre.locator('#month').fill(prior);
 await content('#revenue',/10\.000,00/,dre);
 await dre.getByRole('button',{name:'Lançamentos',exact:true}).click();
 await content('#ledger',/Gerenciado em Contas/,dre);

 await createOperation({description:'Venda de valor elevado',category:'sales',amount:'R$ 10.000.000.000,00',date:today,due:today});
 const hugeRow=page.locator('#ops-list tr').filter({hasText:'Venda de valor elevado'});
 await clickAction('settle',hugeRow);
 await fields({amount:'10.000.000.000,00',date:today,account:'caixa-geral',method:'Pix'});
 await submit();
 await content('#ops-list',/Quitada/);
 const screens=[
  ['[data-view="overview"]','#title',/Visão geral/],
  ['[data-view="history"]','#title',/Histórico/],
  ['#ops-open','#operations-area h1',/Contas a pagar/],
  ['#agenda-open','#operations-area h1',/Agenda financeira/],
  ['#settings-open','#operations-area h1',/Configurações/]
 ];
 const switchTheme=async theme=>{
  await page.locator('#settings-open').click();
  const form=page.locator('#ops-preferences');
  await form.locator('[name="theme"]').selectOption(theme);
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/operations')&&response.request().method()==='POST'&&
    response.request().postDataJSON()?.command?.action==='preferences');
  await form.getByRole('button',{name:'Salvar preferências'}).click();
  assert.equal((await saved).ok(),true);
  await content('#toast',/Preferências salvas/);
  await page.locator('html[data-theme="'+theme+'"]').waitFor();
 };
 const checkLayout=async(target=page)=>{
  const overflow=await target.locator('html').evaluate(root=>{
   const view=root.ownerDocument.defaultView;
   const wide=[...root.querySelectorAll('.financial-value')].filter(el=>
    el.getClientRects().length&&el.scrollWidth>el.clientWidth+1).map(el=>el.textContent);
   const details=root.scrollWidth>view.innerWidth?{
    width:view.innerWidth, scroll:root.scrollWidth,
    elements:[...root.querySelectorAll('body *')].filter(el=>{
     return el.getBoundingClientRect().right>view.innerWidth+1&&!el.parentElement?.closest('.table-scroll,.table-wrap,nav');
    }).slice(0,12).map(el=>el.tagName+'#'+el.id+'.'+el.className)
   }:null;
   return {page:details,values:wide};
  });
  assert.deepEqual(overflow,{page:null,values:[]});
 };
 const dark='rgb(20, 21, 23)';
 const surface='rgb(32, 34, 37)';
 for(const [theme,viewport] of ['light','dark'].flatMap(theme=>[1365,768,390,320].map(width=>[theme,width]))){
  await page.setViewportSize({width:viewport,height:900});
  await switchTheme(theme);
  for(const [button,selector,heading] of screens){
   await page.locator(button).click();
   await content(selector,heading);
   await checkLayout();
   if(button.includes('overview'))await content('#closing',/10\.000\.005\.950,00/);
   if(button.includes('history')&&viewport<=720){
    await content('#rows',/10\.000\.000\.000,00/);
    assert.equal(await page.locator('.history .table-scroll').evaluate(region=>region.scrollWidth<=region.clientWidth),true);
   }
  }
  await page.locator('#dre-open').click();
  await dre.locator('html[data-theme="'+theme+'"]').waitFor();
  await content('#revenue',/10\.000\.020\.000,00/,dre);
  await checkLayout(dre);
  for(const [tab,panel] of [['DRE detalhada','#dre-view'],['Lançamentos','#ledger-view'],['Empresas','#companies-view']]){
   await dre.getByRole('button',{name:tab,exact:true}).click();
   await dre.locator(panel).waitFor();
   await checkLayout(dre);
  }
  if(theme==='dark'){
   assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor),dark);
   assert.equal(await dre.locator('.card').first().evaluate(el=>getComputedStyle(el).backgroundColor),surface);
  }
 }
 await page.locator('#account-open').click();
 await page.locator('#account-dialog').waitFor();
 assert.equal(await page.locator('#account-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),surface);
 await page.locator('#account-close').click();
 const privacy=await context.newPage();
 await privacy.goto(url+'/privacidade.html');
 await privacy.locator('html[data-theme="dark"]').waitFor();
 assert.equal(await privacy.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),dark);
 await privacy.close();
 await page.locator('#logout').click();
 await page.locator('#login-screen').waitFor();
 assert.equal(await page.locator('#login-screen').evaluate(el=>getComputedStyle(el).backgroundColor),dark);
 await signIn();
 await page.locator('#closing').waitFor();
 await page.setViewportSize({width:390,height:844});
 if(process.env.CAIXA_TEST_SCREENSHOT) await page.screenshot({path:process.env.CAIXA_TEST_SCREENSHOT,fullPage:true});
 await switchTheme('light');
 await page.reload();
 await page.locator('html[data-theme="light"]').waitFor();
 assert.deepEqual(errors,[]);
 console.log((hosted?'API pública com PostgreSQL isolado':'Prévia local')+' verificada no Chrome em 1365, 768, 390 e 320 px. Categorias, lançamentos, projeções, temas, valores elevados, DRE, backup e persistência passaram.');
} finally {
 await browser?.close();
 server.close();
 await once(server,'close');
 await platform?.close();
 await rm(folder,{recursive:true,force:true});
}
