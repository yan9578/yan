import {Supabase,ProviderError} from './supabase.js';
import {opaque,sha256,secretKey,seal,unseal,cookie,cookies} from './security.js';
import {email,password,validateRecords,validateDre,revision} from './validation.js';
import {createHmac,createHash} from 'node:crypto';

class HttpError extends Error{constructor(status,message,code='REQUEST_FAILED',retryAfter){super(message);this.status=status;this.code=code;this.retryAfter=retryAfter;}}
const invalid=()=>new HttpError(401,'Usuário, senha ou código inválidos.','AUTH_FAILED');
const noSession=()=>new HttpError(401,'Sua sessão terminou. Entre novamente.','SESSION_REQUIRED');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FEATURES=new Set(['cash','dre','account','admin']);
const GOOGLE_CALLBACK='/api/oauth/google/callback';
const verifiedGoogle=user=>Array.isArray(user?.identities)&&user.identities.some(i=>i.provider==='google'&&i.identity_data?.email_verified===true&&String(i.identity_data.email||'').toLowerCase()===String(user.email||'').toLowerCase()&&!!i.identity_data.sub&&(!i.user_id||i.user_id===user.id));
const genericEmail='Se o e-mail puder receber essa solicitação, enviaremos um código temporário. Confira também a pasta de spam.';
const tokenData=data=>({access:data.access_token,refresh:data.refresh_token,expiresAt:Date.now()+(data.expires_in||3600)*1000});

