-- ===========================================================================
-- Resolver e-mail → id de usuário do SOTWISE, para a via inbound do GSS.
--
-- Contexto: o POST /api/gss/orders passa a aceitar `leader_email` e
-- `requester_email`. Diferente das bibliotecas (que têm `gss_id`), os usuários
-- vivem em `profiles`, cujo id referencia `auth.users` — e o e-mail mora em
-- `auth.users`, schema que o PostgREST não expõe. Esta função (SECURITY DEFINER)
-- faz a ponte: recebe um e-mail e devolve o id do profile correspondente, ou
-- NULL se não existir.
--
-- Casa por e-mail normalizado (trim + case-insensitive). `auth.users.email` tem
-- índice único, então o lookup é barato. Só o service_role executa — o e-mail é
-- dado sensível e o app só chama isto pelo client admin no servidor.
-- ===========================================================================

create or replace function public.profile_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;

comment on function public.profile_id_by_email(text) is
  'Resolve e-mail (case-insensitive) para o id do profile SOTWISE. NULL se não houver usuário. Usada pela via inbound do GSS (/api/gss/orders) para leader/requester.';

-- Fecha a função para todos e libera só o service_role (client admin do app).
revoke all on function public.profile_id_by_email(text) from public;
revoke all on function public.profile_id_by_email(text) from anon;
revoke all on function public.profile_id_by_email(text) from authenticated;
grant execute on function public.profile_id_by_email(text) to service_role;
