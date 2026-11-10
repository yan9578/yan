import {randomUUID,createHash} from 'node:crypto';
import {ProviderError} from '../server/supabase.js';

// Simula exclusivamente o contrato OAuth do provedor. SQL/RLS continuam reais.
export function installGoogleProvider(provider){
 const codes=new Map(),auth=provider.auth.bind(provider),publicUser=provider.publicUser.bind(provider);
 provider.googleEnabled=true;
 provider.publicUser=user=>({...publicUser(user),identities:user.identities||[]});
 provider.issueGoogleCode=async(email,challenge,{verified=true,providerName='google'}={})=>{
  let user=provider.users.get(email);
  if(!user)user=await provider.addUser(email,'not-a-user-password-'+randomUUID(),undefined,true);
  user.email_confirmed_at=new Date().toISOString();
  await provider.db.db.query('update auth.users set email_confirmed_at=$1 where id=$2',[user.email_confirmed_at,user.id]);
  user.identities=[{provider:providerName,user_id:user.id,identity_data:{sub:randomUUID(),email:user.email,email_verified:verified}}];
  const code=randomUUID();codes.set(code,{user,challenge});return code;
 };
 provider.auth=async(path,body,...args)=>{
  if(path==='settings')return {...await auth(path,body,...args),external:{google:provider.googleEnabled}};
  if(path==='token?grant_type=pkce'){
   provider.calls.push({type:'auth',path,body});const row=codes.get(body.auth_code);
   if(!row||createHash('sha256').update(body.code_verifier||'').digest('base64url')!==row.challenge)throw new ProviderError(400,'bad_code_verifier');
   codes.delete(body.auth_code);return provider.issue(row.user);
  }
  return auth(path,body,...args);
 };
 return provider;
}