export function createPublicApi(config,{provider=new Supabase(config),clock=()=>Date.now(),logger=entry=>console.error(JSON.stringify(entry)),fetcher=fetch}={}){
 const refreshes=new Map();let hostingCache=null;
 const hmac=(value,purpose)=>createHmac('sha256',secretKey(config.secret,purpose)).update(value).digest('hex');
 async function rate(bucket,key,max,seconds){
  const data=await provider.rpc('app_limit',{p_bucket:bucket,p_key_hash:hmac(key,'rate'),p_max:max,p_seconds:seconds},{service:true});
  if(!data?.allowed)throw new HttpError(429,'Muitas tentativas. Aguarde um pouco antes de tentar novamente.','RATE_LIMIT',data?.retryAfter||60);
 }
 async function event(kind,userId=null,feature=null,code=null,visitor=null){
  try{await provider.rpc('app_event',{p_kind:kind,p_user:userId,p_visitor:visitor,p_feature:feature,p_code:code},{service:true,timeout:3000});}
  catch{logger({event:'TELEMETRY_UNAVAILABLE'});}
 }
 async function authenticate(req,{allowExpired=false}={}){
  const id=cookies(req.headers.get('cookie')||'').cc_session;
  if(!/^[a-f0-9]{64}$/.test(id||''))throw noSession();
  const hash=sha256(id),row=await provider.rpc('app_session',{p_action:'get',p_hash:hash},{service:true});
  if(!row||!UUID.test(row.userId))throw noSession();
  let tokens;try{tokens=unseal(row.tokens,config.secret);}catch{throw noSession();}
  if(tokens.expiresAt<clock()+30000){
   if(!refreshes.has(hash))refreshes.set(hash,(async()=>{
    try{
     const fresh=await provider.auth('token?grant_type=refresh_token',{refresh_token:tokens.refresh});
     const data=tokenData(fresh);const result=await provider.rpc('app_session',{p_action:'rotate',p_hash:hash,p_tokens:seal(data,config.secret),p_version:row.version},{service:true});
     if(result?.ok)return data;
     const newer=await provider.rpc('app_session',{p_action:'get',p_hash:hash},{service:true});if(!newer)throw noSession();return unseal(newer.tokens,config.secret);
    }catch(err){
     if(err instanceof ProviderError&&[400,401,403].includes(err.status)){await provider.rpc('app_session',{p_action:'delete',p_hash:hash},{service:true});throw noSession();}throw err;
    }
   })().finally(()=>refreshes.delete(hash)));
   tokens=await refreshes.get(hash);
  }
  let user;try{user=await provider.auth('user',undefined,tokens.access,'GET');}catch(err){if(err instanceof ProviderError&&[401,403,404].includes(err.status))throw noSession();throw err;}
  if(user.id!==row.userId||(!user.email_confirmed_at&&!user.confirmed_at))throw noSession();
  return {id,hash,tokens,user,remember:row.remember};
 }
 async function createSession(data,remember,setCookie,policyAccepted=false){
  if(!data?.access_token||!data?.refresh_token||!UUID.test(data.user?.id||''))throw invalid();
  if(!data.user.email_confirmed_at&&!data.user.confirmed_at)throw new HttpError(403,'Confirme seu e-mail antes de entrar.','EMAIL_UNCONFIRMED');
  if(policyAccepted)await provider.rpc('app_policy_ack',{p_user:data.user.id,p_version:'2026-11-06'},{service:true});
  const id=opaque(),age=remember?30*86400:8*3600;
  await provider.rpc('app_session',{p_action:'create',p_hash:sha256(id),p_user:data.user.id,p_tokens:seal(tokenData(data),config.secret),p_remember:remember,p_expires:new Date(clock()+age*1000).toISOString()},{service:true});
  setCookie('cc_session',id,remember?age:undefined);await event('login',data.user.id,'account');
  return data.user;
 }
 function captcha(body){
  if(config.production&&config.captchaSiteKey&&!body.captchaToken)throw new HttpError(400,'Conclua a verificação de segurança.','CAPTCHA_REQUIRED');
  return body.captchaToken?{gotrue_meta_security:{captcha_token:String(body.captchaToken).slice(0,4096)}}:{};
 }
 async function publicAuth(){
  if(config.emailCodesEnabled===false||!config.publicAuth||!config.emailReady)throw new HttpError(503,'O cadastro e a recuperação por código de e-mail estão desativados. Use Continuar com Google.','EMAIL_NOT_CONFIGURED');
 }
 async function backupAdmission(){
  const health=await provider.rpc('app_backup_health',{}, {service:true});
  if(!health.lastExternalAt||clock()-Date.parse(health.lastExternalAt)>48*3600000)throw new HttpError(503,'Novas contas estão temporariamente indisponíveis. Tente mais tarde.','BACKUP_NOT_CURRENT');
 }
 function providerAuthError(err){
  if(!(err instanceof ProviderError))return;
  if(err.code==='captcha_failed'&&['missing-input-secret','invalid-input-secret'].includes(err.captchaReason))throw new HttpError(400,'A configuração da verificação de segurança precisa ser corrigida pelo responsável.','CAPTCHA_CONFIGURATION');
  if(err.code==='captcha_failed'&&err.captchaReason==='timeout-or-duplicate')throw new HttpError(400,'A verificação expirou ou já foi utilizada. Faça uma nova verificação antes de tentar novamente.','CAPTCHA_EXPIRED');
  if(err.code==='captcha_failed')throw new HttpError(400,'A verificação de segurança não foi aceita. Conclua uma nova verificação.','CAPTCHA_FAILED');
  if(err.code==='weak_password')throw new HttpError(400,'Escolha uma senha mais forte, com pelo menos 10 caracteres, letras e números.','WEAK_PASSWORD');
 }
 async function emailRequest(path,body){
  try{await provider.auth(path,body);}catch(err){
   providerAuthError(err);
   // Somente situações relacionadas à existência da conta recebem a resposta genérica.
   if(!(err instanceof ProviderError&&[400,422].includes(err.status)&&['user_already_exists','email_exists','user_not_found','email_not_confirmed'].includes(err.code)))throw err;
  }
 }

 async function hosting(){
  if(config.hostingProvider==='vercel')return {provider:'vercel',configured:false};
  if(!config.netlifyToken||!config.netlifyAccount)return {configured:false};
  if(hostingCache&&hostingCache.until>clock())return hostingCache.data;
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(config.netlifyAccount))return {configured:true,available:false};
  try{
   const response=await fetcher('https://api.netlify.com/api/v1/'+encodeURIComponent(config.netlifyAccount)+'/builds/status',{headers:{Authorization:'Bearer '+config.netlifyToken},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error();const raw=await response.json(),data=Array.isArray(raw)?raw[0]:raw;
   const number=v=>(typeof v==='number'||(typeof v==='string'&&v.trim()!==''))&&Number.isFinite(Number(v))?Number(v):null;
   const result={configured:true,available:true,scope:'team',buildMinutes:number(data?.minutes?.current),includedMinutes:number(data?.minutes?.included_minutes),updatedAt:data?.minutes?.last_updated_at||null,activeBuilds:number(data?.active)};
   hostingCache={data:result,until:clock()+600000};return result;
  }catch{return {configured:true,available:false};}
 }
 return async function handle(request,context={}){
  const url=new URL(request.url),path=url.pathname.replace(/^\/\.netlify\/functions\/api/,'/api'),method=request.method;
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
  if(config.production)headers.set('Strict-Transport-Security','max-age=31536000');
  const requestId=opaque().slice(0,16);headers.set('X-Request-Id',requestId);
  const setCookie=(name,value,maxAge,options={})=>headers.append('Set-Cookie',cookie(name,value,{...options,secure:config.production,maxAge}));
  const clear=name=>setCookie(name,'',0);
  const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers});
  let identity=null,feature=null;
  try{
   if(!['GET','POST','PUT'].includes(method))throw new HttpError(405,'Método não permitido.');
   // O diagnóstico público pode ser aberto por um link externo. APIs da conta
   // e todas as alterações continuam exigindo as proteções de origem.
   const publicConfig=method==='GET'&&path==='/api/config',googleCallback=method==='GET'&&path===GOOGLE_CALLBACK;
   if(!publicConfig&&!googleCallback&&request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Origem não autorizada.','BAD_ORIGIN');
   if(method!=='GET'&&(request.headers.get('origin')!==config.origin||!request.headers.get('content-type')?.startsWith('application/json')))throw new HttpError(403,'Origem não autorizada.','BAD_ORIGIN');
   let body={};if(method!=='GET'){
    const raw=await request.text();if(Buffer.byteLength(raw)>2_000_000)throw new HttpError(413,'Solicitação muito grande.');
    try{body=JSON.parse(raw);}catch{throw new HttpError(400,'Dados inválidos.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Dados inválidos.');
   }
   const ip=context.ip||'unknown';
   if(path==='/api/oauth/google/start'&&method==='POST'){
    if(config.googleAuth!==true)throw new HttpError(503,'O login com Google está indisponível.','GOOGLE_NOT_CONFIGURED');
    if(body.privacyAccepted!==true)throw new HttpError(400,'Leia a política de privacidade e marque a confirmação para continuar.','PRIVACY_REQUIRED');
    if(!config.privacyController||!/^\S+@\S+\.\S+$/.test(config.privacyContact||''))throw new HttpError(503,'O responsável precisa concluir a configuração de privacidade.','GOOGLE_NOT_CONFIGURED');
    await rate('google-start-ip',ip,20,900);
    const settings=await provider.auth('settings',undefined,undefined,'GET');
    if(settings?.external?.google!==true)throw new HttpError(503,'O responsável precisa configurar o provedor Google no Supabase para ativar este acesso.','GOOGLE_NOT_CONFIGURED');
    const verifier=opaque(),flow={id:opaque(),verifier,until:clock()+600000,remember:body.remember===true};
    const target=new URL(config.url+'/auth/v1/authorize');target.search=new URLSearchParams({provider:'google',redirect_to:config.origin+GOOGLE_CALLBACK,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256',scopes:'openid',prompt:'select_account'}).toString();
    setCookie('cc_google',seal(flow,config.secret,'google-oauth'),600,{path:GOOGLE_CALLBACK,sameSite:'Lax'});clear('cc_challenge');clear('cc_recovery');
    return respond(200,{url:target.href});
   }
   if(googleCallback){
    // Lax é restrito ao cookie temporário de retorno. A sessão continua Strict.
    setCookie('cc_google','',0,{path:GOOGLE_CALLBACK,sameSite:'Lax'});headers.set('Referrer-Policy','no-referrer');
    const redirect=notice=>{headers.set('Location',config.origin+'/?'+new URLSearchParams({auth:notice})+'#');return new Response(null,{status:303,headers});};
    let result,established=false;
    try{
     if(config.googleAuth!==true)return redirect('google_unavailable');
     let flow;try{flow=unseal(cookies(request.headers.get('cookie')).cc_google||'',config.secret,'google-oauth');}catch{return redirect('google_expired');}
     if(!Number.isFinite(flow.until)||flow.until<=clock()||!(/^[a-f0-9]{64}$/).test(flow.id||'')||!(/^[a-f0-9]{64}$/).test(flow.verifier||''))return redirect('google_expired');
     const once=await provider.rpc('app_limit',{p_bucket:'google-oauth-once',p_key_hash:hmac(flow.id,'oauth-once'),p_max:1,p_seconds:600},{service:true});
     if(!once?.allowed)return redirect('google_expired');
     await rate('google-callback-ip',ip,30,900);
     if(url.searchParams.has('error'))return redirect(url.searchParams.get('error_code')==='signup_disabled'?'google_registration_paused':url.searchParams.get('error')==='access_denied'?'google_cancelled':'google_failed');
     const code=url.searchParams.get('code');if(!/^[A-Za-z0-9_-]{12,2048}$/.test(code||''))return redirect('google_failed');
     result=await provider.auth('token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier});
     if(!result?.access_token||!result?.refresh_token)return redirect('google_failed');
     const user=await provider.auth('user',undefined,result.access_token,'GET');
     if(!verifiedGoogle(user)||(!user.email_confirmed_at&&!user.confirmed_at)||!UUID.test(user.id||''))return redirect('google_unverified');
     // O UUID validado pelo Supabase é a única identidade usada para os dados.
     // Nenhuma conta é mesclada por um e-mail informado pelo navegador.
     const [details,cash,dre,admin]=await Promise.all([provider.rpc('app_account_details',{}, {token:result.access_token}),provider.request('/rest/v1/cashbooks?select=user_id&limit=1',{token:result.access_token}),provider.request('/rest/v1/dre_books?select=user_id&limit=1',{token:result.access_token}),provider.rpc('app_is_admin',{}, {token:result.access_token})]);
     const known=admin===true||details?.policyAcknowledgements?.length>0||(Array.isArray(cash)&&cash.length===1)||(Array.isArray(dre)&&dre.length===1);
     if(!known){if(!config.backupReady)return redirect('google_registration_paused');await backupAdmission();}
     await createSession({...result,user},flow.remember,setCookie,true);clear('cc_challenge');clear('cc_recovery');
     established=true;
     return redirect('google_success');
    }catch(error){
     logger({requestId,event:'GOOGLE_AUTH_FAILED',code:error instanceof HttpError?error.code:error instanceof ProviderError?'PROVIDER_ERROR':'REQUEST_FAILED'});
     return redirect(error?.code==='BACKUP_NOT_CURRENT'?'google_registration_paused':'google_failed');
    }finally{
     if(result?.access_token&&!established){try{await provider.auth('logout?scope=local',{},result.access_token);}catch{}}
    }
   }
   if(path==='/api/config'&&method==='GET'){
    let authStage=null;
    if(config.emailCodesEnabled===false){clear('cc_challenge');clear('cc_recovery');}
    else{try{const c=unseal(cookies(request.headers.get('cookie')).cc_challenge||'',config.secret,'challenge');if(c.until>clock())authStage={view:'verify',type:c.type,until:c.until};}catch{}
     if(cookies(request.headers.get('cookie')).cc_recovery)authStage={view:'reset'};}
    return respond(200,{passwordLoginVisible:config.passwordLoginVisible===true,publicAuth:config.emailCodesEnabled!==false&&config.publicAuth&&config.emailReady,googleAuth:config.googleAuth===true,emailCodesEnabled:config.emailCodesEnabled!==false,captchaSiteKey:config.captchaSiteKey,privacy:{controller:config.privacyController,contact:config.privacyContact},serverMode:true,authStage});
   }
   if(path==='/api/login'&&method==='POST'){
    await rate('login-ip',ip,20,900);
    const raw=String(body.username||body.email||'').trim().toLowerCase();let address;try{address=email(config.aliases[raw]||raw);}catch{throw invalid();}
    await rate('login-account',address,8,900);
    if(typeof body.password!=='string'||body.password.length>256)throw invalid();
    let data;try{data=await provider.auth('token?grant_type=password',{email:address,password:body.password,...captcha(body)});}catch(err){providerAuthError(err);if(err instanceof ProviderError&&[400,401,403,422].includes(err.status)){await event('error',null,'account','LOGIN_FAILED');throw invalid();}throw err;}
    const user=await createSession(data,body.remember===true,setCookie);clear('cc_challenge');clear('cc_recovery');
    return respond(200,{username:user.email.split('@')[0]});
   }
   if((path==='/api/signup'||path==='/api/recover')&&method==='POST'){
    await publicAuth();await rate('email-ip',ip,10,3600);let address;try{address=email(body.email);}catch(err){throw new HttpError(400,err.message);}
    const type=path.endsWith('signup')?'signup':'recovery';
    const captchaBody=captcha(body);
    let signupPassword;if(type==='signup'){try{signupPassword=password(body.password);}catch(err){throw new HttpError(400,err.message);}if(body.privacyAccepted!==true)throw new HttpError(400,'Leia a política de privacidade para criar sua conta.');await backupAdmission();}
    await rate('email-cooldown',address,1,60);await rate('email-day',address,6,86400);
    if(type==='signup'){
     const settings=await provider.auth('settings',undefined,undefined,'GET');
     if(settings?.disable_signup===true)throw new HttpError(503,'Novas contas estão temporariamente indisponíveis.','SIGNUP_DISABLED');
     if(settings?.mailer_autoconfirm===true)throw new HttpError(503,'A confirmação de e-mail precisa ser ativada pelo responsável.','EMAIL_NOT_CONFIGURED');
     await emailRequest('signup',{email:address,password:signupPassword,...captchaBody});
    }else await emailRequest('recover',{email:address,...captchaBody});
    setCookie('cc_challenge',seal({email:address,type,until:clock()+600000,remember:body.remember===true,policyAccepted:type==='signup'},config.secret,'challenge'),600);
    return respond(200,{message:genericEmail,next:'verify',type,expiresIn:600,resendAfter:60});
   }
   if(path==='/api/resend'&&method==='POST'){
    await publicAuth();let challenge;try{challenge=unseal(cookies(request.headers.get('cookie')).cc_challenge||'',config.secret,'challenge');}catch{throw invalid();}
    if(challenge.until<clock())throw new HttpError(400,'O prazo terminou. Inicie a solicitação novamente.','CODE_EXPIRED');
    await rate('email-ip',ip,10,3600);await rate('email-cooldown',challenge.email,1,60);await rate('email-day',challenge.email,6,86400);
    await emailRequest(challenge.type==='signup'?'resend':'recover',{email:challenge.email,...(challenge.type==='signup'?{type:'signup'}:{}),...captcha(body)});
    challenge.until=clock()+600000;setCookie('cc_challenge',seal(challenge,config.secret,'challenge'),600);return respond(200,{message:genericEmail,resendAfter:60});
   }
   if(path==='/api/verify'&&method==='POST'){
    await rate('verify-ip',ip,30,900);let challenge;try{challenge=unseal(cookies(request.headers.get('cookie')).cc_challenge||'',config.secret,'challenge');}catch{throw invalid();}
    if(challenge.until<clock()){clear('cc_challenge');throw new HttpError(400,'O código expirou. Solicite outro.','CODE_EXPIRED');}
    await rate('verify-account',challenge.email,8,900);
    if(!/^\d{6,10}$/.test(String(body.code||'')))throw invalid();
    let data;try{data=await provider.auth('verify',{type:challenge.type,email:challenge.email,token:String(body.code)});}catch(err){if(err instanceof ProviderError&&[400,401,403,422].includes(err.status))throw invalid();throw err;}
    clear('cc_challenge');
    if(challenge.type==='recovery'){
     if(!data.access_token||!UUID.test(data.user?.id||''))throw invalid();
     const id=opaque();await provider.rpc('app_recovery',{p_action:'create',p_hash:sha256(id),p_user:data.user.id,p_tokens:seal(tokenData(data),config.secret)},{service:true});setCookie('cc_recovery',id,300);return respond(200,{next:'reset'});
    }
    const user=await createSession(data,challenge.remember,setCookie,challenge.policyAccepted===true);return respond(200,{next:'app',username:user.email.split('@')[0]});
   }
   if(path==='/api/reset-password'&&method==='POST'){
    await rate('reset-ip',ip,10,900);let p;try{p=password(body.password);}catch(err){throw new HttpError(400,err.message);}
    const id=cookies(request.headers.get('cookie')).cc_recovery;
    if(!/^[a-f0-9]{64}$/.test(id||''))throw noSession();
    const recovery=await provider.rpc('app_recovery',{p_action:'consume',p_hash:sha256(id)},{service:true});clear('cc_recovery');
    if(!recovery)throw new HttpError(401,'A autorização expirou ou já foi utilizada. Solicite outro código.','CODE_EXPIRED');
    const tokens=unseal(recovery.tokens,config.secret);
    await provider.rpc('app_session',{p_action:'revoke_user',p_hash:sha256(id),p_user:recovery.userId},{service:true});
    try{await provider.auth('user',{password:p},tokens.access,'PUT');}catch{throw new HttpError(400,'Não foi possível trocar a senha. Solicite um novo código e confira os requisitos.','RESET_FAILED');}
    try{await provider.auth('logout?scope=global',{},tokens.access);}catch{logger({requestId,event:'PROVIDER_LOGOUT_RETRY'});}
    clear('cc_session');return respond(200,{message:'Senha atualizada. Entre novamente com a nova senha.'});
   }
   if(path==='/api/events'&&method==='POST'){
    if(body.consent!==true||!['visit','feature'].includes(body.kind)||!FEATURES.has(body.feature))throw new HttpError(400,'Evento inválido.');
    await rate('events-ip',ip,60,60);
    let visitor=cookies(request.headers.get('cookie')).cc_visitor;if(!/^[a-f0-9]{64}$/.test(visitor||'')){visitor=opaque();setCookie('cc_visitor',visitor,30*86400);}
    try{identity=await authenticate(request);}catch(err){if(!(err instanceof HttpError&&err.status===401))throw err;}
    await event(body.kind,identity?.user.id||null,body.feature,null,hmac(visitor,'analytics'));return respond(200,{ok:true});
   }
   if(path==='/api/client-error'&&method==='POST'){
    if(!['JS_ERROR','UNHANDLED_REJECTION','SAVE_CONNECTION_FAILED'].includes(body.code)||!FEATURES.has(body.feature))throw new HttpError(400,'Evento inválido.');
    await rate('client-errors-ip',ip,10,60);
    try{identity=await authenticate(request);}catch(err){if(!(err instanceof HttpError&&err.status===401))throw err;}
    await event(body.code==='SAVE_CONNECTION_FAILED'?'save_failure':'error',identity?.user.id||null,body.feature,body.code);return respond(200,{ok:true});
   }
   if(path==='/api/analytics-consent'&&method==='POST'){if(body.allowed!==true)clear('cc_visitor');return respond(200,{ok:true});}
   identity=await authenticate(request);const token=identity.tokens.access,user=identity.user;
   if(path==='/api/me'&&method==='GET'){
    const admin=await provider.rpc('app_is_admin',{}, {token});await event('feature',user.id,'account');
    return respond(200,{id:user.id,email:user.email,username:String(user.user_metadata?.display_name||user.email.split('@')[0]).slice(0,60),remember:identity.remember,isAdmin:admin===true,draftKey:hmac(user.id,'drafts')});
   }
   if(path==='/api/logout'&&method==='POST'){
    await provider.rpc('app_session',{p_action:'delete',p_hash:identity.hash},{service:true});clear('cc_session');clear('cc_challenge');clear('cc_recovery');clear('cc_visitor');
    try{await provider.auth('logout?scope=local',{},token);}catch{logger({requestId,event:'PROVIDER_LOGOUT_RETRY'});}return respond(200,{ok:true});
   }
   if(path==='/api/records'||path==='/api/dre'){
    feature=path.endsWith('dre')?'dre':'cash';
    if(await provider.rpc('app_maintenance',{}, {service:true}))throw new HttpError(503,'O serviço está em manutenção. Seus rascunhos serão preservados. Tente mais tarde.','MAINTENANCE');
    if(method==='GET'){
     const rows=await provider.request(feature==='cash'?'/rest/v1/cashbooks?select=revision,records':'/rest/v1/dre_books?select=revision,document',{token});
     if(!Array.isArray(rows)||rows.length>1)throw new HttpError(503,'Não foi possível carregar os dados com segurança.','ISOLATION_CHECK_FAILED');
     await event('feature',user.id,feature);return respond(200,rows[0]||(feature==='cash'?{revision:0,records:[]}:{revision:0,document:{version:1,companies:[],entries:[]}}));
    }
    if(method==='PUT'){
     await rate('save-user',user.id,120,60);let rev,data;
     try{rev=revision(body.revision);data=feature==='cash'?validateRecords(body.records):validateDre(body.document);}catch(err){throw new HttpError(400,err.message,'INVALID_DATA');}
     const result=await provider.rpc(feature==='cash'?'save_cashbook':'save_dre_book',feature==='cash'?{expected_revision:rev,new_records:data}:{expected_revision:rev,new_document:data},{token});
     await event('save_success',user.id,feature);return respond(200,{revision:result});
    }
   }
   if(path==='/api/account/export'&&method==='GET'){
    await rate('export-user',user.id,5,3600);const [cash,dre]=await Promise.all([provider.request('/rest/v1/cashbooks?select=revision,records',{token}),provider.request('/rest/v1/dre_books?select=revision,document',{token})]);
    if(cash.length>1||dre.length>1)throw new HttpError(503,'Não foi possível exportar com segurança.');
    const details=await provider.rpc('app_account_details',{}, {token});
    return respond(200,{format:'caixa-claro-user-export-v1',exportedAt:new Date(clock()).toISOString(),account:{email:user.email,createdAt:user.created_at,emailConfirmedAt:user.email_confirmed_at,...details},cash:cash[0]||{revision:0,records:[]},dre:dre[0]||{revision:0,document:{version:1,companies:[],entries:[]}}});
   }
   if(path==='/api/account/deletion'&&method==='POST'){await rate('delete-request-user',user.id,3,86400);const data=await provider.rpc('app_deletion_request',{}, {token});return respond(200,data);}
   if(path.startsWith('/api/admin/')){
    if(await provider.rpc('app_is_admin',{}, {token})!==true)throw new HttpError(403,'Acesso exclusivo de administradores.','FORBIDDEN');
    await rate('admin-user',user.id,60,60);
    if(path==='/api/admin/metrics'&&method==='GET'){
     const days=Number(url.searchParams.get('days')||30);if(![7,30,90].includes(days))throw new HttpError(400,'Período inválido.');
     const metrics=await provider.rpc('app_admin_metrics',{p_days:days},{token});
     return respond(200,{...metrics,databaseLimitMb:config.databaseLimitMb,hosting:await hosting(),hostingDashboard:config.hostingProvider==='vercel'?'https://vercel.com/dashboard':config.netlifyDashboard,configuration:{publicAuth:config.emailCodesEnabled!==false&&config.publicAuth,googleAuth:config.googleAuth===true,emailCodesEnabled:config.emailCodesEnabled!==false,emailReady:config.emailReady,backupReady:config.backupReady,captchaConfigured:!!config.captchaSiteKey},timeZone:'America/Sao_Paulo',retentionDays:90});
    }
    if(path==='/api/admin/requests'&&method==='GET')return respond(200,await provider.rpc('app_admin_requests',{}, {token}));
    if(path==='/api/admin/deletion'&&method==='POST'){
     if(!UUID.test(body.id||'')||!['retain','delete'].includes(body.action))throw new HttpError(400,'Solicitação inválida.');
     const requests=await provider.rpc('app_admin_requests',{}, {token}),target=requests.find(r=>r.id===body.id);
     if(!target)throw new HttpError(404,'Solicitação não encontrada.');
     if(body.action==='retain'){await provider.rpc('app_resolve_request',{p_id:body.id,p_action:'retain'},{service:true});return respond(200,{ok:true});}
     if(target.userId===user.id)throw new HttpError(400,'A conta administrativa não pode se excluir por este painel.');
     if(body.confirmation!=='EXCLUIR'||body.noLegalRetention!==true)throw new HttpError(400,'Confirme a avaliação de retenção e digite EXCLUIR.');
     if(!target.userId){await provider.rpc('app_resolve_request',{p_id:body.id,p_action:'complete'},{service:true});return respond(200,{ok:true});}
     const claim=await provider.rpc('app_resolve_request',{p_id:body.id,p_action:'claim'},{service:true});
     try{await provider.request('/auth/v1/admin/users/'+claim.userId,{method:'DELETE',service:true});}
     catch(err){await provider.rpc('app_resolve_request',{p_id:body.id,p_action:'retry'},{service:true});throw err;}
     await provider.rpc('app_resolve_request',{p_id:body.id,p_action:'complete'},{service:true});return respond(200,{ok:true});
    }
   }
   throw new HttpError(404,'Não encontrado.');
  }catch(error){
   let e=error;
   if(error instanceof ProviderError){
    if(error.authFailure==='EMAIL_DELIVERY_FAILED')e=new HttpError(503,'Não foi possível enviar o código por e-mail. O responsável precisa conferir o serviço de envio e os registros de autenticação.','EMAIL_DELIVERY_FAILED');
    else if(error.authFailure==='EMAIL_CONFIGURATION')e=new HttpError(503,'O serviço de e-mail ainda não está autorizado a enviar para esse endereço. Contate o responsável.','EMAIL_CONFIGURATION');
    else if(error.authFailure==='AUTH_STORAGE_FAILED')e=new HttpError(503,'Não foi possível criar ou atualizar a conta no serviço de autenticação. Contate o responsável.','AUTH_STORAGE_FAILED');
    else if(error.businessCode==='REVISION_CONFLICT')e=new HttpError(409,'Os dados mudaram em outra janela. Recarregue antes de salvar. Seu rascunho foi preservado.','REVISION_CONFLICT');
    else if(error.businessCode==='INVALID_STATE')e=new HttpError(409,'Esta solicitação já está em processamento. Em caso de interrupção, tente novamente após cinco minutos.','REQUEST_IN_PROGRESS');
    else if(['42P01','PGRST202','PGRST205','42883'].includes(error.code))e=new HttpError(503,'O serviço está temporariamente indisponível. Avise o responsável.','MIGRATION_REQUIRED');
    else if(error.status===429)e=new HttpError(429,'Limite temporário do serviço. Tente novamente mais tarde.','PROVIDER_LIMIT',60);
    else if(error.status===401)e=noSession();
    else e=new HttpError(503,'Não foi possível acessar o serviço agora. Tente novamente.','UPSTREAM_UNAVAILABLE');
   }
   if(!(e instanceof HttpError)){logger({requestId,event:'REQUEST_FAILED'});e=new HttpError(500,'Não foi possível concluir a solicitação.','REQUEST_FAILED');}
   if(e.status===401)clear('cc_session');
   if(e.retryAfter)headers.set('Retry-After',String(e.retryAfter));
   if(identity&&feature&&method==='PUT')await event('save_failure',identity.user.id,feature,e.code);
   else if(e.status>=500)await event('error',identity?.user.id||null,feature,e.code);
   return respond(e.status,{error:e.message,code:e.code,requestId,...(e.retryAfter?{retryAfter:e.retryAfter}:{})});
  }
 };
}
