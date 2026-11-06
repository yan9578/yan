import {test} from 'node:test';import assert from 'node:assert/strict';

test('adaptador Netlify recusa configuração ausente e atende as duas formas da rota de API',async()=>{
 const keys=['NODE_ENV','NETLIFY','APP_ORIGIN','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','SESSION_SECRET','PUBLIC_AUTH_ENABLED'],previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  for(const key of keys)delete process.env[key];
  const {default:handler}=await import('../netlify/functions/api.mjs');
  const missing=await handler(new Request('https://test.invalid/api/config'),{ip:'test'});assert.equal(missing.status,503);assert.equal((await missing.json()).code,'SERVER_NOT_CONFIGURED');assert.equal(missing.headers.get('cache-control'),'no-store');
  Object.assign(process.env,{NETLIFY:'true',APP_ORIGIN:'https://test.invalid',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_test',SESSION_SECRET:'test-only-secret-with-at-least-32-characters',PUBLIC_AUTH_ENABLED:'false'});
  for(const path of ['/api/config','/.netlify/functions/api/config']){const res=await handler(new Request('https://test.invalid'+path),{ip:'test'}),data=await res.json();assert.equal(res.status,200);assert.equal(data.serverMode,true);assert.equal(data.publicAuth,false);assert.ok(!JSON.stringify(data).includes('sb_secret_'));assert.equal(data.authStage,null);}
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
