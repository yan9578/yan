begin;

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
  or jsonb_typeof(e->'company')<>'string' or jsonb_typeof(e->'category')<>'string' or not(e->>'company'=any(company_ids)) or e->>'category' not in ('sales','services','deductions','cost','serviceCost','personnel','admin','commercial','structure','otherExpense','depreciation','otherIncome','financialIncome','financialExpense','taxes','capital','loan','principal','assets','inventory','distribution') then return false; end if;
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

create or replace function private.check_integrated_inventory()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare
 inventory jsonb := new.document->'operationBook'->'inventory';
begin
 if inventory is null then return new; end if;
 if jsonb_typeof(inventory) is distinct from 'object'
  or jsonb_typeof(inventory->'closings') is distinct from 'array'
  or jsonb_typeof(inventory->'adjustments') is distinct from 'array'
  or jsonb_typeof(inventory->'reviews') is distinct from 'array' then
  raise exception 'INVALID_DATA';
 end if;
 if exists (
  select 1 from jsonb_array_elements((inventory->'closings')||(inventory->'adjustments')||(inventory->'reviews')) as item
  where not exists(select 1 from jsonb_array_elements(new.document->'companies') as company where company->>'id'=item->>'company')
 ) then raise exception 'INVALID_STATE'; end if;
 return new;
end $$;
revoke all on function private.check_integrated_inventory() from public,anon,authenticated;
create or replace trigger validate_integrated_inventory before insert or update of document on public.dre_books
for each row execute function private.check_integrated_inventory();

create or replace function public.app_delete_company(p_user uuid,p_company text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare
 dre_document jsonb;
 dre_revision bigint;
 cash_records jsonb;
 cash_revision bigint;
 location text[];
 company_field text;
 kept jsonb;
begin
 if public.app_maintenance() then raise exception 'INVALID_STATE'; end if;
 if p_user is null or p_company is null or length(trim(p_company))=0 or length(p_company)>100 then
  raise exception 'INVALID_DATA';
 end if;
 -- The normal DRE and cash save functions use these same locks.
 perform pg_advisory_xact_lock(hashtext('dre:'||p_user::text));
 perform pg_advisory_xact_lock(hashtext(p_user::text));

 select document,revision into dre_document,dre_revision from public.dre_books where user_id=p_user for update;
 select records,revision into cash_records,cash_revision from public.cashbooks where user_id=p_user for update;
 dre_document:=coalesce(dre_document,'{"version":1,"companies":[],"entries":[]}'::jsonb);
 cash_records:=coalesce(cash_records,'[]'::jsonb);
 if not exists(select 1 from jsonb_array_elements(dre_document->'companies') as company where company->>'id'=p_company)
  and not exists(select 1 from jsonb_array_elements(cash_records) as item where item->>'company'=p_company)
 then return null; end if;

 foreach location slice 1 in array array[
  array['companies'],array['entries']
 ] loop
  company_field:=case when location[1]='companies' then 'id' else 'company' end;
  select coalesce(jsonb_agg(item order by position),'[]'::jsonb) into kept
   from jsonb_array_elements(dre_document #> location) with ordinality as rows(item,position)
   where item->>company_field is distinct from p_company;
  dre_document:=jsonb_set(dre_document,location,kept);
 end loop;

 foreach location slice 1 in array array[
  array['operationBook','operations'],array['operationBook','profiles'],
  array['operationBook','transfers'],array['operationBook','audit']
 ] loop
  if dre_document #> location is null then continue; end if;
  select coalesce(jsonb_agg(item order by position),'[]'::jsonb) into kept
   from jsonb_array_elements(dre_document #> location) with ordinality as rows(item,position)
   where item->>'company' is distinct from p_company;
  dre_document:=jsonb_set(dre_document,location,kept);
 end loop;

 foreach location slice 1 in array array[
  array['operationBook','inventory','closings'],array['operationBook','inventory','adjustments'],
  array['operationBook','inventory','reviews']
 ] loop
  if dre_document #> location is null then continue; end if;
  select coalesce(jsonb_agg(item order by position),'[]'::jsonb) into kept
   from jsonb_array_elements(dre_document #> location) with ordinality as rows(item,position)
   where item->>'company' is distinct from p_company;
  dre_document:=jsonb_set(dre_document,location,kept);
 end loop;

 select coalesce(jsonb_agg(item order by position),'[]'::jsonb) into kept
  from jsonb_array_elements(cash_records) with ordinality as rows(item,position)
  where item->>'company' is distinct from p_company;

 insert into public.dre_books(user_id,revision,document)
  values(p_user,coalesce(dre_revision,0)+1,dre_document)
  on conflict(user_id) do update set revision=excluded.revision,document=excluded.document
  returning revision into dre_revision;
 insert into public.cashbooks(user_id,revision,records)
  values(p_user,coalesce(cash_revision,0)+1,kept)
  on conflict(user_id) do update set revision=excluded.revision,records=excluded.records
  returning revision into cash_revision;
 return jsonb_build_object('dre',jsonb_build_object('revision',dre_revision,'document',dre_document),
  'cash',jsonb_build_object('revision',cash_revision,'records',kept));
end $$;
revoke all on function public.app_delete_company(uuid,text) from public,anon,authenticated;
grant execute on function public.app_delete_company(uuid,text) to service_role;

commit;

