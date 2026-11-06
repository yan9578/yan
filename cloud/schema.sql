-- Execute no SQL Editor do seu projeto Supabase. Não contém senhas.
create table if not exists public.cashbooks (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision bigint not null default 0 check (revision >= 0),
 records jsonb not null default '[]'::jsonb check (jsonb_typeof(records) = 'array' and jsonb_array_length(records) <= 5000)
);
alter table public.cashbooks enable row level security;
revoke all on public.cashbooks from anon;
grant select,insert,update on public.cashbooks to authenticated;
drop policy if exists own_cashbook on public.cashbooks;
create policy own_cashbook on public.cashbooks for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create or replace function public.save_cashbook(expected_revision bigint, new_records jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare current_revision bigint;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 if expected_revision is null or expected_revision < 0 or new_records is null
 or jsonb_typeof(new_records) <> 'array' then raise exception 'INVALID_DATA'; end if;
 if jsonb_array_length(new_records) > 5000 or octet_length(new_records::text)>2000000 then raise exception 'INVALID_DATA'; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select revision into current_revision from public.cashbooks where user_id=auth.uid() for update;
 if not found then
  if expected_revision <> 0 then raise exception 'REVISION_CONFLICT'; end if;
  insert into public.cashbooks(user_id,revision,records) values(auth.uid(),1,new_records);
  return 1;
 end if;
 if current_revision <> expected_revision then raise exception 'REVISION_CONFLICT'; end if;
 update public.cashbooks set revision=revision+1,records=new_records where user_id=auth.uid();
 return current_revision+1;
end $$;
revoke all on function public.save_cashbook(bigint,jsonb) from public,anon;
grant execute on function public.save_cashbook(bigint,jsonb) to authenticated;
