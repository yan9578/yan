begin;
create table if not exists private.app_settings (name text primary key,value jsonb not null);
revoke all on private.app_settings from public,anon,authenticated;
grant all on private.app_settings to service_role;

create or replace function public.app_writes_open()
returns boolean language sql stable security definer set search_path=pg_catalog,private as $$
 select not coalesce((select value='true'::jsonb from private.app_settings where name='maintenance'),false);
$$;
revoke all on function public.app_writes_open() from public,anon;
grant execute on function public.app_writes_open() to authenticated;
create or replace function public.app_maintenance(p_enabled boolean default null)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 if p_enabled is not null then insert into private.app_settings values('maintenance',to_jsonb(p_enabled)) on conflict(name) do update set value=excluded.value; end if;
 return coalesce((select value='true'::jsonb from private.app_settings where name='maintenance'),false);
end $$;
revoke all on function public.app_maintenance(boolean) from public,anon,authenticated;
grant execute on function public.app_maintenance(boolean) to service_role;

create or replace function public.app_valid_cashbook(rows jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare r jsonb; ids text[]:='{}'; d text; a numeric;
begin
 if rows is null or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows)>5000 or octet_length(rows::text)>2000000 then return false; end if;
 for r in select * from jsonb_array_elements(rows) loop
  if jsonb_typeof(r)<>'object' or not(r ?& array['id','amount','type','method','description','category','date']) then return false; end if;
  if jsonb_typeof(r->'id')<>'string' or r->>'id'!~'^[A-Za-z0-9-]{1,80}$' or r->>'id'=any(ids) then return false; end if;
  ids:=array_append(ids,r->>'id');
  if jsonb_typeof(r->'amount')<>'number' then return false; end if;
  a:=(r->>'amount')::numeric;if a<1 or a>1000000000000 or trunc(a)<>a then return false; end if;
  if jsonb_typeof(r->'type')<>'string' or jsonb_typeof(r->'method')<>'string' or r->>'type' not in ('income','expense') or r->>'method' not in ('Pix','Dinheiro','Débito','Crédito') then return false; end if;
  if jsonb_typeof(r->'description')<>'string' or length(trim(r->>'description'))=0 or length(r->>'description')>120 or jsonb_typeof(r->'category')<>'string' or length(r->>'category')>60 then return false; end if;
  if jsonb_typeof(r->'date')<>'string' then return false; end if;
  d:=r->>'date';if d!~'^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' or to_char(d::date,'YYYY-MM-DD')<>d then return false; end if;
  if coalesce(r->>'saleDate','')<>'' then
   d:=r->>'saleDate';if d!~'^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' or to_char(d::date,'YYYY-MM-DD')<>d or d>r->>'date' then return false; end if;
  end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create or replace function public.app_valid_dre(doc jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare c jsonb; e jsonb; company_ids text[]:='{}'; ids text[]:='{}'; d text; a numeric; total numeric:=0;
begin
 if doc is null or jsonb_typeof(doc)<>'object' or not(doc ?& array['version','companies','entries']) or doc->'version'<>'1'::jsonb
 or jsonb_typeof(doc->'companies')<>'array' or jsonb_typeof(doc->'entries')<>'array'
 or jsonb_array_length(doc->'companies')>1000 or jsonb_array_length(doc->'entries')>50000 or octet_length(doc::text)>2000000 then return false; end if;
 for c in select * from jsonb_array_elements(doc->'companies') loop
  if not(c ?& array['id','name','sector']) or jsonb_typeof(c->'id')<>'string' or length(c->>'id') not between 1 and 100 or c->>'id'=any(company_ids)
  or jsonb_typeof(c->'name')<>'string' or length(trim(c->>'name'))=0 or length(c->>'name')>80 or jsonb_typeof(c->'sector')<>'string' or length(c->>'sector')>80 then return false; end if;
  company_ids:=array_append(company_ids,c->>'id');
 end loop;
 for e in select * from jsonb_array_elements(doc->'entries') loop
  if not(e ?& array['id','company','category','date','description','amount']) or jsonb_typeof(e->'id')<>'string' or length(e->>'id') not between 1 and 100 or e->>'id'=any(ids)
  or jsonb_typeof(e->'company')<>'string' or jsonb_typeof(e->'category')<>'string' or not(e->>'company'=any(company_ids)) or e->>'category' not in ('sales','services','deductions','cost','personnel','admin','commercial','structure','otherExpense','depreciation','otherIncome','financialIncome','financialExpense','taxes','capital','loan','principal','assets','inventory','distribution') then return false; end if;
  ids:=array_append(ids,e->>'id');
  if jsonb_typeof(e->'description')<>'string' or length(trim(e->>'description'))=0 or length(e->>'description')>180 or jsonb_typeof(e->'amount')<>'number' then return false; end if;
  if jsonb_typeof(e->'date')<>'string' then return false; end if;
  d:=e->>'date';if d!~'^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$' or to_char(d::date,'YYYY-MM-DD')<>d then return false; end if;
  a:=(e->>'amount')::numeric;if a<1 or a>1000000000000 or trunc(a)<>a then return false; end if;
  total:=total+a;if total>2251799813685247 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.app_valid_cashbook(jsonb),public.app_valid_dre(jsonb) from public,anon;
grant execute on function public.app_valid_cashbook(jsonb),public.app_valid_dre(jsonb) to authenticated,service_role;
-- NOT VALID preserva registros antigos; todas as novas gravações já são verificadas.
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.cashbooks'::regclass and conname='valid_cashbook_records') then
  alter table public.cashbooks add constraint valid_cashbook_records check(public.app_valid_cashbook(records)) not valid;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.dre_books'::regclass and conname='valid_dre_document') then
  alter table public.dre_books add constraint valid_dre_document check(public.app_valid_dre(document)) not valid;
 end if;
end $$;

drop policy if exists account_boundary on public.cashbooks;
create policy account_boundary on public.cashbooks as restrictive for all to authenticated
 using((select auth.uid())=user_id and public.app_writes_open()) with check((select auth.uid())=user_id and public.app_writes_open());
drop policy if exists account_boundary on public.dre_books;
create policy account_boundary on public.dre_books as restrictive for all to authenticated
 using((select auth.uid())=user_id and public.app_writes_open()) with check((select auth.uid())=user_id and public.app_writes_open());
grant select,insert,update on public.cashbooks,public.dre_books to service_role;

create or replace function public.app_restore_financial(p_table text,p_user uuid,p_revision bigint,p_data jsonb,p_overwrite boolean default false)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare existing jsonb; current_revision bigint;
begin
 if not coalesce((select value='true'::jsonb from private.app_settings where name='maintenance'),false) then raise exception 'MAINTENANCE_REQUIRED'; end if;
 if p_revision is null or p_revision<0 then raise exception 'INVALID_DATA'; end if;
 if p_table='cashbooks' then
  if not public.app_valid_cashbook(p_data) then raise exception 'INVALID_DATA'; end if;
  select records,revision into existing,current_revision from public.cashbooks where user_id=p_user for update;
  if found then
   if existing=p_data then return; end if;
   if not p_overwrite then raise exception 'OVERWRITE_REQUIRES_CONFIRMATION'; end if;
   update public.cashbooks set records=p_data,revision=greatest(current_revision,p_revision)+1 where user_id=p_user;
  else insert into public.cashbooks(user_id,revision,records) values(p_user,p_revision+1,p_data); end if;
 elsif p_table='dre_books' then
  if not public.app_valid_dre(p_data) then raise exception 'INVALID_DATA'; end if;
  select document,revision into existing,current_revision from public.dre_books where user_id=p_user for update;
  if found then
   if existing=p_data then return; end if;
   if not p_overwrite then raise exception 'OVERWRITE_REQUIRES_CONFIRMATION'; end if;
   update public.dre_books set document=p_data,revision=greatest(current_revision,p_revision)+1 where user_id=p_user;
  else insert into public.dre_books(user_id,revision,document) values(p_user,p_revision+1,p_data); end if;
 else raise exception 'INVALID_TABLE'; end if;
end $$;
revoke all on function public.app_restore_financial(text,uuid,bigint,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.app_restore_financial(text,uuid,bigint,jsonb,boolean) to service_role;
create or replace function public.app_backup_mark(p_status text,p_sha text default null)
returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 insert into private.app_backup_runs(status,sha256) values(p_status,p_sha);
end $$;
create or replace function public.app_backup_health()
returns jsonb language sql stable security definer set search_path=pg_catalog,private as $$
 select jsonb_build_object('lastExternalAt',max(occurred_at) filter(where status='external_uploaded'),'lastRestoreAt',max(occurred_at) filter(where status='restore_verified')) from private.app_backup_runs;
$$;
revoke all on function public.app_backup_mark(text,text),public.app_backup_health() from public,anon,authenticated;
grant execute on function public.app_backup_mark(text,text),public.app_backup_health() to service_role;
commit;

