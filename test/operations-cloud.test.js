import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPublicApi} from '../server/public-api.js';
import {collectBackup} from '../server/backup.js';
import {cashOperations,dreOperations,remaining} from '../public/operations-model.js';
import {M} from '../public/dre-model.js';
import {A,B,platformDatabase} from '../test-support/platform-db.js';
import {seedProvider,testConfig} from '../test-support/provider.js';

test('operações em nuvem preservam caixa e DRE legados, isolam contas e integram o backup',async()=>{
 const pg=await platformDatabase();
 try{
  const {provider,password}=await seedProvider(pg);
  const config=testConfig(),options={provider,clock:()=>Date.parse('2026-12-05T16:00:00Z'),logger:()=>{}};
  function client(){
   const handle=createPublicApi(config,options);
   let cookie='';
   return async(path,method='GET',body)=>{
    const response=await handle(new Request(config.origin+'/api/'+path,{method,
     headers:{Origin:config.origin,'Content-Type':'application/json',Cookie:cookie},
     body:body===undefined?undefined:JSON.stringify(body)}),{ip:'operations-fixture'});
    for(const value of response.headers.getSetCookie())if(value.startsWith('cc_session='))cookie=value.split(';')[0];
    return {status:response.status,data:await response.json()};
   };
  }
  const first=client(),second=client();
  assert.equal((await first('login','POST',{username:'yan',password})).status,200);
  assert.equal((await second('login','POST',{username:'yan1',password})).status,200);
  const companies=[{id:'retail',name:'Loja',sector:''}];
  const legacy={id:'previous',company:'retail',date:'2026-11-05',category:'sales',description:'Receita histórica',amount:10000};
  const book={version:1,companies,entries:[legacy]};
  assert.equal((await first('dre','PUT',{revision:0,document:book})).status,200);
  const command={action:'save-operation',id:'sale',company:'retail',description:'Venda a prazo',category:'sales',
   amount:1000000,date:'2026-11-05',due:'2026-12-05'};
  const save=await first('operations','POST',{revision:1,command});
  assert.equal(save.status,200,JSON.stringify(save.data));
  const payment={action:'settle',id:'sale',company:'retail',paymentId:'one',date:'2026-12-05',amount:600000,account:'caixa-geral',method:'Pix'};
  const settle=await first('operations','POST',{revision:2,command:payment});
  assert.equal(settle.status,200,JSON.stringify(settle.data));
  assert.equal((await first('operations','POST',{revision:2,command:payment})).status,409);
  assert.equal((await first('operations','POST',{revision:3,command:payment})).status,400);
  assert.equal((await second('operations')).data.document.operations.length,0);
  await assert.rejects(pg.rpc('app_save_operations',{p_user:A,p_revision:3,p_book:settle.data.document},'authenticated',B),error=>error.status===403);
  assert.equal((await first('dre','PUT',{revision:3,document:{...book,companies:[],entries:[]}})).status,409);
  const revised={...book,companies:[{...companies[0],name:'Loja renovada'}]};
  const dreSave=await first('dre','PUT',{revision:3,document:revised});
  assert.equal(dreSave.status,200,JSON.stringify(dreSave.data));
  const registered=await first('operations');
  assert.equal(registered.data.revision,4);
  assert.deepEqual(registered.data.document,settle.data.document);
  await pg.as('authenticated',A,db=>db.query("update public.dre_books set document=document-'operationBook' where user_id=$1",[A]));
  assert.deepEqual((await first('operations')).data.document,registered.data.document);
  assert.deepEqual((await first('dre')).data.document,revised);
  assert.equal(remaining(registered.data.document.operations[0]),400000);
  assert.equal(cashOperations(registered.data.document)[0].amount,600000);
  assert.equal(M.report({...revised,entries:[legacy,...dreOperations(registered.data.document,revised)]},'retail','2026-11').gross,1010000);
  const exported=(await first('account/export')).data;
  assert.deepEqual(exported.operations,registered.data);
  const snapshot=await collectBackup(provider,'test.supabase.co');
  assert.deepEqual(snapshot.datasets.dre_books[0].document.operationBook,registered.data.document);
  await assert.rejects(pg.rpc('app_delete_company',{p_user:A,p_company:'retail'},'authenticated',B),error=>error.status===403);
  assert.equal((await second('companies','DELETE',{id:'retail'})).status,404);
  assert.deepEqual((await first('operations')).data,registered.data);
 }finally{await pg.close();}
});
