import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {createVercelAdapter} from '../server/vercel-adapter.js';import {vercelTestServer} from '../test-support/vercel-server.js';
import {platformDatabase} from '../test-support/platform-db.js';import {seedProvider,testConfig} from '../test-support/provider.js';import {serverConfig} from '../server/config.js';
import {vercelConfig,vercelDefaults} from '../server/vercel-config.js';

test('Vercel usa domínio de produção e padrões públicos, exige as três credenciais e respeita configurações explícitas',()=>{
 const credentials={VERCEL:'1',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',SESSION_SECRET:'fixture-'.repeat(6)};
 const config=vercelConfig(credentials);assert.equal(config.origin,'https://yan-khaki-two.vercel.app');assert.equal(config.url,'https://ppzlnrydbdxdkbytrwly.supabase.co');assert.equal(config.production,true);assert.equal(config.googleAuth,true);assert.equal(config.emailCodesEnabled,false);assert.equal(config.publicAuth,false);assert.equal(config.backupReady,true);
 assert.ok(!Object.keys(vercelDefaults).some(k=>/SECRET|SERVICE_ROLE|PUBLISHABLE_KEY/.test(k)));
 for(const key of ['SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','SESSION_SECRET']){const env={...credentials};delete env[key];assert.throws(()=>vercelConfig(env),e=>e.configVariable===key&&e.configReason==='MISSING');}
 const other=vercelConfig({...credentials,APP_ORIGIN:'https://other.example',SUPABASE_URL:'https://other.supabase.co',GOOGLE_AUTH_ENABLED:'false',BACKUP_SETUP_CONFIRMED:'false'});assert.equal(other.origin,'https://other.example');assert.equal(other.url,'https://other.supabase.co');assert.equal(other.googleAuth,false);assert.equal(other.backupReady,false);
 assert.throws(()=>vercelConfig({...credentials,APP_ORIGIN:'http://other.example'}),e=>e.configVariable==='APP_ORIGIN');assert.throws(()=>vercelConfig({...credentials,SESSION_SECRET:'short'}),e=>e.configVariable==='SESSION_SECRET');
});

test('Vercel mantém cookies separados, retorno OAuth, query e IP da plataforma; limita corpo e rejeita rota ambígua',async()=>{
 const calls=[],adapter=createVercelAdapter(()=>async(request,context)=>{calls.push({request,context,body:request.method==='POST'?await request.json():null});const h=new Headers({Location:'https://test.invalid/?auth=google_success#','Cache-Control':'no-store'});h.append('Set-Cookie','cc_google=; Path=/api/oauth/google/callback; HttpOnly; SameSite=Lax; Max-Age=0');h.append('Set-Cookie','cc_session=fixture; Path=/api; HttpOnly; SameSite=Strict; Secure');return new Response(null,{status:303,headers:h});},()=> 'https://test.invalid');
 const server=createServer(adapter);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(origin+'/api/router?__cc_route=oauth/google/callback&code=fixture-code',{headers:{'x-vercel-forwarded-for':'203.0.113.5','x-forwarded-for':'198.51.100.5'},redirect:'manual'});
  assert.equal(response.status,303);assert.equal(response.headers.getSetCookie().length,2);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(calls[0].request.url,'https://test.invalid/api/oauth/google/callback?code=fixture-code');assert.equal(calls[0].context.ip,'203.0.113.5');
  await fetch(origin+'/api/router?__cc_route=login',{method:'POST',redirect:'manual',headers:{'content-type':'application/json',origin:'https://test.invalid','x-forwarded-for':'198.51.100.5'},body:JSON.stringify({username:'fixture',password:'fixture-only'})});assert.deepEqual(calls[1].body,{username:'fixture',password:'fixture-only'});assert.equal(calls[1].context.ip,'unknown');assert.equal(calls[1].request.headers.get('origin'),'https://test.invalid');
  for(const query of ['','?__cc_route=me&__cc_route=admin/metrics','?__cc_route=..%2Fme'])assert.equal((await fetch(origin+'/api/router'+query)).status,404);
  assert.equal((await fetch(origin+'/api/router?__cc_route=login',{method:'POST',body:'x'.repeat(2_000_001)})).status,413);assert.equal(calls.length,2);
  // Outras versões do runtime mantêm req.url e fornecem o rewrite em req.query.
  let result;await adapter({url:'/api/admin/metrics?days=7',query:{__cc_route:'admin/metrics'},method:'GET',headers:{}},{setHeader(){},set statusCode(v){result=v;},end(){}});assert.equal(result,303);assert.equal(calls.at(-1).request.url,'https://test.invalid/api/admin/metrics?days=7');
  const parsed={url:'/api/router?__cc_route=login',method:'POST',headers:{'content-type':'application/json'},body:{username:'parsed-fixture'}};
  await adapter(parsed,{setHeader(){},end(){}});assert.deepEqual(calls.at(-1).body,{username:'parsed-fixture'});
  Object.defineProperty(parsed,'body',{get(){const error=Error('Invalid JSON with private input');error.statusCode=400;throw error;}});let invalid;
  await adapter(parsed,{writeHead(status){assert.equal(status,400);},end(text){invalid=text;}});assert.ok(!invalid.includes('private input'));
 }finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
});

test('Vercel atende autenticação e dados no mesmo banco; preserva CSRF, Secure, admin e diagnóstico sem segredos',async()=>{
 const pg=await platformDatabase(),{provider,password}=await seedProvider(pg),config=testConfig({hostingProvider:'vercel'}),server=vercelTestServer(config,{provider,logger:()=>{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+server.address().port;
 const call=(path,options={})=>fetch(config.origin+'/api/'+path,{...options,headers:{Origin:config.origin,'Content-Type':'application/json',...options.headers}});
 try{
  assert.equal((await call('config')).status,200);
  const login=await call('login',{method:'POST',body:JSON.stringify({username:'yan',password})});assert.equal(login.status,200);const cookie=login.headers.getSetCookie().find(c=>c.startsWith('cc_session=')).split(';')[0];
  const metrics=await call('admin/metrics?days=7',{headers:{Cookie:cookie}});assert.equal(metrics.status,200);const data=await metrics.json();assert.equal(data.totalUsers,2);assert.equal(data.hosting.provider,'vercel');assert.equal(data.hostingDashboard,'https://vercel.com/dashboard');
  assert.equal((await call('me',{headers:{Cookie:cookie,'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await call('login',{method:'POST',headers:{Origin:'https://attacker.invalid'},body:'{}'})).status,403);
  const env={VERCEL:'1',APP_ORIGIN:'https://test.invalid',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture',SESSION_SECRET:'s'.repeat(40)};assert.equal(serverConfig(env).production,true);assert.throws(()=>serverConfig({...env,APP_ORIGIN:'http://test.invalid'}));
 }finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});await pg.close();}
 const {default:deployed}=await import('../api/router.mjs');let status,payload;await deployed({url:'/api/router?__cc_route=config',headers:{},method:'GET'},{writeHead(v){status=v;},end(text){payload=JSON.parse(text);}});assert.equal(status,503);assert.equal(payload.code,'SERVER_NOT_CONFIGURED');assert.ok(!JSON.stringify(payload).includes('sb_secret_'));
});
