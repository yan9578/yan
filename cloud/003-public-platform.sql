-- Aplicar depois de schema.sql e 002-dre.sql. Não remove dados financeiros.
begin;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
grant usage on schema private to service_role;

create table if not exists private.app_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted_at timestamptz not null default now()
);
create table if not exists private.app_sessions (
 id_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 tokens text not null, version integer not null default 0,
 expires_at timestamptz not null, remember boolean not null default false,
 created_at timestamptz not null default now(), last_seen_at timestamptz not null default now()
);
create index if not exists app_sessions_user_idx on private.app_sessions(user_id);
create table if not exists private.app_recoveries (
 id_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 tokens text not null, expires_at timestamptz not null, consumed_at timestamptz
);
create table if not exists private.app_policy_acceptances (
 user_id uuid not null references auth.users(id) on delete cascade,
 policy_version text not null, acknowledged_at timestamptz not null default now(),
 primary key(user_id,policy_version)
);
create table if not exists private.app_backup_runs (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default now(),
 status text not null check(status in ('archive_created','external_uploaded','failed','restore_verified')),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$')
);
create table if not exists private.app_limits (
 bucket text not null, key_hash text not null, hits integer not null,
 resets_at timestamptz not null, primary key(bucket,key_hash)
);
create table if not exists private.app_events (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default now(),
 kind text not null check(kind in ('visit','feature','login','save_success','save_failure','error')),
 user_id uuid references auth.users(id) on delete set null,
 visitor_hash text, feature text check(feature in ('cash','dre','account','admin')),
 code text check(code is null or code ~ '^[A-Z0-9_]{1,40}$')
);
create index if not exists app_events_date_idx on private.app_events(occurred_at);
create table if not exists private.app_activity (
 user_id uuid not null references auth.users(id) on delete cascade,
 day date not null, primary key(user_id,day)
);
create table if not exists private.app_registrations (
 day date primary key, total integer not null default 0
);
create table if not exists private.account_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references auth.users(id) on delete set null,
 requested_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','retained','processing','completed')),
 resolved_at timestamptz, processing_at timestamptz
);
alter table private.account_requests add column if not exists processing_at timestamptz;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all sequences in schema private from public,anon,authenticated;
grant all on all tables in schema private to service_role;
grant all on all sequences in schema private to service_role;

create or replace function private.count_registration()
returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 insert into private.app_registrations(day,total)
 values((new.created_at at time zone 'America/Sao_Paulo')::date,1)
 on conflict(day) do update set total=private.app_registrations.total+1;
 return new;
end $$;
revoke all on function private.count_registration() from public,anon,authenticated;
insert into private.app_registrations(day,total)
 select (created_at at time zone 'America/Sao_Paulo')::date,count(*)::integer from auth.users group by 1
 on conflict(day) do nothing;
drop trigger if exists app_count_registration on auth.users;
create trigger app_count_registration after insert on auth.users
 for each row execute function private.count_registration();

