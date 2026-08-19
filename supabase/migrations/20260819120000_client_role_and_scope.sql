-- =============================================================================
-- Papel `client` + escopo por cliente (Fase 2, identidade).
--
-- O usuário do CLIENTE não é "um `user` com menos features": as features do
-- catálogo (`domain/access/features.ts`) são todas telas internas. Ele vive num
-- app à parte — `app/(client)/` — e por isso NÃO recebe nenhuma linha em
-- `role_features`. A ausência é intencional e é o que faz o `requireFeature()`
-- barrar o cliente em qualquer rota interna (fail closed, igual ao resto do
-- RBAC); o `landingPath()` da DAL devolve `/portal` para ele.
--
-- A fronteira do que ele enxerga é `profiles.client_id`: um usuário pertence a
-- UM cliente, um cliente tem N usuários (decisão de 2026-08-18 — sem N-N, e sem
-- recorte por `company`, que não se aplica a quem é de fora).
-- =============================================================================

-- ---------- papel ----------
-- `roles.name` é unique; o do-nothing deixa a migration idempotente.
insert into public.roles (name) values ('client')
  on conflict (name) do nothing;

-- ---------- vínculo usuário → cliente ----------
-- Nullable porque a esmagadora maioria dos profiles é interna e não tem cliente
-- nenhum. A regra "papel client EXIGE client_id (e os demais papéis exigem
-- null)" não vira CHECK: o papel mora em `roles`, e CHECK não faz subquery.
-- Fica na camada de aplicação, no padrão do resto do projeto (RLS deny-all +
-- autorização no servidor):
--   - escrita: `createUserRecord`/`updateUserRecord` resolvem o nome do papel e
--     recusam a combinação inválida;
--   - leitura: `requireClientScope()` derruba a sessão de um `client` sem
--     `client_id` em vez de deixá-lo entrar sem escopo — o modo de falhar é
--     "não vê nada", nunca "vê tudo".
alter table public.profiles
  add column if not exists client_id uuid references public.clients(id);

create index if not exists idx_profiles_client_id on public.profiles(client_id);

comment on column public.profiles.client_id is
  'Cliente dono deste usuário externo. Obrigatório quando o papel é `client`, null nos papéis internos.';
