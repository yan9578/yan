import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {platformDatabase,A,B} from '../test-support/platform-db.js';

test('PostgreSQL: permissões, RLS, limites atômicos, admin e validação no banco',async()=>{
 const pg=await platformDatabase();try{
  await pg.db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())',[A,'a@example.invalid',B,'b@example.invalid']);
  // Migrações repetíveis não duplicam contadores nem removem dados.
  for(const name of ['003-public-platform.sql','005-data-validation-backups.sql'])await pg.db.exec(await readFile(new URL('../cloud/'+name,import.meta.url),'utf8'));
  assert.equal((await pg.db.query('select sum(total) as n from private.app_registrations')).rows[0].n,2);
  const row={id:'sale',type:'income',method:'Pix',amount:10000,description:'Privado A',category:'Vendas',date:'2026-11-01',saleDate:''};
  await pg.rpc('save_cashbook',{expected_revision:0,new_records:[row]},'authenticated',A);
  assert.equal((await pg.as('authenticated',B,d=>d.query('select * from cashbooks'))).rows.length,0);
  const result=await pg.as('authenticated',B,d=>d.query('update cashbooks set records=$1 where user_id=$2 returning user_id',[[],A]));assert.equal(result.rows.length,0);
  for(const role of ['anon','authenticated']){await assert.rejects(pg.as(role,A,d=>d.query('select * from private.app_sessions')));await assert.rejects(pg.rpc('app_limit',{p_bucket:'test',p_key_hash:'a'.repeat(64),p_max:2,p_seconds:60},role,A));}
  assert.equal(await pg.rpc('app_is_admin',{},'authenticated',B),false);
  await assert.rejects(pg.rpc('app_admin_metrics',{p_days:7},'authenticated',B));
  await pg.db.query('insert into private.app_admins values($1,now())',[A]);
  await pg.rpc('app_event',{p_kind:'visit',p_user:A,p_visitor:'b'.repeat(64),p_feature:'cash'});
  await pg.rpc('app_event',{p_kind:'save_failure',p_user:B,p_feature:'dre',p_code:'TEST_ERROR'});
  await pg.db.query('insert into private.app_activity(user_id,day) values($1,(now() at time zone \'America/Sao_Paulo\')::date-1)',[A]);
  const metrics=await pg.rpc('app_admin_metrics',{p_days:7},'authenticated',A);assert.equal(metrics.totalUsers,2);assert.equal(metrics.confirmedUsers,2);assert.equal(metrics.newToday,2);assert.equal(metrics.dailyActive,2);assert.equal(metrics.monthlyActive,2);assert.equal(metrics.returningUsers,1);assert.equal(metrics.visits,1);assert.equal(metrics.uniqueVisitors,1);assert.equal(metrics.saveFailures,1);assert.equal(metrics.daily.length,7);assert.ok(metrics.databaseBytes>0);
  // Uma função interrompida não deixa a solicitação de exclusão presa para sempre.
  const deletion=await pg.rpc('app_deletion_request',{},'authenticated',B);await pg.rpc('app_resolve_request',{p_id:deletion.id,p_action:'claim'});await assert.rejects(pg.rpc('app_resolve_request',{p_id:deletion.id,p_action:'claim'}));await pg.db.query('update private.account_requests set processing_at=now()-interval \'6 minutes\' where id=$1',[deletion.id]);assert.equal((await pg.rpc('app_resolve_request',{p_id:deletion.id,p_action:'claim'})).userId,B);await pg.rpc('app_resolve_request',{p_id:deletion.id,p_action:'retry'});
  const key='c'.repeat(64);const limits=await Promise.all(Array.from({length:5},()=>pg.rpc('app_limit',{p_bucket:'test',p_key_hash:key,p_max:3,p_seconds:60})));assert.equal(limits.filter(x=>x.allowed).length,3);
  for(const invalid of [{...row,amount:-1},{...row,amount:1.5},{...row,type:null},{...row,date:null},{...row,date:'2026-02-30'}])await assert.rejects(pg.rpc('save_cashbook',{expected_revision:1,new_records:[invalid]},'authenticated',A));
  assert.equal((await pg.as('authenticated',A,d=>d.query('select records from cashbooks'))).rows[0].records[0].amount,10000);
  await pg.rpc('app_maintenance',{p_enabled:true});assert.equal((await pg.as('authenticated',A,d=>d.query('select * from cashbooks'))).rows.length,0);await assert.rejects(pg.rpc('save_cashbook',{expected_revision:1,new_records:[]},'authenticated',A));await pg.rpc('app_maintenance',{p_enabled:false});
 }finally{await pg.close();}
});