create or replace function public.app_limit(p_bucket text,p_key_hash text,p_max integer,p_seconds integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare h integer; deadline timestamptz;
begin
 if p_max<1 or p_max>10000 or p_seconds<1 or p_seconds>86400
 or p_key_hash !~ '^[a-f0-9]{64}$' or length(p_bucket)>60 then raise exception 'INVALID_LIMIT'; end if;
 insert into private.app_limits(bucket,key_hash,hits,resets_at) values(p_bucket,p_key_hash,1,now()+make_interval(secs=>p_seconds))
 on conflict(bucket,key_hash) do update set
 hits=case when app_limits.resets_at>now() then app_limits.hits+1 else 1 end,
 resets_at=case when app_limits.resets_at>now() then app_limits.resets_at else excluded.resets_at end
 returning hits,resets_at into h,deadline;
 return jsonb_build_object('allowed',h<=p_max,'retryAfter',greatest(1,ceil(extract(epoch from deadline-now()))::integer));
end $$;

create or replace function public.app_session(p_action text,p_hash text,p_user uuid default null,p_tokens text default null,p_remember boolean default false,p_expires timestamptz default null,p_version integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare s private.app_sessions%rowtype;
begin
 if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_SESSION'; end if;
 if p_action='create' then
  if p_user is null or p_tokens is null or p_expires is null or p_expires>now()+interval '31 days' then raise exception 'INVALID_SESSION'; end if;
  insert into private.app_sessions(id_hash,user_id,tokens,remember,expires_at) values(p_hash,p_user,p_tokens,p_remember,p_expires);
  return '{"ok":true}'::jsonb;
 elsif p_action='get' then
  select * into s from private.app_sessions where id_hash=p_hash and expires_at>now();
  if not found then return null; end if;
  return jsonb_build_object('userId',s.user_id,'tokens',s.tokens,'version',s.version,'remember',s.remember,'expiresAt',s.expires_at);
 elsif p_action='rotate' then
  update private.app_sessions set tokens=p_tokens,version=version+1,last_seen_at=now()
   where id_hash=p_hash and expires_at>now() and version=p_version;
  return jsonb_build_object('ok',found);
 elsif p_action='delete' then
  delete from private.app_sessions where id_hash=p_hash;return '{"ok":true}'::jsonb;
 elsif p_action='revoke_user' and p_user is not null then
  delete from private.app_sessions where user_id=p_user;return '{"ok":true}'::jsonb;
 end if;
 raise exception 'INVALID_ACTION';
end $$;

create or replace function public.app_recovery(p_action text,p_hash text,p_user uuid default null,p_tokens text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.app_recoveries%rowtype;
begin
 if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_RECOVERY'; end if;
 if p_action='create' then
  insert into private.app_recoveries(id_hash,user_id,tokens,expires_at) values(p_hash,p_user,p_tokens,now()+interval '5 minutes');
  return '{"ok":true}'::jsonb;
 elsif p_action='consume' then
  update private.app_recoveries set consumed_at=now()
   where id_hash=p_hash and expires_at>now() and consumed_at is null returning * into r;
  if not found then return null; end if;
  return jsonb_build_object('userId',r.user_id,'tokens',r.tokens);
 end if;
 raise exception 'INVALID_ACTION';
end $$;

create or replace function public.app_event(p_kind text,p_user uuid default null,p_visitor text default null,p_feature text default null,p_code text default null)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if p_visitor is not null and p_visitor !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_VISITOR'; end if;
 insert into private.app_events(kind,user_id,visitor_hash,feature,code) values(p_kind,p_user,p_visitor,p_feature,p_code);
 if p_user is not null then
  insert into private.app_activity(user_id,day) values(p_user,(now() at time zone 'America/Sao_Paulo')::date) on conflict do nothing;
 end if;
end $$;

create or replace function public.app_is_admin()
returns boolean language sql stable security definer set search_path=pg_catalog,private as $$
 select auth.uid() is not null and exists(select 1 from private.app_admins where user_id=auth.uid());
$$;

create or replace function public.app_admin_metrics(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare first_day date; today date; result jsonb;
begin
 if not public.app_is_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_days not in (7,30,90) then raise exception 'INVALID_PERIOD'; end if;
 today:=(now() at time zone 'America/Sao_Paulo')::date;first_day:=today-(p_days-1);
 select jsonb_build_object(
  'totalUsers',(select count(*) from auth.users),
  'confirmedUsers',(select count(*) from auth.users where email_confirmed_at is not null),
  'newToday',(select coalesce(sum(total),0) from private.app_registrations where day=today),
  'new7Days',(select coalesce(sum(total),0) from private.app_registrations where day>=today-6),
  'new30Days',(select coalesce(sum(total),0) from private.app_registrations where day>=today-29),
  'dailyActive',(select count(*) from private.app_activity where day=today),
  'monthlyActive',(select count(distinct user_id) from private.app_activity where day>=today-29),
  'returningUsers',(select count(*) from (select user_id from private.app_activity where day>=first_day group by user_id having count(*)>1) a),
  'visits',(select count(*) from private.app_events where kind='visit' and (occurred_at at time zone 'America/Sao_Paulo')::date>=first_day),
  'uniqueVisitors',(select count(distinct visitor_hash) from private.app_events where kind='visit' and (occurred_at at time zone 'America/Sao_Paulo')::date>=first_day),
  'errors',(select count(*) from private.app_events where kind='error' and (occurred_at at time zone 'America/Sao_Paulo')::date>=first_day),
  'saveFailures',(select count(*) from private.app_events where kind='save_failure' and (occurred_at at time zone 'America/Sao_Paulo')::date>=first_day),
  'pendingDeletion',(select count(*) from private.account_requests where status in ('pending','retained','processing')),
  'lastExternalBackup',(select max(occurred_at) from private.app_backup_runs where status='external_uploaded'),
  'lastVerifiedRestore',(select max(occurred_at) from private.app_backup_runs where status='restore_verified'),
  'recentBackupFailures',(select count(*) from private.app_backup_runs where status='failed' and occurred_at>now()-interval '7 days'),
  'databaseBytes',pg_database_size(current_database()),
  'financialBytes',pg_total_relation_size('public.cashbooks')+pg_total_relation_size('public.dre_books'),
  'features',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select feature,count(*) as visits from private.app_events where kind='feature' and (occurred_at at time zone 'America/Sao_Paulo')::date>=first_day group by feature order by count(*) desc) x),
  'daily',(select jsonb_agg(x order by x.day) from (
   select d::date as day,
    (select coalesce(sum(total),0) from private.app_registrations where day=d::date) as registrations,
    (select count(*) from private.app_activity where day=d::date) as active,
    (select count(*) from private.app_events where kind='visit' and (occurred_at at time zone 'America/Sao_Paulo')::date=d::date) as visits,
    (select count(*) from private.app_events where kind in ('error','save_failure') and (occurred_at at time zone 'America/Sao_Paulo')::date=d::date) as errors
   from generate_series(first_day::timestamp,today::timestamp,interval '1 day') d
  ) x)
 ) into result;
 return result;
end $$;

create or replace function public.app_deletion_request()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.account_requests%rowtype;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 insert into private.account_requests(user_id) values(auth.uid()) on conflict(user_id) do nothing;
 select * into r from private.account_requests where user_id=auth.uid();
 return jsonb_build_object('id',r.id,'status',r.status,'requestedAt',r.requested_at);
end $$;

create or replace function public.app_admin_requests()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if not public.app_is_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(x order by x."requestedAt"),'[]'::jsonb) from (
  select r.id,r.user_id as "userId",u.email,r.requested_at as "requestedAt",r.status
  from private.account_requests r left join auth.users u on u.id=r.user_id
  where r.status<>'completed'
 ) x);
