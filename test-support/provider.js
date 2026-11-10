import {randomUUID,scryptSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {ProviderError} from '../server/supabase.js';
import {A,B} from './platform-db.js';
export class TestProvider{
 constructor(database,{now=()=>Date.now()}={}){this.db=database;this.now=now;this.users=new Map();this.access=new Map();this.refresh=new Map();this.codes=new Map();this.calls=[];this.deliveries=[];this.autocofirm=false;this.fail=null;}
 async addUser(email,password,id=randomUUID(),confirmed=true){const salt=randomBytes(16).toString('hex'),user={id,email,created_at:new Date(this.now()).toISOString(),email_confirmed_at:confirmed?new Date(this.now()).toISOString():null,salt,password:scryptSync(password,salt,64)};this.users.set(email,user);await this.db.db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,email,user.email_confirmed_at]);return user;}
 publicUser(user){return {id:user.id,email:user.email,created_at:user.created_at,email_confirmed_at:user.email_confirmed_at};}
 issue(user){const access=randomUUID(),refresh=randomUUID();this.access.set(access,user);this.refresh.set(refresh,user);return {access_token:access,refresh_token:refresh,expires_in:3600,user:this.publicUser(user)};}
 setCode(email,type){const code=String(Math.floor(100000+Math.random()*900000));this.codes.set(email+':'+type,{code,expires:this.now()+600000});this.deliveries.push({email,type,code});}
 async auth(path,body,token,method='POST'){
  this.calls.push({type:'auth',path,body,token});if(this.fail?.(path,method))throw new ProviderError(503,'UPSTREAM_UNAVAILABLE');
  if(path==='settings')return {mailer_autoconfirm:this.autocofirm,disable_signup:false};
  if(path==='signup'){let user=this.users.get(body.email);if(!user)user=await this.addUser(body.email,body.password,undefined,false);this.setCode(body.email,'signup');return {user:this.publicUser(user)};}
  if(path==='recover'||path==='resend'){if(this.users.has(body.email))this.setCode(body.email,path==='resend'?'signup':'recovery');return {};}
  if(path==='verify'){const record=this.codes.get(body.email+':'+body.type);if(!record||record.expires<this.now()||record.code!==body.token)throw new ProviderError(403,'otp_expired');this.codes.delete(body.email+':'+body.type);const user=this.users.get(body.email);if(!user)throw new ProviderError(403,'otp_expired');if(body.type==='signup'){user.email_confirmed_at=new Date(this.now()).toISOString();await this.db.db.query('update auth.users set email_confirmed_at=$1 where id=$2',[user.email_confirmed_at,user.id]);}return this.issue(user);}
  if(path.startsWith('token?grant_type=password')){const user=this.users.get(body.email);if(!user||!timingSafeEqual(scryptSync(body.password,user.salt,64),user.password))throw new ProviderError(400,'invalid_credentials');if(!user.email_confirmed_at)throw new ProviderError(400,'email_not_confirmed');return this.issue(user);}
  if(path.startsWith('token?grant_type=refresh_token')){const user=this.refresh.get(body.refresh_token);if(!user)throw new ProviderError(400,'refresh_token_not_found');this.refresh.delete(body.refresh_token);return this.issue(user);}
  const user=this.access.get(token);if(!user)throw new ProviderError(401,'bad_jwt');
  if(path==='user'&&method==='GET')return this.publicUser(user);
  if(path==='user'&&method==='PUT'){user.password=scryptSync(body.password,user.salt,64);return this.publicUser(user);}
  if(path.startsWith('logout')){if(path.includes('global'))for(const [key,u]of this.refresh)if(u.id===user.id)this.refresh.delete(key);return {};}
  throw Error('Unexpected auth path '+path);
 }
 async rpc(name,body={},options={}){this.calls.push({type:'rpc',name,body,options});if(this.fail?.(name,'RPC'))throw new ProviderError(503,'UPSTREAM_UNAVAILABLE');const user=this.access.get(options.token);return this.db.rpc(name,body,options.service?'service_role':'authenticated',user?.id||null);}
 async request(path,options={}){
  this.calls.push({type:'request',path,options});if(this.fail?.(path,options.method||'GET'))throw new ProviderError(503,'UPSTREAM_UNAVAILABLE');
  if(path.startsWith('/auth/v1/admin/users/')&&options.method==='DELETE'&&options.service){const id=path.split('/').at(-1);await this.db.db.query('delete from auth.users where id=$1',[id]);for(const [e,u]of this.users)if(u.id===id)this.users.delete(e);return {};}
  const user=this.access.get(options.token);if(!options.service&&!user)throw new ProviderError(401,'bad_jwt');const url=new URL(path,'https://test.supabase.co');const table=url.pathname.split('/').at(-1);if(!['cashbooks','dre_books'].includes(table))throw Error('Unexpected table');
  const field=table==='cashbooks'?'records':'document';let query=`select user_id,revision,${field} from public.${table}`,params=[];const after=url.searchParams.get('user_id');if(after?.startsWith('gt.')){query+=' where user_id>$1';params.push(after.slice(3));}query+=' order by user_id';const limit=url.searchParams.get('limit');if(limit){query+=' limit '+Number(limit);}
  const result=await this.db.as(options.service?'service_role':'authenticated',user?.id||null,async client=>client.query(query,params));return result.rows.map(r=>options.service?r:{revision:r.revision,[field]:r[field]});
 }
}
export function testConfig(extra={}){return {googleAuth:false,emailCodesEnabled:true,production:false,origin:'http://127.0.0.1:3000',url:'https://test.supabase.co',key:'sb_publishable_test',serviceKey:'sb_secret_test',secret:'test-only-session-secret-with-adequate-length',publicAuth:true,emailReady:true,backupReady:true,captchaSiteKey:'',privacyController:'Teste',privacyContact:'privacy@example.invalid',aliases:{yan:'a@example.invalid',yan1:'b@example.invalid'},...extra};}
export async function seedProvider(db){const p=new TestProvider(db);const password='Test-only-password-2026';await p.addUser('a@example.invalid',password,A);await p.addUser('b@example.invalid',password,B);await db.db.query('insert into private.app_admins(user_id) values($1)',[A]);await db.rpc('app_backup_mark',{p_status:'external_uploaded',p_sha:'a'.repeat(64)});return {provider:p,password};}
