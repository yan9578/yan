import {chromium} from 'playwright';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
import {platformDatabase,A} from '../test-support/platform-db.js';import {seedProvider,testConfig} from '../test-support/provider.js';
import {installGoogleProvider} from '../test-support/google-provider.js';import {createPublicServer} from '../server/node-server.js';
const pg=await platformDatabase(),{provider:base}=await seedProvider(pg),provider=installGoogleProvider(base);
const config=testConfig({googleAuth:true,emailCodesEnabled:false,publicAuth:false,emailReady:false,captchaSiteKey:'test-only-key'}),errors=[];
const server=createPublicServer(config,{provider,logger:()=>{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:process.env.CI||existsSync('/.dockerenv')?['--no-sandbox']:[]});
const date=new Date().toISOString().slice(0,7)+'-01';let captchaRequests=0;const callbacks=[];
async function client(email,{cancel=false,mobile=false}={}){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:950}});
 await context.route('https://challenges.cloudflare.com/**',r=>{captchaRequests++;return r.abort();});
 await context.route(config.url+'/auth/v1/authorize?**',async r=>{
  const url=new URL(r.request().url());assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('code_challenge_method'),'s256');
  const code=cancel?'':await provider.issueGoogleCode(email,url.searchParams.get('code_challenge'));
  await r.fulfill({contentType:'text/html',body:`<!doctype html><html><body><h1>Provedor Google de teste</h1><form method="get" action="${config.origin}/api/oauth/google/callback${cancel?'#error_description=fixture-private-error':''}">${cancel?'<input type="hidden" name="error" value="access_denied">':'<input type="hidden" name="code" value="'+code+'">'}<button type="submit">${cancel?'Cancelar teste':'Confirmar conta de teste'}</button></form></body></html>`});
 });
 await context.route('**/api/oauth/google/callback?**',async r=>{const h=await r.request().allHeaders();callbacks.push({site:h['sec-fetch-site'],hasFlow:/cc_google=/.test(h.cookie||'')});await r.continue();});
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.goto(config.origin);await page.locator('#analytics-decline').click();await page.locator('#google-panel:not([hidden])').waitFor();
 return {context,page};
}
async function choose(page,name='Confirmar conta de teste'){const button=page.getByRole('button',{name});await button.waitFor();assert.equal(new URL(page.url()).origin,config.url);await button.click();}
async function google(page){await page.locator('#google-form [name=privacy]').check();await page.locator('#google-form [name=remember]').check();await page.locator('#google-login').click();}
try{
 await pg.rpc('save_cashbook',{expected_revision:0,new_records:[{id:'old',amount:12800,type:'income',method:'Pix',description:'Conta anterior',category:'Venda',date,saleDate:''}]},'authenticated',A);
 await pg.rpc('save_dre_book',{expected_revision:0,new_document:{version:1,companies:[{id:'c',name:'Empresa anterior',sector:''}],entries:[{id:'e',company:'c',category:'sales',date,description:'Venda anterior',amount:32100}]}},'authenticated',A);
 console.log('Verificando login Google de conta existente e retorno entre sites…');
 const {page,context}=await client('a@example.invalid');
 assert.equal(await page.getByRole('button',{name:'Criar conta',exact:true}).isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'Esqueci minha senha',exact:true}).isVisible(),false);
 provider.googleEnabled=false;await google(page);await page.locator('#auth-error').filter({hasText:'configurar o provedor Google'}).waitFor();assert.equal(await page.locator('#google-login').isEnabled(),true);assert.match(await page.locator('#google-login').getAttribute('class'),/google-button/);
 provider.googleEnabled=true;await page.locator('#google-login').click();await choose(page);await page.locator('#workspace:not([hidden])').waitFor();
 assert.match(await page.locator('#income').innerText(),/128,00/);assert.equal(await page.locator('#admin-open').isVisible(),true);
 const me=await (await page.request.get(config.origin+'/api/me')).json();assert.equal(me.id,A);const cookies=await context.cookies(config.origin+'/api/me');assert.ok(cookies.some(c=>c.name==='cc_session'&&c.httpOnly&&c.sameSite==='Strict'&&c.expires>Date.now()/1000));assert.equal((await context.cookies()).some(c=>c.name==='cc_google'),false);
 assert.ok(!JSON.stringify(await context.storageState()).includes('access_token'));assert.ok(!page.url().includes('code='));
 await page.locator('#dre-open').click();const frame=page.frameLocator('#dre-frame');await frame.locator('#dre-main[aria-busy=false]').waitFor();assert.match(await frame.locator('#profit').innerText(),/321,00/);
 console.log('Verificando nova conta, isolamento e mesmo usuário em outro aparelho…');
 const {page:other}=await client('a@example.invalid');await google(other);await choose(other);await other.locator('#workspace:not([hidden])').waitFor();assert.match(await other.locator('#income').innerText(),/128,00/);
 const {page:newUser}=await client('new-google@example.invalid',{mobile:true});assert.equal(await newUser.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await google(newUser);await choose(newUser);await newUser.locator('#workspace:not([hidden])').waitFor();assert.match(await newUser.locator('#income').innerText(),/0,00/);assert.equal(await newUser.locator('#admin-open').isVisible(),false);assert.equal((await newUser.request.get(config.origin+'/api/admin/metrics')).status(),403);
 console.log('Verificando cancelamento e retorno sem cookie…');
 const {page:cancelled}=await client('cancelled@example.invalid',{cancel:true});await google(cancelled);await choose(cancelled,'Cancelar teste');await cancelled.locator('#auth-error').filter({hasText:'cancelou'}).waitFor();assert.equal(await cancelled.locator('#workspace').isVisible(),false);assert.ok(!cancelled.url().includes('fixture-private-error'));
 const empty=await browser.newContext(),expired=await empty.newPage();await expired.goto(config.origin+'/api/oauth/google/callback?code=forged-fixture-code');await expired.locator('#auth-error').filter({hasText:'prazo'}).waitFor();assert.equal((await expired.request.get(config.origin+'/api/me')).status(),401);
 assert.equal(captchaRequests,0);assert.equal(provider.deliveries.length,0);assert.ok(callbacks.length>=4);assert.ok(callbacks.every(c=>(!c.site||c.site==='cross-site')&&c.hasFlow),JSON.stringify(callbacks));assert.deepEqual(errors,[]);
 await newUser.screenshot({path:'/tmp/caixa-google-mobile.png',fullPage:true});
 console.log('PASS: OAuth PKCE entre sites com cookie Lax, sessão Strict, provedor ausente, UUID/dados/admin preservados, duas máquinas, conta nova isolada, cancelamento e retorno inválido. Sem SMTP ou CAPTCHA nesse fluxo. Provedor Google/Supabase Auth simulado; navegador, APIs e PostgreSQL executados.');
}finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});await pg.close();}
