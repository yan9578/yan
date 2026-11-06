import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
import {ProviderError} from '../server/supabase.js';
export const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
export async function platformDatabase(){
 const db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text unique,created_at timestamptz not null default now(),email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
 for(const name of ['schema.sql','002-dre.sql','003-public-platform.sql','005-data-validation-backups.sql'])await db.exec(await readFile(new URL('../cloud/'+name,import.meta.url),'utf8'));
 let queue=Promise.resolve();
 async function as(role,id,fn){
  const task=queue.then(async()=>{await db.exec('BEGIN');try{await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);await db.exec('SET LOCAL ROLE '+role);const result=await fn(db);await db.exec('COMMIT');return result;}catch(e){await db.exec('ROLLBACK');throw e;}});
  queue=task.catch(()=>{});return task;
 }
 async function rpc(name,body={},role='service_role',id=null){
  if(!/^[a-z_]+$/.test(name))throw Error('Invalid procedure');
  const keys=Object.keys(body);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw Error('Invalid parameter');
  const query=`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`;
  try{return await as(role,id,async client=>(await client.query(query,Object.values(body))).rows[0].result);}catch(e){throw new ProviderError(e.code==='42501'?403:400,e.code,e.message);}
 }
 return {db,as,rpc,close:async()=>{await queue;await db.close();}};
}
