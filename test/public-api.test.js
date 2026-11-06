import {test} from 'node:test';import assert from 'node:assert/strict';
import {createPublicApi} from '../server/public-api.js';import {serverConfig} from '../server/config.js';import {unseal,seal,sha256} from '../server/security.js';
import {platformDatabase,A,B} from '../test-support/platform-db.js';import {seedProvider,testConfig} from '../test-support/provider.js';
import {ProviderError} from '../server/supabase.js';
function client(handle,config,ip='test-ip'){
 const jar=new Map();return {jar,async call(path,method='GET',body,extra={}){const req=new Request(config.origin+'/api/'+path,{method,headers:{Origin:config.origin,...(body!==undefined?{'Content-Type':'application/json'}:{}),Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...extra},body:body===undefined?undefined:JSON.stringify(body)});const res=await handle(req,{ip});for(const c of res.headers.getSetCookie()){const [name,value]=c.split(';')[0].split('=');if(c.includes('Max-Age=0'))jar.delete(name);else jar.set(name,value);}return {status:res.status,data:await res.json(),headers:res.headers};}};
}

test('autenticação por e-mail/código, recuperação de uso único, sessões e isolamento reais do SQL',async()=>{
 const pg=await platformDatabase();try{
  const {provider,password}=await seedProvider(pg),config=testConfig({netlifyToken:'test-only-netlify-token',netlifyAccount:'test-team'}),logs=[];let now=Date.now();const handle=createPublicApi(config,{provider,clock:()=>now,logger:x=>logs.push(x),fetcher:async()=>Response.json({minutes:{current:8,included_minutes:null},active:0})});const a=client(handle,config,'ip-a'),b=client(handle,config,'ip-b');
  assert.equal((await a.call('records')).status,401);assert.equal((await a.call('login','POST',{username:'a@example.invalid',password:'wrong'})).status,401);
  const login=await a.call('login','POST',{username:'Yan',password,remember:true});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);assert.match(login.headers.get('set-cookie'),/Max-Age=2592000/);assert.ok(!JSON.stringify(login.data).includes('access_token'));
  const cookie=a.jar.get('cc_session');assert.match(cookie,/^[a-f0-9]{64}$/);const session=(await pg.db.query('select * from private.app_sessions where id_hash=$1',[sha256(cookie)])).rows[0];assert.notEqual(session.tokens,provider.calls.at(-1)?.token);assert.ok(!session.tokens.includes('access_token'));
  const me=await a.call('me');assert.equal(me.data.id,A);assert.equal(me.data.isAdmin,true);assert.match(me.data.draftKey,/^[a-f0-9]{64}$/);
  const metrics=await a.call('admin/metrics');assert.equal(metrics.status,200);assert.equal(metrics.data.hosting.buildMinutes,8);assert.equal(metrics.data.hosting.includedMinutes,null);assert.ok(!JSON.stringify(metrics.data).includes(config.netlifyToken));
  assert.equal((await b.call('login','POST',{email:'b@example.invalid',password})).status,200);assert.equal((await b.call('me')).data.isAdmin,false);assert.equal((await b.call('admin/metrics')).status,403);
  const row={id:'cash',description:'Descrição financeira secreta',type:'income',method:'Pix',category:'Vendas',date:'2026-11-01',saleDate:'',amount:20000};
  assert.equal((await a.call('records','PUT',{revision:0,records:[row],user_id:B})).status,200);assert.deepEqual((await b.call('records')).data.records,[]);
  assert.equal((await a.call('records','PUT',{revision:0,records:[]})).status,409);
  assert.equal((await a.call('records','PUT',{revision:1,records:[{...row,amount:-1}]})).status,400);
  const events=(await pg.db.query('select * from private.app_events')).rows;assert.ok(!JSON.stringify(events).includes(row.description));assert.ok(!JSON.stringify(events).includes(password));assert.ok(!JSON.stringify(logs).includes(password));
  // Cookie de sessão continua funcionando após uma nova instância do servidor.
  const cold=client(createPublicApi(config,{provider,logger:()=>{}}),config,'ip-a');cold.jar.set('cc_session',cookie);assert.equal((await cold.call('records')).data.records[0].amount,20000);
  // Renovação concorrente compartilha a mesma troca de refresh token.
  const tokens=unseal(session.tokens,config.secret);tokens.expiresAt=Date.now()-1;await pg.db.query('update private.app_sessions set tokens=$1 where id_hash=$2',[seal(tokens,config.secret),sha256(cookie)]);
  const before=provider.calls.filter(c=>c.path?.includes('grant_type=refresh_token')).length;const refreshed=await Promise.all([a.call('me'),a.call('records')]);assert.ok(refreshed.every(r=>r.status===200));assert.equal(provider.calls.filter(c=>c.path?.includes('grant_type=refresh_token')).length,before+1);
  assert.equal((await a.call('logout','POST',{})).status,200);cold.jar.set('cc_session',cookie);assert.equal((await cold.call('records')).status,401);
  // Cadastro não retorna código nem tokens ao navegador.
  const c=client(handle,config,'ip-c'),address='new@example.invalid';let r=await c.call('signup','POST',{email:address,password:'New-password-2026',privacyAccepted:true});assert.equal(r.status,200);assert.ok(!JSON.stringify(r.data).includes(provider.codes.get(address+':signup').code));assert.equal((await c.call('login','POST',{email:address,password:'New-password-2026'})).status,401);
  r=await c.call('verify','POST',{code:'000000'});assert.equal(r.status,401);const code=provider.codes.get(address+':signup').code;const challenge=c.jar.get('cc_challenge');r=await c.call('verify','POST',{code});assert.equal(r.status,200);assert.equal(r.data.next,'app');assert.equal((await c.call('me')).data.email,address);
  const replay=client(handle,config,'ip-c-replay');replay.jar.set('cc_challenge',challenge);assert.equal((await replay.call('verify','POST',{code})).status,401);
  // Recuperação não autentica no app e expira após uso.
  const recover=client(handle,config,'ip-recovery');r=await recover.call('recover','POST',{email:'a@example.invalid'});assert.equal(r.status,200);const recoveryCode=provider.codes.get('a@example.invalid:recovery').code;r=await recover.call('verify','POST',{code:recoveryCode});assert.equal(r.data.next,'reset');assert.equal((await recover.call('records')).status,401);const recoveryCookie=recover.jar.get('cc_recovery');
  r=await recover.call('reset-password','POST',{password:'Another-password-2026'});assert.equal(r.status,200);const reused=client(handle,config,'replay-reset');reused.jar.set('cc_recovery',recoveryCookie);assert.equal((await reused.call('reset-password','POST',{password:'Another-password-2027'})).status,401);
  const fresh=client(handle,config,'fresh-login');assert.equal((await fresh.call('login','POST',{email:'a@example.invalid',password:'Another-password-2026'})).status,200);assert.equal((await fresh.call('records')).data.records[0].amount,20000);
  // A expiração do desafio é verificada pelo servidor, independentemente do cliente.
  const expiry=client(handle,config,'ip-expiry');expiry.jar.set('cc_challenge',seal({email:'b@example.invalid',type:'signup',until:now-1},config.secret,'challenge'));assert.equal((await expiry.call('verify','POST',{code:'123456'})).data.code,'CODE_EXPIRED');
  // Origem forjada e metadados de admin não autorizam operações.
  assert.equal((await fresh.call('records','PUT',{revision:1,records:[]},{Origin:'https://attacker.invalid'})).status,403);
  provider.users.get('b@example.invalid').user_metadata={isAdmin:true,role:'admin'};assert.equal((await b.call('admin/requests')).status,403);
 }finally{await pg.close();}
});

