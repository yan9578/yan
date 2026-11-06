import {api} from './api.js';
let config={publicAuth:false},current='login',onAuthenticated,cooldown=0,timer,widget=null,token='',widgetLoading=null;
const $=s=>document.querySelector(s);
export function showAuth(view='login'){
 current=view;$('#login-screen').hidden=false;$('#workspace').hidden=true;
 document.querySelectorAll('[data-auth-panel]').forEach(p=>p.hidden=p.dataset.authPanel!==view);
 $('#auth-message').textContent='';$('#auth-error').textContent='';
 const titles={login:['Seu caixa começa aqui.','Entre para acompanhar seu negócio.'],signup:['Seu negócio merece clareza.','Crie sua conta e confirme seu e-mail.'],recover:['Vamos recuperar seu acesso.','Você receberá um código temporário por e-mail.'],verify:['Confira seu e-mail.','Digite o código recebido. Ele é temporário e só pode ser usado uma vez.'],reset:['Escolha uma nova senha.','Use uma senha exclusiva para esta conta.']};
 const title=titles[view]||titles.login;$('#auth-title').textContent=title[0];$('#auth-subtitle').textContent=title[1];
 const needsCaptcha=['login','signup','recover','verify'].includes(view);
 $('#captcha-container').hidden=!needsCaptcha||!config.captchaSiteKey;
 if(needsCaptcha&&config.captchaSiteKey)loadCaptcha();
}
async function loadCaptcha(){
 if(!widgetLoading)widgetLoading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.onload=resolve;script.onerror=reject;document.head.append(script);
 });
 try{await widgetLoading;if(widget===null)widget=window.turnstile.render('#captcha-container',{sitekey:config.captchaSiteKey,callback:v=>{token=v;},'expired-callback':()=>{token='';},'error-callback':()=>{token='';}});else resetCaptcha();}
 catch{$('#auth-error').textContent='Não foi possível carregar a verificação de segurança. Confira a conexão e recarregue.';}
}
function resetCaptcha(){token='';if(widget!==null)window.turnstile?.reset(widget);}
function resendTimer(seconds){cooldown=Date.now()+seconds*1000;clearInterval(timer);const update=()=>{const left=Math.max(0,Math.ceil((cooldown-Date.now())/1000));$('#resend-code').disabled=left>0;$('#resend-code').textContent=left?'Reenviar em '+left+'s':'Reenviar código';if(!left)clearInterval(timer);};update();timer=setInterval(update,1000);}
async function submit(form,action){
 const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);$('#auth-error').textContent='';$('#auth-message').textContent='';
 try{await action();}catch(error){$('#auth-error').textContent=error.message;if(error.retryAfter&&current==='verify')resendTimer(error.retryAfter);}finally{buttons.forEach(b=>b.disabled=false);if(current==='verify'&&cooldown>Date.now())$('#resend-code').disabled=true;resetCaptcha();}
}
export async function initAuth(callback){
 onAuthenticated=callback;
 try{config=await api('config');}catch{$('#auth-error').textContent='Não foi possível conectar ao servidor. Tente recarregar.';}
 document.querySelectorAll('[data-auth-link]').forEach(b=>b.onclick=()=>showAuth(b.dataset.authLink));
 document.querySelectorAll('[data-password-toggle]').forEach(b=>b.onclick=()=>{const input=document.getElementById(b.dataset.passwordToggle);const visible=input.type==='password';input.type=visible?'text':'password';b.textContent=visible?'Ocultar':'Mostrar';b.setAttribute('aria-pressed',String(visible));});
 document.querySelectorAll('[data-public-auth]').forEach(b=>{b.disabled=!config.publicAuth;});
 $('#auth-unavailable').hidden=config.publicAuth===true;
 $('#login-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
  const f=e.target;await api('login','POST',{username:f.elements.username.value,password:f.elements.password.value,remember:f.elements.remember.checked,captchaToken:token});f.elements.password.value='';await onAuthenticated();
 });};
 $('#signup-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
  const f=e.target;if(f.elements.password.value!==f.elements.confirm.value)throw Error('As senhas precisam ser iguais.');
  const result=await api('signup','POST',{email:f.elements.email.value,password:f.elements.password.value,privacyAccepted:f.elements.privacy.checked,remember:f.elements.remember.checked,captchaToken:token});
  f.elements.password.value='';f.elements.confirm.value='';showAuth('verify');$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);
 });};
 $('#recover-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const result=await api('recover','POST',{email:e.target.elements.email.value,captchaToken:token});showAuth('verify');$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);});};
 $('#verify-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const result=await api('verify','POST',{code:e.target.elements.code.value.trim()});e.target.elements.code.value='';if(result.next==='reset')showAuth('reset');else await onAuthenticated();});};
 $('#reset-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{const f=e.target;if(f.elements.password.value!==f.elements.confirm.value)throw Error('As senhas precisam ser iguais.');const result=await api('reset-password','POST',{password:f.elements.password.value});f.reset();showAuth('login');$('#auth-message').textContent=result.message;});};
 $('#resend-code').onclick=()=>submit($('#verify-form'),async()=>{
  if(cooldown>Date.now())return;
  // Um CAPTCHA novo é solicitado antes de reenviar quando o provedor o exige.
  if(config.captchaSiteKey&&!token){$('#captcha-container').hidden=false;await loadCaptcha();throw Error('Conclua a verificação de segurança e clique em reenviar novamente.');}
  const result=await api('resend','POST',{captchaToken:token});resetCaptcha();$('#auth-message').textContent=result.message;resendTimer(result.resendAfter||60);
 });
 if(config.authStage){showAuth(config.authStage.view);if(config.authStage.view==='verify')resendTimer(Math.min(60,Math.max(0,Math.ceil((config.authStage.until-Date.now())/1000))));}
 return config;
}
