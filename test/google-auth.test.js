import {test} from 'node:test';import assert from 'node:assert/strict';
import {platformDatabase,A,B} from '../test-support/platform-db.js';
import {seedProvider,testConfig} from '../test-support/provider.js';
import {installGoogleProvider} from '../test-support/google-provider.js';
import {createPublicApi} from '../server/public-api.js';import {unseal,seal} from '../server/security.js';
const callback='/api/oauth/google/callback';
function client(handle,config,ip='google-fixture'){
 const jar=new Map();return {jar,async call(path,method='GET',body,extra={}){
  const res=await handle(new Request(config.origin+path,{method,headers:{Origin:config.origin,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined}),{ip});
  for(const value of res.headers.getSetCookie()){const [name,entry]=value.split(';')[0].split('=');if(value.includes('Max-Age=0'))jar.delete(name);else jar.set(name,entry);}
  const text=await res.text();return {status:res.status,data:text?JSON.parse(text):null,headers:res.headers};
 }};
}
const opt={remember:true,privacyAccepted:true};

test('Google PKCE preserva UUID, dados e admin de conta existente; cadastra outra sem SMTP e mantém isolamento',async()=>{
 const db=await platformDatabase();try{
  const {provider:base}=await seedProvider(db),provider=installGoogleProvider(base),config=testConfig({production:true,origin:'https://app.example.invalid',googleAuth:true,emailCodesEnabled:false,publicAuth:false,emailReady:false}),logs=[];
  const handle=createPublicApi(config,{provider,logger:entry=>logs.push(entry)}),a=client(handle,config,'google-a'),b=client(handle,config,'google-b');
  const row={id:'private-a',amount:15000,type:'income',method:'Pix',description:'Privado anterior',category:'Venda',date:'2026-11-01',saleDate:''};
  await db.rpc('save_cashbook',{expected_revision:0,new_records:[row]},'authenticated',A);
  const blockedEmail=client(createPublicApi({...config,publicAuth:true,emailReady:true},{provider,logger:()=>{}}),config,'email-off');assert.equal((await blockedEmail.call('/api/signup','POST',{email:'closed@example.invalid',password:'Password-2026',privacyAccepted:true})).data.code,'EMAIL_NOT_CONFIGURED');
  const start=await a.call('/api/oauth/google/start','POST',{...opt,user_id:B,provider:'github',redirect_to:'https://attacker.invalid'});assert.equal(start.status,200);const target=new URL(start.data.url);
  assert.equal(target.origin,config.url);assert.equal(target.pathname,'/auth/v1/authorize');assert.equal(target.searchParams.get('provider'),'google');assert.equal(target.searchParams.get('code_challenge_method'),'s256');assert.equal(target.searchParams.get('redirect_to'),config.origin+callback);assert.ok(!start.data.url.includes(config.serviceKey));
  assert.match(start.headers.get('set-cookie'),/SameSite=Lax/);assert.match(start.headers.get('set-cookie'),/Path=\/api\/oauth\/google\/callback/);assert.match(start.headers.get('set-cookie'),/HttpOnly/);assert.match(start.headers.get('set-cookie'),/; Secure/);
  const code=await provider.issueGoogleCode('a@example.invalid',target.searchParams.get('code_challenge')),flowCookie=a.jar.get('cc_google');
  const finish=await a.call(callback+'?code='+code,'GET',undefined,{'Sec-Fetch-Site':'cross-site'});assert.equal(finish.status,303);assert.equal(finish.headers.get('location'),config.origin+'/?auth=google_success#');assert.equal(finish.headers.get('referrer-policy'),'no-referrer');assert.match(finish.headers.get('set-cookie'),/SameSite=Strict/);
  const me=await a.call('/api/me');assert.equal(me.data.id,A);assert.equal(me.data.isAdmin,true);assert.equal((await a.call('/api/records')).data.records[0].amount,15000);
  // O navegador não recebe tokens do Google ou do Supabase na URL de retorno.
  assert.ok(!finish.headers.get('location').includes('token'));assert.ok(!JSON.stringify(me.data).includes('access_token'));assert.ok(!JSON.stringify(logs).includes(code));
  const next=await b.call('/api/oauth/google/start','POST',opt),url=new URL(next.data.url);const newCode=await provider.issueGoogleCode('google-new@example.invalid',url.searchParams.get('code_challenge'));
  assert.equal((await b.call(callback+'?code='+newCode,'GET',undefined,{'Sec-Fetch-Site':'cross-site'})).headers.get('location'),config.origin+'/?auth=google_success#');
  assert.notEqual((await b.call('/api/me')).data.id,A);assert.deepEqual((await b.call('/api/records')).data.records,[]);assert.equal((await b.call('/api/admin/metrics')).status,403);assert.equal(provider.deliveries.length,0);assert.ok(!provider.calls.some(c=>['signup','recover','resend'].includes(c.path)));
  const retry=client(createPublicApi(config,{provider,logger:()=>{}}),config,'replay');retry.jar.set('cc_google',flowCookie);assert.equal((await retry.call(callback+'?code='+code)).headers.get('location'),config.origin+'/?auth=google_expired#');assert.equal(retry.jar.has('cc_session'),false);
 }finally{await db.close();}
});

test('Google rejeita CSRF, cookie trocado, PKCE incompatível, expiração, e-mail não confirmado e provedor diferente',async()=>{
 const db=await platformDatabase();try{
  const {provider:base}=await seedProvider(db),provider=installGoogleProvider(base),config=testConfig({googleAuth:true,emailCodesEnabled:false,publicAuth:false,emailReady:false});let now=Date.now();const handle=createPublicApi(config,{provider,clock:()=>now,logger:()=>{}});
  const a=client(handle,config,'a'),b=client(handle,config,'b');
  assert.equal((await a.call('/api/oauth/google/start','POST',opt,{Origin:'https://attacker.invalid'})).status,403);assert.equal((await a.call('/api/oauth/google/start','POST',{})).status,400);
  const first=await a.call('/api/oauth/google/start','POST',opt),second=await b.call('/api/oauth/google/start','POST',opt),target=new URL(first.data.url);
  const code=await provider.issueGoogleCode('a@example.invalid',target.searchParams.get('code_challenge'));
  assert.equal((await b.call(callback+'?code='+code)).headers.get('location'),config.origin+'/?auth=google_failed#');assert.equal(b.jar.has('cc_session'),false);
  // Sem cookie ou com ciphertext adulterado não há troca de código nem sessão.
  const anonymous=client(handle,config,'anon');assert.equal((await anonymous.call(callback+'?code='+code)).headers.get('location'),config.origin+'/?auth=google_expired#');anonymous.jar.set('cc_google','invalid');assert.equal((await anonymous.call(callback+'?code='+code)).headers.get('location'),config.origin+'/?auth=google_expired#');
  const aCookie=a.jar.get('cc_google');const flow=unseal(aCookie,config.secret,'google-oauth');flow.until=now-1;a.jar.set('cc_google',seal(flow,config.secret,'google-oauth'));assert.equal((await a.call(callback+'?code='+code)).headers.get('location'),config.origin+'/?auth=google_expired#');
  for(const identity of [{verified:false},{providerName:'github'}]){
   const c=client(handle,config,'rejected-'+JSON.stringify(identity));const begin=await c.call('/api/oauth/google/start','POST',opt),authUrl=new URL(begin.data.url),badCode=await provider.issueGoogleCode('b@example.invalid',authUrl.searchParams.get('code_challenge'),identity);
   assert.equal((await c.call(callback+'?code='+badCode)).headers.get('location'),config.origin+'/?auth=google_unverified#');assert.equal(c.jar.has('cc_session'),false);
  }
  provider.googleEnabled=false;assert.equal((await a.call('/api/oauth/google/start','POST',opt)).data.code,'GOOGLE_NOT_CONFIGURED');
 }finally{await db.close();}
});

test('Google mantém acesso de conta existente com backup vencido e pausa somente primeira conta sem dados',async()=>{
 const db=await platformDatabase();try{
  const {provider:base}=await seedProvider(db),provider=installGoogleProvider(base),config=testConfig({googleAuth:true,emailCodesEnabled:false,emailReady:false,publicAuth:false});const handle=createPublicApi(config,{provider,logger:()=>{}});
  await db.rpc('app_policy_ack',{p_user:B,p_version:'2026-11-06'});await db.db.exec("update private.app_backup_runs set occurred_at=now()-interval '3 days'");
  for(const [address,outcome]of [['a@example.invalid','google_success'],['b@example.invalid','google_success'],['new-paused@example.invalid','google_registration_paused']]){
   const c=client(handle,config,address),begin=await c.call('/api/oauth/google/start','POST',opt),target=new URL(begin.data.url),code=await provider.issueGoogleCode(address,target.searchParams.get('code_challenge'));
   assert.equal((await c.call(callback+'?code='+code)).headers.get('location'),config.origin+'/?auth='+outcome+'#');assert.equal(c.jar.has('cc_session'),outcome==='google_success');
  }
 }finally{await db.close();}
});