end $$;

-- Função usada somente pelo servidor após verificar o administrador.
create or replace function public.app_resolve_request(p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare r private.account_requests%rowtype;
begin
 select * into r from private.account_requests where id=p_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_action='retain' then update private.account_requests set status='retained',processing_at=null where id=p_id;
 elsif p_action='claim' then
  if r.status not in ('pending','retained') and not(r.status='processing' and (r.processing_at is null or r.processing_at<now()-interval '5 minutes')) then raise exception 'INVALID_STATE'; end if;
  update private.account_requests set status='processing',processing_at=now() where id=p_id;
 elsif p_action='complete' and r.user_id is null then
  update private.account_requests set status='completed',resolved_at=now() where id=p_id;
 elsif p_action='retry' and r.user_id is not null then
  update private.account_requests set status='pending',processing_at=null where id=p_id;
 else raise exception 'INVALID_ACTION'; end if;
 return jsonb_build_object('userId',r.user_id,'id',r.id);
end $$;

create or replace function public.app_cleanup()
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 delete from private.app_sessions where expires_at<now();
 delete from private.app_recoveries where expires_at<now();
 delete from private.app_limits where resets_at<now()-interval '1 day';
 delete from private.app_events where occurred_at<now()-interval '90 days';
 delete from private.app_backup_runs where occurred_at<now()-interval '90 days';
 delete from private.app_activity where day<(now() at time zone 'America/Sao_Paulo')::date-90;
end $$;

create or replace function public.app_policy_ack(p_user uuid,p_version text)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if p_version<>'2026-11-06' then raise exception 'INVALID_VERSION'; end if;
 insert into private.app_policy_acceptances(user_id,policy_version) values(p_user,p_version) on conflict do nothing;
end $$;
create or replace function public.app_account_details()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 return jsonb_build_object(
  'policyAcknowledgements',(select coalesce(jsonb_agg(jsonb_build_object('version',policy_version,'at',acknowledged_at)),'[]'::jsonb) from private.app_policy_acceptances where user_id=auth.uid()),
  'deletionRequest',(select jsonb_build_object('requestedAt',requested_at,'status',status) from private.account_requests where user_id=auth.uid())
 );
end $$;
revoke all on function public.app_policy_ack(uuid,text) from public,anon,authenticated;
grant execute on function public.app_policy_ack(uuid,text) to service_role;
revoke all on function public.app_account_details() from public,anon;
grant execute on function public.app_account_details() to authenticated;

-- Funções de infraestrutura: apenas o servidor, nunca o navegador.
revoke all on function public.app_limit(text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.app_session(text,text,uuid,text,boolean,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.app_recovery(text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.app_event(text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.app_resolve_request(uuid,text) from public,anon,authenticated;
revoke all on function public.app_cleanup() from public,anon,authenticated;
grant execute on function public.app_limit(text,text,integer,integer),public.app_session(text,text,uuid,text,boolean,timestamptz,integer),public.app_recovery(text,text,uuid,text),public.app_event(text,uuid,text,text,text),public.app_resolve_request(uuid,text),public.app_cleanup() to service_role;
revoke all on function public.app_is_admin(),public.app_admin_metrics(integer),public.app_deletion_request(),public.app_admin_requests() from public,anon,authenticated;
grant execute on function public.app_is_admin(),public.app_admin_metrics(integer),public.app_deletion_request(),public.app_admin_requests() to authenticated;

-- Fronteira adicional: mantém o isolamento mesmo se houver outra política permissiva.
drop policy if exists account_boundary on public.cashbooks;
create policy account_boundary on public.cashbooks as restrictive for all to authenticated
 using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists account_boundary on public.dre_books;
create policy account_boundary on public.dre_books as restrictive for all to authenticated
 using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
revoke all on public.cashbooks,public.dre_books from public,anon;
commit;
