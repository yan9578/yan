import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {makeServer,createUser} from '../auth-server.js';
test('DRE exige login, isola contas e módulos, recusa conflitos e sobrevive ao reinício',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'caixa-dre-')),database=join(dir,'db.sqlite'),password=randomBytes(24).toString('hex');let app=makeServer({database}),url;
 createUser(app.db,'A1',password);createUser(app.db,'B1',password);
 const start=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+app.server.address().port;};const stop=()=>new Promise(r=>app.server.close(r));
 async function req(path,method='GET',data,cookie){const res=await fetch(url+'/api/'+path,{method,headers:{Origin:url,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 const login=async name=>(await req('login','POST',{username:name,password})).cookie;
 const doc={version:1,companies:[{id:'c',name:'Minha empresa',sector:''}],entries:[{id:'sale',company:'c',date:'2026-10-01',description:'Venda da DRE',category:'sales',amount:90000}]};
 await start();try{
 assert.equal((await req('dre')).status,401);const a=await login('A1'),b=await login('B1');
 assert.deepEqual((await req('dre','GET',null,a)).data.document,{version:1,companies:[],entries:[]});
 assert.equal((await req('dre','PUT',{revision:0,document:doc},a)).status,200);
 assert.equal((await req('dre','GET',null,a)).data.document.entries[0].amount,90000);
 assert.deepEqual((await req('dre','GET',null,b)).data.document.entries,[]);
 assert.equal((await req('dre','PUT',{revision:0,document:{version:1,companies:[],entries:[]}},b)).status,200);
 assert.equal((await req('dre','PUT',{revision:0,document:doc},a)).status,409);
 assert.equal((await req('dre','PUT',{revision:1,document:{...doc,entries:[{...doc.entries[0],company:'foreign'}]}},a)).status,400);
 const cash={id:'cash',type:'income',amount:10000,method:'Pix',category:'Vendas',description:'Caixa',date:'2026-10-02',saleDate:''};
 assert.equal((await req('records','PUT',{revision:0,records:[cash]},a)).status,200);
 assert.equal((await req('dre','GET',null,a)).data.revision,1);
 assert.equal((await req('records','GET',null,a)).data.records[0].amount,10000);
 await stop();app=makeServer({database});await start();const next=await login('A1');assert.equal((await req('dre','GET',null,next)).data.document.entries[0].amount,90000);
 assert.equal((await req('records','GET',null,next)).data.records[0].amount,10000);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
