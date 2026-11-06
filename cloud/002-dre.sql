begin;
create table if not exists public.dre_books (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 0 check (revision >= 0),
 document jsonb not null default '{"version":1,"companies":[],"entries":[]}'::jsonb,
 constraint dre_document_shape check (
  document ?& array['version','companies','entries']
  and jsonb_typeof(document)='object'
  and document->'version'='1'::jsonb
  and jsonb_typeof(document->'companies')='array'
  and jsonb_typeof(document->'entries')='array'
  and jsonb_array_length(document->'companies')<=1000
  and jsonb_array_length(document->'entries')<=50000
  and octet_length(document::text)<=2000000
 )
);
alter table public.dre_books enable row level security;
revoke all on public.dre_books from public,anon,authenticated;
grant usage on schema public to authenticated;
grant select,insert,update on public.dre_books to authenticated;
drop policy if exists own_dre_book on public.dre_books;
create policy own_dre_book on public.dre_books for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create or replace function public.save_dre_book(expected_revision bigint,new_document jsonb)
returns bigint language plpgsql security invoker set search_path=public as $$
declare previous_revision bigint;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 if expected_revision is null or expected_revision<0 or new_document is null
 or jsonb_typeof(new_document)<>'object'
 or new_document->'version' is distinct from '1'::jsonb
 or jsonb_typeof(new_document->'companies') is distinct from 'array'
 or jsonb_typeof(new_document->'entries') is distinct from 'array'
 then raise exception 'INVALID_DATA'; end if;
 if jsonb_array_length(new_document->'companies')>1000
 or jsonb_array_length(new_document->'entries')>50000
 or octet_length(new_document::text)>2000000 then raise exception 'INVALID_DATA'; end if;
 perform pg_advisory_xact_lock(hashtext('dre:'||auth.uid()::text));
 select revision into previous_revision from public.dre_books where user_id=auth.uid() for update;
 if not found then
  if expected_revision<>0 then raise exception 'REVISION_CONFLICT'; end if;
  insert into public.dre_books(user_id,revision,document) values(auth.uid(),1,new_document);
  return 1;
 end if;
 if previous_revision<>expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 update public.dre_books set revision=revision+1,document=new_document where user_id=auth.uid();
 return previous_revision+1;
end $$;
revoke all on function public.save_dre_book(bigint,jsonb) from public,anon;
grant execute on function public.save_dre_book(bigint,jsonb) to authenticated;
commit;