test('limites persistentes, enumeração, confirmação de e-mail e indisponibilidade de SMTP',async()=>{
 const pg=await platformDatabase();try{const {provider,password}=await seedProvider(pg),config=testConfig(),handle=createPublicApi(config,{provider,logger:()=>{}}),c=client(handle,config,'limiter-ip');
 for(let i=0;i<8;i++)assert.equal((await c.call('login','POST',{email:'b@example.invalid',password:'bad'})).status,401);
 const limited=await c.call('login','POST',{email:'b@example.invalid',password});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
 const newServer=client(createPublicApi(config,{provider,logger:()=>{}}),config,'another-ip');assert.equal((await newServer.call('login','POST',{email:'b@example.invalid',password})).status,429);
 const recovery=client(handle,config,'recovery-ip');const missing=await recovery.call('recover','POST',{email:'missing@example.invalid'});assert.equal(missing.status,200);assert.ok(missing.data.message.includes('Se o e-mail'));assert.equal((await recovery.call('resend','POST',{})).status,429);
 const disabled=client(createPublicApi(testConfig({publicAuth:false,emailReady:false}),{provider,logger:()=>{}}),config,'no-smtp');assert.equal((await disabled.call('signup','POST',{email:'x@example.invalid',password:'Password-2026',privacyAccepted:true})).status,503);
 provider.autocofirm=true;const noConfirm=client(handle,config,'auto-confirm-ip');assert.equal((await noConfirm.call('signup','POST',{email:'unsafe@example.invalid',password:'Password-2026',privacyAccepted:true})).data.code,'EMAIL_NOT_CONFIGURED');
 }finally{await pg.close();}
});

