-- Execute uma vez, no SQL Editor, depois de confirmar que esta conta é sua.
-- O papel não vem de metadados editáveis pelo usuário nem do frontend.
do $$
declare owner_id uuid;
begin
 select id into owner_id from auth.users
 where lower(email)='yansiqueirapedro@gmail.com' and email_confirmed_at is not null;
 if owner_id is null then raise exception 'Confirme primeiro o e-mail da conta proprietária no Supabase.'; end if;
 insert into private.app_admins(user_id) values(owner_id) on conflict do nothing;
end $$;
