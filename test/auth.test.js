import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {backup} from 'node:sqlite';
import {makeServer,createUser,openDatabase} from '../auth-server.js';

test('login, isolamento de contas, concorrência, sessão, persistência e backup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'caixa-auth-')),database=join(dir,'db.sqlite');
 let app=makeServer({database});let url;
 const start=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${app.server.address().port}`;};
 const stop=()=>new Promise(r=>app.server.close(r));
 const password=randomBytes(24).toString('hex');
 createUser(app.db,'TestA',password);createUser(app.db,'TestB',password);await start();
 const request=async(path,method='GET',body,cookie,origin=url)=>{const res=await fetch(url+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};};
 const login=async username=>{const r=await request('/api/login','POST',{username,password});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);return r.cookie.split(';')[0];};
 try{
  assert.equal((await request('/api/records')).status,401);
  assert.equal((await request('/api/register','POST',{})).status,401);
  assert.equal((await request('/api/login','POST',{username:'TestA',password:'wrong'})).status,401);
  const a=await login('testa'),b=await login('TestB');
  const row={id:'unique-id',description:'Privado A',amount:12345,type:'income',method:'Pix',category:'Vendas',date:'2026-10-01',saleDate:''};
  assert.equal((await request('/api/records','PUT',{revision:0,records:[row]},a)).status,200);
  assert.equal((await request('/api/records','GET',null,a)).body.records[0].description,'Privado A');
  assert.deepEqual((await request('/api/records','GET',null,b)).body.records,[]);
  assert.equal((await request('/api/records','PUT',{revision:0,records:[{...row,description:'Privado B',user_id:1}]},b)).status,200);
  assert.equal((await request('/api/records','GET',null,a)).body.records[0].description,'Privado A');
  assert.equal((await request('/api/records','PUT',{revision:0,records:[]},a)).status,409);
  assert.equal((await request('/api/records','PUT',{revision:1,records:[]},a,'https://attacker.invalid')).status,403);
  assert.equal((await request('/api/records','PUT',{revision:1,records:[{...row,amount:-1}]},a)).status,400);
  const hidden=await fetch(url+'/.data/caixa.sqlite');assert.equal(hidden.status,404);
  const dump=app.db.prepare('SELECT * FROM users').all();assert.ok(dump.every(u=>!u.password_hash.includes(password)&&u.password_hash.includes(':')));
  const copy=join(dir,'backup.sqlite');await backup(app.db,copy);const restored=openDatabase(copy);assert.equal(restored.prepare('SELECT count(*) AS n FROM records').get().n,2);restored.close();
  assert.equal((await request('/api/logout','POST',{},a)).status,200);assert.equal((await request('/api/records','GET',null,a)).status,401);
  await stop();app=makeServer({database});await start();
  const a2=await login('TestA');assert.equal((await request('/api/records','GET',null,a2)).body.records[0].amount,12345);
  app.db.prepare('UPDATE sessions SET expires=0').run();assert.equal((await request('/api/me','GET',null,a2)).status,401);
  for(let i=0;i<5;i++)assert.equal((await request('/api/login','POST',{username:'TestA',password:'wrong'})).status,401);
  assert.equal((await request('/api/login','POST',{username:'TestA',password})).status,429);
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});

test('produção exige origem HTTPS',()=>{assert.throws(()=>makeServer({production:true}),/HTTPS/);});
