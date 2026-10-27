#!/usr/bin/env bash
# =============================================================================
# Espelho AGK -> SOT-VISTA SEM o PAT da origem (27/10/2026).
#
# Variante de `espelhar-via-api.sh` para quando não há Personal Access Token
# com acesso ao AGK: o public é lido pela API REST da origem (service role,
# via-rest-dump.ts) e o Auth do DESTINO não é apagado — os usuários que já
# estão lá ficam com a senha que têm; os que faltam são criados com o mesmo id
# e sem senha (criar-usuarios-faltantes.ts → "Forgot password" uma vez).
#
# ⚠️ APAGA o schema public do destino e recria das migrations do repo.
#
#   bash scripts/migrate-project/espelhar-sem-pat.sh
#
# Lê SRC_SUPABASE_URL, SRC_SERVICE_ROLE_KEY, DST_DB_URL, DST_SUPABASE_URL,
# DST_SERVICE_ROLE_KEY, PG_BIN de `.env.migracao`.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

[ -f .env.migracao ] || { echo "ERRO: .env.migracao não existe na raiz do repo."; exit 1; }
set -a; . ./.env.migracao; set +a

for nome in SRC_SUPABASE_URL SRC_SERVICE_ROLE_KEY DST_DB_URL DST_SUPABASE_URL DST_SERVICE_ROLE_KEY PG_BIN; do
  [ -n "${!nome:-}" ] || { echo "ERRO: $nome está vazio em .env.migracao"; exit 1; }
done

PSQL="$PG_BIN/psql"
[ -x "$PSQL" ] || PSQL="$PG_BIN/psql.exe"

alvo() { echo "$1" | sed -E 's#^postgresql://([^:]+):[^@]*@([^/]+).*#\1@\2#'; }
echo "origem : $SRC_SUPABASE_URL (API REST)"
echo "destino: $(alvo "$DST_DB_URL")"
echo

TMP="$(mktemp -d -t sotwise-espelho-rest-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# --------------------------------------------------------------- 1. schema
# Mesma lógica do espelhar-via-api.sh: public do zero pelas migrations do repo,
# depois zera o seed de roles (as migrations geram UUIDs diferentes da origem).
echo "[1/6] recriando o public do destino pelas migrations ($(ls supabase/migrations/*.sql | wc -l | tr -d ' '))"
MIGRATIONS=()
for f in supabase/migrations/*.sql; do MIGRATIONS+=(-f "$f"); done
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
  -c 'drop schema if exists public cascade' \
  -c 'create schema public' \
  "${MIGRATIONS[@]}" \
  -c 'truncate table public.roles cascade'

# ---------------------------------------------- 2. tabelas/colunas do destino
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -tA > "$TMP/tabelas.json" <<'SQL'
select coalesce(json_agg(json_build_object(
  'table', t.table_name,
  'columns', (select json_agg(c.column_name order by c.ordinal_position)
              from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = t.table_name
                and c.is_generated <> 'ALWAYS'),
  'pk', coalesce((select json_agg(k.column_name order by k.ordinal_position)
                  from information_schema.table_constraints tc
                  join information_schema.key_column_usage k
                    on k.constraint_name = tc.constraint_name
                   and k.table_schema = tc.table_schema and k.table_name = tc.table_name
                  where tc.table_schema = 'public' and tc.table_name = t.table_name
                    and tc.constraint_type = 'PRIMARY KEY'), '[]'::json)
) order by t.table_name), '[]'::json)
from information_schema.tables t
where t.table_schema = 'public' and t.table_type = 'BASE TABLE';
SQL

# ------------------------------------------------------- 3. dados da origem
echo "[2/6] lendo o public da origem"
npx tsx scripts/migrate-project/via-rest-dump.ts "$TMP/tabelas.json" "$TMP/03-dados.sql"

# ------------------------------------------------------- 4. carga no destino
echo "[3/6] carregando no destino (FK/triggers desligados durante a carga)"
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
  -c 'set session_replication_role = replica' \
  -f "$TMP/03-dados.sql"

# Colunas identity recebem o id da origem (overriding system value) — a
# sequência tem que seguir do maior id, senão o próximo insert colide.
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare r record;
begin
  for r in
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and is_identity = 'YES'
  loop
    execute format(
      'select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 0) + 1, false)',
      'public.' || r.table_name, r.column_name, r.column_name, r.table_name
    );
  end loop;
end $$;
SQL

# ------------------------------------------------- 5. grants + migrations log
echo "[4/6] grants + histórico de migrations"
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -q -f scripts/migrate-project/grants.sql
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
for f in supabase/migrations/*.sql; do
  base="$(basename "$f" .sql)"
  "$PSQL" "$DST_DB_URL" -q -c "insert into supabase_migrations.schema_migrations (version, name) values ('${base%%_*}', '${base#*_}') on conflict (version) do nothing"
done

# ------------------------------------------------------------ 6. auth + storage
echo "[5/6] usuários que faltam no destino + storage"
npx tsx scripts/migrate-project/criar-usuarios-faltantes.ts
npx tsx scripts/migrate-project/copy-storage.ts

# ------------------------------------------------------------- conferência
echo "[6/6] contagens origem × destino"
npx tsx scripts/migrate-project/contagens-via-rest.ts "$TMP/tabelas.json"

echo
echo "Espelho carregado (sem PAT). A produção NÃO foi tocada até trocar as envs na Vercel."
