import {api} from './api.js';
let config={publicAuth:false},current='login',onAuthenticated,cooldown=0,timer,widget=null,widgetLoading=null,captchaGeneration=0,pendingCaptcha=null,authBusy=false,captchaAttempted=false;
const $=s=>document.querySelector(s);
export function showAuth(view='login'){
 clearCaptcha();current=view;$('#login-screen').hidden=false;$('#workspace').hidden=true;
 const consent=$('#analytics-banner');if(consent)$('.auth-card h2').before(consent);
 document.querySelectorAll('[data-auth-panel]').forEach(p=>p.hidden=p.dataset.authPanel!==view);
 $('#auth-message').textContent='';$('#auth-error').textContent='';
 const titles={login:['Seu caixa começa aqui.','Entre para acompanhar seu negócio.'],signup:['Seu negócio merece clareza.','Crie sua conta e confirme seu e-mail.'],recover:['Vamos recuperar seu acesso.','Você receberá um código temporário por e-mail.'],verify:['Confira seu e-mail.','Digite o código recebido. Ele é temporário e só pode ser usado uma vez.'],reset:['Escolha uma nova senha.','Use uma senha exclusiva para esta conta.']};
 const title=titles[view]||titles.login;$('#auth-title').textContent=title[0];$('#auth-subtitle').textContent=title[1];
 const googlePanel=$('#google-panel');if(googlePanel)googlePanel.hidden=!config.googleAuth||!['login','signup'].includes(view);
 const needsCaptcha=['login','signup','recover'].includes(view);
 const captchaBlock=$('#captcha-block'),form=document.querySelector('[data-auth-panel="'+view+'"]');
 if(captchaBlock&&form){const anchor=view==='verify'?$('#resend-code'):form.querySelector('button[type="submit"]');if(anchor)anchor.before(captchaBlock);captchaBlock.hidden=!needsCaptcha||!config.captchaSiteKey;}
 $('#captcha-container').hidden=!needsCaptcha||!config.captchaSiteKey;
 if(needsCaptcha&&config.captchaSiteKey){captchaStatus('A verificação de segurança será iniciada ao enviar.');captchaRetry(false);}
 else{if($('#captcha-status'))$('#captcha-status').hidden=true;if($('#captcha-retry'))$('#captcha-retry').hidden=true;}
}
function captchaStatus(message){
 let status=$('#captcha-status');if(!status){status=document.createElement('p');status.id='captcha-status';status.className='hint';status.setAttribute('role','status');$('#captcha-container').after(status);}
 status.textContent=message;status.hidden=$('#captcha-container').hidden;
}
function captchaRetry(show){
 let button=$('#captcha-retry');if(!button){button=document.createElement('button');button.id='captcha-retry';button.type='button';button.className='text-button';button.textContent='Tentar verificação novamente';button.onclick=()=>{if(authBusy)return;if(current==='verify')$('#resend-code').click();else document.querySelector('[data-auth-panel="'+current+'"]').requestSubmit();};$('#captcha-status').after(button);}
 button.hidden=!show||$('#captcha-container').hidden;button.disabled=authBusy;
}
function captchaError(message,code='CAPTCHA_UNAVAILABLE',supportCode){const error=Error(message);error.code=code;if(/^\d{6}$/.test(String(supportCode||'')))error.supportCode=String(supportCode);return error;}
function clearCaptcha(){
 if(pendingCaptcha){const pending=pendingCaptcha;pendingCaptcha=null;pending.cancel();}
 captchaGeneration++;
 if(widget!==null){try{window.turnstile?.remove(widget);}catch{}widget=null;}
}
async function loadCaptchaSdk(){
 if(window.turnstile?.render&&window.turnstile?.execute)return window.turnstile;
 if(!widgetLoading)widgetLoading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');let done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timeout);if(error){script.remove();reject(error);}else resolve();};
  const timeout=setTimeout(()=>finish(captchaError('Não foi possível carregar a verificação de segurança. Confira a conexão e tente novamente.')),15000);
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=()=>finish();script.onerror=()=>finish(captchaError('Não foi possível carregar a verificação de segurança. Confira a conexão e tente novamente.'));document.head.append(script);
 }).catch(error=>{widgetLoading=null;throw error;});
 await widgetLoading;
 if(!window.turnstile?.render||!window.turnstile?.execute)throw captchaError('A verificação de segurança não carregou corretamente. Recarregue a página e tente novamente.');
 return window.turnstile;
}
async function getCaptchaToken(){
 if(!config.captchaSiteKey)return '';
 captchaAttempted=true;clearCaptcha();const generation=captchaGeneration;
 $('#captcha-block').hidden=false;$('#captcha-container').hidden=false;
 captchaStatus('Verificando segurança… Se aparecer uma solicitação, confirme abaixo.');captchaRetry(false);
 const sdk=await loadCaptchaSdk();
 if(generation!==captchaGeneration)throw captchaError('A verificação foi interrompida. Tente novamente.','CAPTCHA_CANCELLED');
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,value)=>{
   if(done)return;done=true;clearTimeout(timeout);if(pendingCaptcha===job)pendingCaptcha=null;
   if(error)reject(error);else{captchaStatus('Verificação concluída. Enviando sua solicitação…');resolve(value);}
  };
  const job={cancel:()=>finish(captchaError('A verificação foi interrompida. Tente novamente.','CAPTCHA_CANCELLED'))};pendingCaptcha=job;
  const active=()=>generation===captchaGeneration&&!done;
  const timeout=setTimeout(()=>finish(captchaError('A verificação não foi concluída a tempo. Tente novamente e confirme a solicitação de segurança.','CAPTCHA_TIMEOUT')),120000);
  try{
   widget=sdk.render('#captcha-container',{
    sitekey:config.captchaSiteKey,execution:'execute',appearance:'always',size:window.matchMedia('(max-width: 420px)').matches?'compact':'normal',retry:'never','refresh-expired':'manual','refresh-timeout':'manual','response-field':false,
    callback:value=>{if(!active())return;if(typeof value!=='string'||!value)finish(captchaError('Não foi possível concluir a verificação. Tente novamente.'));else finish(null,value);},
    'before-interactive-callback':()=>{if(active()){captchaStatus('Confirme que você é uma pessoa na verificação abaixo.');$('#captcha-block').scrollIntoView({block:'center'});}},
    'after-interactive-callback':()=>{if(active())captchaStatus('Concluindo a verificação de segurança…');},
    'expired-callback':()=>{if(active())finish(captchaError('A verificação expirou. Envie o formulário novamente.','CAPTCHA_EXPIRED'));},
    'timeout-callback':()=>{if(active())finish(captchaError('O prazo da verificação terminou. Envie o formulário novamente.','CAPTCHA_TIMEOUT'));},
    'unsupported-callback':()=>{if(active())finish(captchaError('Este navegador não conseguiu executar a verificação. Atualize-o ou tente outro navegador.'));},
    'error-callback':code=>{if(active())finish(captchaError('Não foi possível concluir a verificação de segurança. Tente novamente.','CAPTCHA_WIDGET_ERROR',code));return true;}
   });
   if(done){try{sdk.remove(widget);}catch{}widget=null;return;}
   sdk.execute(widget);
  }catch{finish(captchaError('Não foi possível iniciar a verificação de segurança. Recarregue a página e tente novamente.'));}
 });
}
function resendTimer(seconds){cooldown=Date.now()+seconds*1000;clearInterval(timer);const update=()=>{const left=Math.max(0,Math.ceil((cooldown-Date.now())/1000));$('#resend-code').disabled=authBusy||left>0;$('#resend-code').textContent=left?'Reenviar em '+left+'s':'Reenviar código';if(!left)clearInterval(timer);};update();timer=setInterval(update,1000);}
async function submit(form,action){
 if(authBusy)return;authBusy=true;captchaAttempted=false;
 const startedView=current,controls=[...new Set([...form.elements,...document.querySelectorAll('[data-auth-link]')])].map(node=>({node,disabled:node.disabled}));
 controls.forEach(({node})=>node.disabled=true);if($('#captcha-retry'))$('#captcha-retry').disabled=true;
 const primary=form.querySelector('button[type="submit"]'),label=primary?[...primary.childNodes]:[];if(primary)primary.textContent='Aguarde…';
 $('#auth-error').textContent='';$('#auth-message').textContent='';
 try{await action();}catch(error){$('#auth-error').textContent=error.message+(error.supportCode?' Código de suporte: '+error.supportCode+'.':'')+(error.status>=500&&error.code?' Código de suporte: '+error.code+'.':'');if(error.retryAfter&&current==='verify')resendTimer(error.retryAfter);}
 finally{
  authBusy=false;controls.forEach(({node,disabled})=>node.disabled=disabled);if(primary)primary.replaceChildren(...label);
  if(current==='verify'&&cooldown>Date.now())$('#resend-code').disabled=true;
  if(!$('#login-screen').hidden&&current===startedView&&captchaAttempted){clearCaptcha();captchaStatus('Para tentar novamente, envie o formulário. A verificação será iniciada automaticamente.');captchaRetry(true);}
 }
}
export async function initAuth(callback){
 onAuthenticated=callback;let configFailed=false;
 try{config=await api('config');}catch{configFailed=true;}
 document.querySelectorAll('[data-auth-link]').forEach(b=>b.onclick=()=>showAuth(b.dataset.authLink));
 document.querySelectorAll('[data-password-toggle]').forEach(b=>b.onclick=()=>{const input=document.getElementById(b.dataset.passwordToggle);const visible=input.type==='password';input.type=visible?'text':'password';b.textContent=visible?'Ocultar':'Mostrar';b.setAttribute('aria-pressed',String(visible));});
 document.querySelectorAll('[data-public-auth]').forEach(b=>{b.disabled=!config.publicAuth;b.hidden=config.emailCodesEnabled===false;});
 document.querySelectorAll('.auth-switch').forEach(p=>p.hidden=config.emailCodesEnabled===false);
 $('#auth-unavailable').hidden=config.publicAuth===true||config.googleAuth===true;
 $('#google-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
  const f=e.target,result=await api('oauth/google/start','POST',{privacyAccepted:f.elements.privacy.checked,remember:f.elements.remember.checked});
  const target=new URL(result.url);if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.pathname!=='/auth/v1/authorize'||target.searchParams.get('provider')!=='google')throw Error('Não foi possível iniciar o login com Google.');
  window.location.assign(target.href);
 });};
 $('#login-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
  const f=e.target,data={username:f.elements.username.value,password:f.elements.password.value,remember:f.elements.remember.checked};data.captchaToken=await getCaptchaToken();await api('login','POST',data);f.elements.password.value='';await onAuthenticated();
 });};
 $('#signup-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
  const f=e.target;if(f.elements.password.value!==f.elements.confirm.value)throw Error('As senhas precisam ser iguais.');
  const data={email:f.elements.email.value,password:f.elements.password.value,privacyAccepted:f.elements.privacy.checked,remember:f.elements.remember.checked};data.captchaToken=await getCaptchaToken();const result=await api('signup','POST',data);
  f.elements.password.value='';f.elements.confirm.value='';showAuth('verify');$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);
 });};
 $('#recover-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const email=e.target.elements.email.value,captchaToken=await getCaptchaToken();const result=await api('recover','POST',{email,captchaToken});showAuth('verify');$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);});};
 $('#verify-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const result=await api('verify','POST',{code:e.target.elements.code.value.trim()});e.target.elements.code.value='';if(result.next==='reset')showAuth('reset');else await onAuthenticated();});};
 $('#reset-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const f=e.target;if(f.elements.password.value!==f.elements.confirm.value)throw Error('As senhas precisam ser iguais.');const result=await api('reset-password','POST',{password:f.elements.password.value});f.reset();showAuth('login');$('#auth-message').textContent=result.message;});};
 $('#resend-code').onclick=()=>submit($('#verify-form'),async()=>{
  if(cooldown>Date.now())return;
  const captchaToken=await getCaptchaToken();const result=await api('resend','POST',{captchaToken});$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);
 });
 showAuth(config.authStage?.view||'login');
 if(configFailed)$('#auth-error').textContent='Não foi possível conectar ao servidor. Tente recarregar.';
 const notices={google_success:'',google_cancelled:'Você cancelou o acesso pelo Google. Pode tentar novamente.',google_expired:'O prazo para entrar com Google terminou ou o link já foi usado. Clique em Continuar com Google novamente.',google_unavailable:'O login com Google precisa ser configurado pelo responsável.',google_failed:'Não foi possível concluir o acesso pelo Google. Tente novamente ou contate o suporte.',google_unverified:'O Google precisa confirmar o e-mail desta conta antes de continuar.',google_registration_paused:'Novas contas estão temporariamente indisponíveis. O responsável precisa conferir a configuração e o backup.'};
 const location=new URL(window.location.href),notice=location.searchParams.get('auth');
 if(notice&&Object.hasOwn(notices,notice)){if(notices[notice])$('#auth-error').textContent=notices[notice];location.searchParams.delete('auth');history.replaceState(null,'',location.pathname+location.search+location.hash);}

 if(config.authStage){if(config.authStage.view==='verify')resendTimer(Math.min(60,Math.max(0,Math.ceil((config.authStage.until-Date.now())/1000))));}
 return config;
}