test('configuração pública exige pré-requisitos e HTTPS, e cookies de produção são Secure',async()=>{
 assert.throws(()=>serverConfig({NODE_ENV:'production',APP_ORIGIN:'http://test.invalid',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test',SESSION_SECRET:'a'.repeat(40)}),/HTTPS/);
 assert.throws(()=>serverConfig({APP_ORIGIN:'https://test.invalid',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test',SESSION_SECRET:'a'.repeat(40),PUBLIC_AUTH_ENABLED:'true'}),/SMTP/);
 const pg=await platformDatabase();try{const {provider,password}=await seedProvider(pg),config=testConfig({production:true,origin:'https://test.invalid'}),c=client(createPublicApi(config,{provider,logger:()=>{}}),config);const r=await c.call('login','POST',{email:'a@example.invalid',password});assert.match(r.headers.get('set-cookie'),/; Secure/);assert.ok(!r.headers.get('set-cookie').includes('Max-Age=2592000'));}finally{await pg.close();}
});

test('falha de CAPTCHA ou do provedor não simula envio de código; backup vencido bloqueia novas contas',async()=>{
 const pg=await platformDatabase();try{
  const {provider,password}=await seedProvider(pg),config=testConfig({production:true,origin:'https://test.invalid',captchaSiteKey:'test-site-key'}),handle=createPublicApi(config,{provider,logger:()=>{}}),auth=provider.auth.bind(provider);
  provider.auth=async(path,...args)=>{if(path==='signup')throw new ProviderError(400,'captcha_failed');return auth(path,...args);};
  const captchaClient=client(handle,config,'captcha-ip');assert.equal((await captchaClient.call('signup','POST',{email:'captcha@example.invalid',password:'Password-2026',privacyAccepted:true})).data.code,'CAPTCHA_REQUIRED');
  const failed=await captchaClient.call('signup','POST',{email:'captcha@example.invalid',password:'Password-2026',privacyAccepted:true,captchaToken:'test-token'});assert.equal(failed.status,400);assert.equal(failed.data.code,'CAPTCHA_FAILED');assert.equal(captchaClient.jar.has('cc_challenge'),false);
  provider.auth=async(path,...args)=>{if(path==='recover')throw new ProviderError(400,'email_address_not_authorized');return auth(path,...args);};
  const unavailable=client(handle,config,'smtp-error-ip');assert.equal((await unavailable.call('recover','POST',{email:'unknown@example.invalid',captchaToken:'test-token'})).status,503);assert.equal(unavailable.jar.has('cc_challenge'),false);
  provider.auth=auth;await pg.db.query('update private.app_backup_runs set occurred_at=now()-interval \'3 days\'');
  const stale=client(handle,config,'stale-backup-ip');assert.equal((await stale.call('signup','POST',{email:'new-stale@example.invalid',password:'Password-2026',privacyAccepted:true,captchaToken:'test-token'})).data.code,'BACKUP_NOT_CURRENT');
  assert.equal((await stale.call('login','POST',{email:'a@example.invalid',password,captchaToken:'test-token'})).status,200);
  const recovering=client(handle,config,'recovery-stale-ip');assert.equal((await recovering.call('recover','POST',{email:'a@example.invalid',captchaToken:'test-token'})).status,200);
 }finally{await pg.close();}
});
