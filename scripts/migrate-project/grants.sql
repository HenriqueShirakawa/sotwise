-- Grants do schema public no projeto DESTINO, depois de restaurar o dump.
--
-- Por que existe: o dump é feito com --no-privileges (para não arrastar
-- referências de dono/role da origem), então as tabelas chegam sem GRANT. Sem
-- isto o PostgREST recusa até a `service_role` — e a `service_role` é por onde
-- passa TODO o acesso a dados do app (lib/supabase/admin.ts).
--
-- Isto NÃO abre o banco: a RLS deny-all (migration 20260727095000) continua
-- valendo para anon/authenticated, que são as chaves que chegam ao browser. A
-- service_role ignora RLS por definição — é o mesmo desenho da origem.
--
--   psql "$DST_DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-project/grants.sql

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- E para o que for criado daqui pra frente (migrations futuras rodam como postgres).
alter default privileges in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- Conferência: nenhuma tabela do public pode ficar sem RLS habilitada.
select relname as tabela_sem_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
order by 1;
