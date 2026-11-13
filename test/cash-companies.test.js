import {test} from 'node:test';import assert from 'node:assert/strict';
import {companyScopes,companyRecords,withCompany} from '../public/cash-model.js';import {summarize,csv} from '../public/finance.js';import {validateRecords} from '../server/validation.js';
import {platformDatabase} from '../test-support/platform-db.js';import {seedProvider,testConfig} from '../test-support/provider.js';import {createPublicApi} from '../server/public-api.js';
const companies=[{id:'a',name:'Comercial Brasil',sector:'Comércio'},{id:'b',name:'Distribuidora Horizonte',sector:'Distribuição'}];
const row=(id,amount,type='income')=>({id,amount,type,method:'Pix',description:id,category:'Vendas',date:'2026-11-01',saleDate:''});
const sample=[withCompany(row('venda-a',5000000),companies[0]),withCompany(row('despesa-a',3500000,'expense'),companies[0]),withCompany(row('venda-b',8000000),companies[1]),withCompany(row('despesa-b',6000000,'expense'),companies[1]),row('anterior',9900)];

test('caixa mantém totais, histórico, pagamentos e CSV separados por empresa; legado nunca é atribuído automaticamente',()=>{
 const a=companyRecords(sample,'a'),b=companyRecords(sample,'b');assert.equal(summarize(a).income,5000000);assert.equal(summarize(a).expense,3500000);assert.equal(summarize(a).balance,1500000);assert.equal(summarize(b).income,8000000);assert.equal(summarize(b).expense,6000000);assert.equal(summarize(b).balance,2000000);assert.equal(summarize(a).payments.Pix,5000000);
 assert.ok(csv(a).includes('venda-a'));assert.ok(!csv(a).includes('venda-b'));assert.deepEqual(companyRecords(sample,null),[]);assert.deepEqual(companyRecords(sample,''),[sample[4]]);assert.equal(companyScopes(companies,sample)[0].legacy,true);
 const next=sample.map(r=>r.company?r:withCompany(r,companies[0]));assert.equal(companyRecords(next,'a').length,3);assert.deepEqual(companyRecords(next,'b'),b);assert.equal(sample[4].company,undefined);
});

test('renomear ou remover cadastro da DRE preserva a identidade e o histórico do caixa',()=>{
 const renamed=companyScopes([{...companies[0],name:'Novo nome'},companies[1]],sample);assert.equal(renamed.find(c=>c.id==='a').name,'Novo nome');
 const removed=companyScopes([companies[1]],sample);assert.equal(removed.find(c=>c.id==='a').archived,true);assert.equal(removed.find(c=>c.id==='a').name,'Comercial Brasil');assert.equal(summarize(companyRecords(sample,'a')).balance,1500000);assert.equal(summarize(companyRecords(sample,'b')).balance,2000000);
});

test('validação preserva empresa e cópias antigas, mas rejeita metadados de empresa malformados',()=>{
 assert.deepEqual(validateRecords(sample),sample);for(const change of [{company:null},{company:3},{company:{}},{company:''},{company:'a'.repeat(101)},{companyName:3},{companyName:'a'.repeat(81)}])assert.throws(()=>validateRecords([{...sample[0],...change}]));
 assert.throws(()=>validateRecords([{...row('legacy',100),companyName:'Sem id'}]));assert.equal(Object.hasOwn(validateRecords([sample[4]])[0],'company'),false);
});

test('API/SQL persistem duas empresas e legado, recusam sobrescrita concorrente e isolam os mesmos IDs em outra conta',async()=>{
 const pg=await platformDatabase();try{
  const {provider,password}=await seedProvider(pg),config=testConfig(),options={provider,logger:()=>{}},handle=createPublicApi(config,options);
  function client(apiHandle=handle){let jar='';return async(path,method='GET',body)=>{const response=await apiHandle(new Request(config.origin+'/api/'+path,{method,headers:{Origin:config.origin,'Content-Type':'application/json',Cookie:jar},body:body===undefined?undefined:JSON.stringify(body)}),{ip:'companies-fixture'});for(const c of response.headers.getSetCookie())if(c.startsWith('cc_session='))jar=c.split(';')[0];return {status:response.status,data:await response.json()};};}
  const a=client(),b=client();await a('login','POST',{username:'yan',password});await b('login','POST',{username:'yan1',password});
  const doc={version:1,companies,entries:[{id:'dre-old',company:'a',description:'Receita da DRE',category:'sales',amount:123400,date:'2026-11-01'}]};assert.equal((await a('dre','PUT',{revision:0,document:doc})).status,200);
  assert.equal((await a('records','PUT',{revision:0,records:sample})).status,200);assert.deepEqual((await a('dre')).data.document,doc);
  const restarted=client(createPublicApi(config,options));await restarted('login','POST',{username:'yan',password});assert.deepEqual((await restarted('records')).data.records,sample);
  const updated=[...sample,withCompany(row('a-next',10000),companies[0])];assert.equal((await a('records','PUT',{revision:1,records:updated})).status,200);assert.equal((await restarted('records','PUT',{revision:1,records:sample})).status,409);assert.deepEqual((await restarted('records')).data.records,updated);
  const exported=(await a('account/export')).data;assert.deepEqual(exported.cash.records,updated);assert.deepEqual(exported.dre.document.entries,doc.entries);
  // O mesmo identificador de empresa em B não fornece nenhum registro de A.
  assert.deepEqual((await b('dre')).data.document.companies,[]);const own=[withCompany(row('privado-b',700),companies[0])];assert.equal((await b('records','PUT',{revision:0,records:own})).status,200);assert.deepEqual((await b('records')).data.records,own);assert.deepEqual((await a('records')).data.records,updated);
 }finally{await pg.close();}
});
