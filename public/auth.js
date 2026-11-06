import {api} from './api.js';
let config={publicAuth:false},current='login',onAuthenticated,cooldown=0,timer,widget=null,token='',widgetLoading=null,captchaTimer;
const $=s=>document.querySelector(s);
export function showAuth(view='login'){
 current=view;$('#login-screen').hidden=false;$('#workspace').hidden=true;
 document.querySelectorAll('[data-auth-panel]').forEach(p=>p.hidden=p.dataset.authPanel!==view);
 $('#auth-message').textContent='';$('#auth-error').textContent='';
 const titles={login:['Seu caixa começa aqui.','Entre para acompanhar seu negócio.'],signup:['Seu negócio merece clareza.','Crie sua conta e confirme seu e-mail.'],recover:['Vamos recuperar seu acesso.','Você receberá um código temporário por e-mail.'],verify:['Confira seu e-mail.','Digite o código recebido. Ele é temporário e só pode ser usado uma vez.'],reset:['Escolha uma nova senha.','Use uma senha exclusiva para esta conta.']};
 const title=titles[view]||titles.login;$('#auth-title').textContent=title[0];$('#auth-subtitle').textContent=title[1];
 const needsCaptcha=['login','signup','recover','verify'].includes(view);
 $('#captcha-container').hidden=!needsCaptcha||!config.captchaSiteKey;
 if(needsCaptcha&&config.captchaSiteKey)void loadCaptcha();
 else{clearTimeout(captchaTimer);if($('#captcha-status'))$('#captcha-status').hidden=true;if($('#captcha-retry'))$('#captcha-retry').hidden=true;}
}
function captchaStatus(message){
 let status=$('#captcha-status');if(!status){status=document.createElement('p');status.id='captcha-status';status.className='hint';status.setAttribute('role','status');$('#captcha-container').after(status);}
 status.textContent=message;status.hidden=$('#captcha-container').hidden;
}
function captchaRetry(show){
 let button=$('#captcha-retry');if(!button){button=document.createElement('button');button.id='captcha-retry';button.type='button';button.className='text-button';button.textContent='Tentar verificação novamente';button.onclick=()=>loadCaptcha();$('#captcha-status').after(button);}
 button.hidden=!show||$('#captcha-container').hidden;
}
function captchaFailed(){clearTimeout(captchaTimer);token='';captchaStatus('Não foi possível concluir a verificação de segurança. Confira a conexão e tente novamente.');captchaRetry(true);}
function captchaWaiting(){clearTimeout(captchaTimer);token='';captchaStatus('Aguardando a verificação de segurança…');captchaRetry(false);captchaTimer=setTimeout(captchaFailed,30000);}
async function loadCaptcha(){
 captchaWaiting();
 try{
  if(!window.turnstile?.render){
   if(!widgetLoading)widgetLoading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');let settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timeout);if(error){script.remove();reject(error);}else resolve();};
    const timeout=setTimeout(()=>finish(Error('Verificação indisponível.')),15000);
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=()=>finish();script.onerror=()=>finish(Error('Verificação indisponível.'));document.head.append(script);
   });
   await widgetLoading;
  }
  if(widget===null)widget=window.turnstile.render('#captcha-container',{
   sitekey:config.captchaSiteKey,retry:'never','refresh-expired':'manual','refresh-timeout':'manual',
   callback:v=>{clearTimeout(captchaTimer);token=v;captchaStatus('Verificação concluída.');captchaRetry(false);},
   'expired-callback':()=>{clearTimeout(captchaTimer);token='';captchaStatus('A verificação expirou. Faça uma nova verificação.');captchaRetry(true);},
   'error-callback':()=>{captchaFailed();return true;},'timeout-callback':captchaFailed,'unsupported-callback':captchaFailed
  });else window.turnstile.reset(widget);
 }catch{widgetLoading=null;captchaFailed();}
}
function resetCaptcha(){token='';clearTimeout(captchaTimer);if(widget!==null&&!$('#login-screen').hidden){captchaWaiting();try{window.turnstile?.reset(widget);}catch{captchaFailed();}}}
function requireCaptcha(){if(config.captchaSiteKey&&!token){if(widget===null)void loadCaptcha();throw Error('Conclua a verificação de segurança antes de continuar. Se ela não terminar, clique em tentar novamente.');}}
function resendTimer(seconds){cooldown=Date.now()+seconds*1000;clearInterval(timer);const update=()=>{const left=Math.max(0,Math.ceil((cooldown-Date.now())/1000));$('#resend-code').disabled=left>0;$('#resend-code').textContent=left?'Reenviar em '+left+'s':'Reenviar código';if(!left)clearInterval(timer);};update();timer=setInterval(update,1000);}
async function submit(form,action){
 const startedView=current,buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('#auth-error').textContent='';$('#auth-message').textContent='';
 try{await action();}catch(error){$('#auth-error').textContent=error.message;if(error.retryAfter&&current==='verify')resendTimer(error.retryAfter);}finally{buttons.forEach(b=>b.disabled=false);if(current==='verify'&&cooldown>Date.now())$('#resend-code').disabled=true;if(current===startedView)resetCaptcha();}
}
export async function initAuth(callback){
 onAuthenticated=callback;let configFailed=false;
 try{config=await api('config');}catch{configFailed=true;}
 document.querySelectorAll('[data-auth-link]').forEach(b=>b.onclick=()=>showAuth(b.dataset.authLink));
 document.querySelectorAll('[data-password-toggle]').forEach(b=>b.onclick=()=>{const input=document.getElementById(b.dataset.passwordToggle);const visible=input.type==='password';input.type=visible?'text':'password';b.textContent=visible?'Ocultar':'Mostrar';b.setAttribute('aria-pressed',String(visible));});
 document.querySelectorAll('[data-public-auth]').forEach(b=>{b.disabled=!config.publicAuth;});
 $('#auth-unavailable').hidden=config.publicAuth===true;
 $('#login-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
  requireCaptcha();const f=e.target;await api('login','POST',{username:f.elements.username.value,password:f.elements.password.value,remember:f.elements.remember.checked,captchaToken:token});f.elements.password.value='';await onAuthenticated();
 });};
 $('#signup-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
  requireCaptcha();const f=e.target;if(f.elements.password.value!==f.elements.confirm.value)throw Error('As senhas precisam ser iguais.');
  const result=await api('signup','POST',{email:f.elements.email.value,password:f.elements.password.value,privacyAccepted:f.elements.privacy.checked,remember:f.elements.remember.checked,captchaToken:token});
  f.elements.password.value='';f.elements.confirm.value='';showAuth('verify');$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);
 });};
 $('#recover-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{requireCaptcha();const result=await api('recover','POST',{email:e.target.elements.email.value,captchaToken:token});showAuth('verify');$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);});};
 $('#verify-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const result=await api('verify','POST',{code:e.target.elements.code.value.trim()});e.target.elements.code.value='';if(result.next==='reset')showAuth('reset');else await onAuthenticated();});};
 $('#reset-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const f=e.target;if(f.elements.password.value!==f.elements.confirm.value)throw Error('As senhas precisam ser iguais.');const result=await api('reset-password','POST',{password:f.elements.password.value});f.reset();showAuth('login');$('#auth-message').textContent=result.message;});};
 $('#resend-code').onclick=()=>submit($('#verify-form'),async()=>{
  if(cooldown>Date.now())return;
  // Um CAPTCHA novo é solicitado antes de reenviar quando o provedor o exige.
  if(config.captchaSiteKey&&!token){$('#captcha-container').hidden=false;await loadCaptcha();throw Error('Conclua a verificação de segurança e clique em reenviar novamente.');}
  const result=await api('resend','POST',{captchaToken:token});resetCaptcha();$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);
 });
 showAuth(config.authStage?.view||'login');
 if(configFailed)$('#auth-error').textContent='Não foi possível conectar ao servidor. Tente recarregar.';
 if(config.authStage){if(config.authStage.view==='verify')resendTimer(Math.min(60,Math.max(0,Math.ceil((config.authStage.until-Date.now())/1000))));}
 return config;
}
