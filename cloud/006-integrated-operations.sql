begin;

-- Store the integrated book alongside the DRE so revisions, backups and
-- account deletion cover both without copying any existing movements.
create or replace function private.protect_integrated_book()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare saved jsonb; companies jsonb;
begin
 if tg_op='UPDATE' then saved:=old.document->'operationBook'; end if;
 if current_user in ('anon','authenticated') then
  new.document:=new.document-'operationBook';
  if saved is not null then new.document:=new.document||jsonb_build_object('operationBook',saved); end if;
 elsif saved is not null and not (new.document ? 'operationBook') then
  raise exception 'INVALID_STATE';
 end if;

 saved:=new.document->'operationBook';
 if saved is null then return new; end if;
 if jsonb_typeof(saved) is distinct from 'object'
 or jsonb_typeof(saved->'operations') is distinct from 'array'
 or jsonb_typeof(saved->'profiles') is distinct from 'array'
 or jsonb_typeof(saved->'transfers') is distinct from 'array'
 or jsonb_typeof(saved->'audit') is distinct from 'array'
 or octet_length(new.document::text)>2000000 then raise exception 'INVALID_DATA'; end if;
 companies:=new.document->'companies';
 if exists (
  select 1 from jsonb_array_elements((saved->'operations')||(saved->'profiles')||(saved->'transfers')) as entry
  where not exists(select 1 from jsonb_array_elements(companies) as company where company->>'id'=entry->>'company')
 ) then raise exception 'INVALID_STATE'; end if;
 return new;
end $$;
revoke all on function private.protect_integrated_book() from public,anon,authenticated;
drop trigger if exists protect_integrated_book on public.dre_books;
create trigger protect_integrated_book before insert or update of document on public.dre_books
for each row execute function private.protect_integrated_book();

create or replace function public.app_save_operations(p_user uuid,p_revision bigint,p_book jsonb)
returns bigint language plpgsql security invoker set search_path=pg_catalog as $$
declare saved_revision bigint;
begin
 if public.app_maintenance() then raise exception 'INVALID_STATE'; end if;
 if p_user is null or p_revision is null or p_revision<0 or p_book is null then raise exception 'INVALID_DATA'; end if;
 perform pg_advisory_xact_lock(hashtext('dre:'||p_user::text));
 update public.dre_books set revision=revision+1,document=jsonb_set(document,'{operationBook}',p_book)
 where user_id=p_user and revision=p_revision returning revision into saved_revision;
 if not found then raise exception 'REVISION_CONFLICT'; end if;
 return saved_revision;
end $$;
revoke all on function public.app_save_operations(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.app_save_operations(uuid,bigint,jsonb) to service_role;
commit;
