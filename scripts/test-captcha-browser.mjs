import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {platformDatabase} from '../test-support/platform-db.js';
import {seedProvider,testConfig} from '../test-support/provider.js';
import {ProviderError} from '../server/supabase.js';
import {createPublicServer} from '../server/node-server.js';

const pg=await platformDatabase(),{provider,password}=await seedProvider(pg),config=testConfig({captchaSiteKey:'test-only-site-key'});
const issued=new Set(),used=new Set(),originalAuth=provider.auth.bind(provider);
provider.auth=async(path,body,...args)=>{
 if(['signup','recover','resend','token?grant_type=password'].includes(path)){
  const token=body?.gotrue_meta_security?.captcha_token;
  if(!issued.has(token)||used.has(token))throw Object.assign(new ProviderError(400,'captcha_failed'),{captchaReason:'timeout-or-duplicate'});
  used.add(token);
 }
 return originalAuth(path,body,...args);
};
const server=createPublicServer(config,{provider,logger:()=>{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));config.origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:process.env.CI||existsSync('/.dockerenv')?['--no-sandbox']:[]});
const sdk=`window.captchaRenders=0;window.captchaExecutions=0;window.captchaById={};window.turnstile={
 render:(selector,options)=>{const id='fixture-'+(++window.captchaRenders);window.captchaOptions=options;window.captchaById[id]=options;const el=document.createElement('div');el.id=id;el.style.width=options.size==='compact'?'150px':'300px';el.style.height=options.size==='compact'?'140px':'65px';el.textContent='Verificação de teste';document.querySelector(selector).append(el);return id;},
 execute:id=>{window.captchaExecutions++;window.captchaById[id]['before-interactive-callback']?.();},
 remove:id=>{document.getElementById(id)?.remove();}
};`;
async function fresh({mobile=false,failFirst=false}={}){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1366,height:900}});let requests=0;
 await context.route('https://challenges.cloudflare.com/**',r=>{requests++;return failFirst&&requests===1?r.abort():r.fulfill({contentType:'text/javascript',body:sdk});});
 const page=await context.newPage();page.setDefaultTimeout(12000);await page.clock.install();await page.goto(config.origin);await page.locator('#analytics-decline').click();
 await page.locator('#captcha-status').filter({hasText:'será iniciada ao enviar'}).waitFor();assert.equal(requests,0);
 return {context,page,requests:()=>requests};
}
async function begin(page,formId){
 const before=await page.evaluate(()=>window.captchaExecutions||0);await page.locator(formId+' button[type=submit]').click();
 await page.waitForFunction(n=>window.captchaExecutions===n+1,before);
 assert.equal(await page.locator(formId+' button[type=submit]').isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.captchaOptions.execution),'execute');
 assert.equal(await page.evaluate(()=>window.captchaOptions.retry),'never');
}
async function complete(page){const token='fixture-'+randomUUID();issued.add(token);await page.evaluate(value=>window.captchaOptions.callback(value),token);return token;}
async function fillLogin(page,pass=password){await page.locator('#login-form [name=username]').fill('a@example.invalid');await page.locator('#login-form [name=password]').fill(pass);}
async function fillSignup(page,email){await page.getByRole('button',{name:'Criar conta',exact:true}).click();const form=page.locator('#signup-form');await form.locator('[name=email]').fill(email);await form.locator('[name=password]').fill('Fixture-password-2026');await form.locator('[name=confirm]').fill('Fixture-password-2026');await form.locator('[name=privacy]').check();assert.equal(await form.evaluate(f=>f.contains(document.querySelector('#captcha-block'))&&!!(document.querySelector('#captcha-block').compareDocumentPosition(f.querySelector('button[type=submit]'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);}
async function confirm(page,email){await page.locator('#verify-form:not([hidden])').waitFor();assert.equal(await page.locator('#captcha-block').isVisible(),false);await page.locator('#verify-form [name=code]').fill(provider.codes.get(email+':signup').code);await page.locator('#verify-form button[type=submit]').click();await page.locator('#workspace:not([hidden])').waitFor();}
try{
 console.log('Verificando preenchimento demorado, interação humana e cadastro de duas contas…');
 const {page,requests}=await fresh();await fillSignup(page,'first@example.invalid');
 await page.clock.fastForward(300000);assert.equal(requests(),0); // Preencher o formulário não consome o prazo do CAPTCHA.
 await begin(page,'#signup-form');await page.clock.fastForward(45000);
 assert.equal(await page.locator('#signup-form button[type=submit]').isDisabled(),true);assert.equal(await page.locator('#auth-error').textContent(),'');
 assert.equal(provider.calls.filter(c=>c.path==='signup').length,0);
 await page.evaluate(()=>document.querySelector('#signup-form').requestSubmit());assert.equal(await page.evaluate(()=>window.captchaExecutions),1);
 const token1=await complete(page);await confirm(page,'first@example.invalid');assert.ok(used.has(token1));
 const navigation=page.waitForEvent('framenavigated',f=>f===page.mainFrame());await page.locator('#logout').click();await navigation;
 await page.locator('#captcha-status').filter({hasText:'será iniciada ao enviar'}).waitFor();await fillSignup(page,'second@example.invalid');await begin(page,'#signup-form');const token2=await complete(page);assert.notEqual(token1,token2);await confirm(page,'second@example.invalid');
 assert.notEqual(provider.users.get('first@example.invalid').id,provider.users.get('second@example.invalid').id);
 assert.deepEqual((await (await page.request.get(config.origin+'/api/records')).json()).records,[]);
 console.log('Verificando falha no SDK, nova tentativa e callbacks antigos no celular…');
 const {page:retry}=await fresh({mobile:true,failFirst:true});await fillLogin(retry);await retry.locator('#login-form button[type=submit]').click();await retry.locator('#auth-error').filter({hasText:'carregar'}).waitFor();assert.equal(await retry.locator('#login-form [name=password]').inputValue(),password);
 assert.equal(await retry.locator('#login-form button[type=submit]').isEnabled(),true);await retry.locator('#captcha-retry').click();await retry.waitForFunction(()=>window.captchaExecutions===1);assert.equal(await retry.evaluate(()=>window.captchaOptions.size),'compact');
 await retry.evaluate(()=>{window.oldOptions=window.captchaOptions;window.captchaOptions['error-callback']('110200');});await retry.locator('#auth-error').filter({hasText:'110200'}).waitFor();
 await retry.locator('#captcha-retry').click();await retry.waitForFunction(()=>window.captchaExecutions===2);await retry.evaluate(()=>window.oldOptions.callback('stale-token'));assert.equal(await retry.locator('#login-form button[type=submit]').isDisabled(),true);
 await complete(retry);await retry.locator('#workspace:not([hidden])').waitFor();assert.equal(await retry.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log('Verificando prazo finito e token novo depois de senha incorreta…');
 const {page:timeout}=await fresh();await fillLogin(timeout,'Wrong-test-password');await begin(timeout,'#login-form');await timeout.clock.fastForward(121000);await timeout.locator('#auth-error').filter({hasText:'não foi concluída a tempo'}).waitFor();
 await timeout.locator('#captcha-retry').click();await timeout.waitForFunction(()=>window.captchaExecutions===2);await complete(timeout);await timeout.locator('#auth-error').filter({hasText:'inválidos'}).waitFor();
 await timeout.locator('#login-form [name=password]').fill(password);await begin(timeout,'#login-form');await complete(timeout);await timeout.locator('#workspace:not([hidden])').waitFor();
 console.log('Verificando falha de envio sem sucesso falso e sem reiniciar o CAPTCHA…');
 const {page:mail}=await fresh();await fillSignup(mail,'mail-failure@example.invalid');
 provider.fail=path=>{if(path==='signup')throw Object.assign(new ProviderError(500,'unexpected_failure'),{authFailure:'EMAIL_DELIVERY_FAILED'});};
 await begin(mail,'#signup-form');await complete(mail);await mail.locator('#auth-error').filter({hasText:'Não foi possível enviar o código por e-mail'}).waitFor();
 assert.match(await mail.locator('#auth-error').textContent(),/EMAIL_DELIVERY_FAILED/);assert.equal(await mail.locator('#verify-form').isVisible(),false);assert.equal(await mail.locator('#signup-form [name=email]').inputValue(),'mail-failure@example.invalid');assert.equal(await mail.evaluate(()=>window.captchaExecutions),1);assert.equal(provider.users.has('mail-failure@example.invalid'),false);provider.fail=null;
 console.log('PASS: CAPTCHA executado apenas no envio, espera humana de 45s, duas contas consecutivas, tokens de uso único, erro de SDK, retry, callbacks antigos, celular, timeout e senha incorreta. Cloudflare e Auth/e-mail simulados; navegador, API e PostgreSQL executados.');
}finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});await pg.close();}
