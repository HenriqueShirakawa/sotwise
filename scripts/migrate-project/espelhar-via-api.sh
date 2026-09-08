#!/usr/bin/env bash
# =============================================================================
# Variante de `espelhar.sh` para quando não há a senha do Postgres da ORIGEM
# (papel Developer na org do AGK — só Owner/Admin resetam/veem essa senha).
# Em vez de `pg_dump` na origem, lê tudo pela Management API (Personal Access
# Token, ver via-api-dump.ts) e escreve no destino por `psql` (que já
# funciona — a senha do DESTINO está em .env.migracao).
#
# O schema não vem de dump nenhum: é aplicado direto de `supabase/migrations/`
# (a fonte de verdade do repo), o que de brinde já resolve a dívida de
# migration pendente contra a origem.
#
#   bash scripts/migrate-project/espelhar-via-api.sh          # carga (destino vazio)
#   bash scripts/migrate-project/espelhar-via-api.sh --wipe   # zera o destino e recarrega
#   bash scripts/migrate-project/espelhar-via-api.sh --sem-storage
#
# Lê SUPABASE_PAT, SRC_SUPABASE_URL, DST_DB_URL, DST_SUPABASE_URL,
# DST_SERVICE_ROLE_KEY, DST_ANON_KEY, PG_BIN de `.env.migracao`.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

WIPE=0; SEM_STORAGE=0
for arg in "$@"; do
  case "$arg" in
    --wipe)        WIPE=1 ;;
    --sem-storage) SEM_STORAGE=1 ;;
    *) echo "Argumento desconhecido: $arg"; exit 2 ;;
  esac
done

[ -f .env.migracao ] || { echo "ERRO: .env.migracao não existe na raiz do repo."; exit 1; }
set -a; . ./.env.migracao; set +a

exigir() {
  local nome="$1"
  local valor="${!nome:-}"
  [ -n "$valor" ] || { echo "ERRO: $nome está vazio em .env.migracao"; exit 1; }
}
exigir SUPABASE_PAT
exigir SRC_SUPABASE_URL
exigir DST_DB_URL
exigir PG_BIN

PSQL="$PG_BIN/psql"
[ -x "$PSQL" ] || PSQL="$PG_BIN/psql.exe"

alvo() { echo "$1" | sed -E 's#^postgresql://([^:]+):[^@]*@([^/]+).*#\1@\2#'; }
echo "origem : $SRC_SUPABASE_URL (via Management API)"
echo "destino: $(alvo "$DST_DB_URL")"
echo

# --------------------------------------------------------------------- wipe
TABELAS_DESTINO="$("$PSQL" "$DST_DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
USUARIOS_DESTINO="$("$PSQL" "$DST_DB_URL" -tAc "select count(*) from auth.users")"

if [ "$WIPE" = "1" ]; then
  echo "[wipe] zerando o destino ($TABELAS_DESTINO tabela(s), $USUARIOS_DESTINO usuário(s))"
  "$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction <<'SQL'
drop schema if exists public cascade;
create schema public;
delete from auth.identities;
delete from auth.users;
SQL
elif [ "$TABELAS_DESTINO" != "0" ] || [ "$USUARIOS_DESTINO" != "0" ]; then
  echo "ERRO: o destino não está vazio ($TABELAS_DESTINO tabela(s) no public, $USUARIOS_DESTINO usuário(s) no Auth)."
  echo "      Para recarregar por cima, rode de novo com --wipe (isso APAGA o destino)."
  exit 1
fi

TMP="$(mktemp -d -t sotwise-espelho-api-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# ------------------------------------------------------------- ler a origem
echo "[1/6] lendo a origem pela Management API (auth + $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations já aplicadas lá)"
npx tsx scripts/migrate-project/via-api-dump.ts "$TMP/02-auth.sql" "$TMP/03-dados.sql"

# --------------------------------------------------- schema + dados, no destino
# Tudo numa transação só: schema (migrations do repo, na ordem) -> zera o seed
# de `roles`/`role_features` que as próprias migrations inserem (ver nota
# abaixo) -> desliga FK/triggers -> carrega auth -> carrega dados do public.
# Qualquer erro reverte por completo.
echo "[2/6] aplicando schema + dados no destino"
MIGRATIONS=()
for f in supabase/migrations/*.sql; do MIGRATIONS+=(-f "$f"); done

# `roles`/`role_features` recebem seed fixo em 3 migrations (admin/user/owner/
# client), com `id` gerado por `gen_random_uuid()` NO MOMENTO em que a
# migration roda — ou seja, o destino nasce com UUIDs de roles DIFERENTES dos
# da origem. Sem este truncate, ou colide (roles.name é unique) ou, pior,
# fica sem colidir e deixa profiles.role_id/role_features.role_id apontando
# para roles que não existem (FK só não estoura porque replica mode está
# ligado). O cascade alcança profiles/user_features também, mas nada disso
# tem dado ainda nesse ponto — é tudo seed vazio recém-criado.
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  "${MIGRATIONS[@]}" \
  -c 'truncate table public.roles cascade' \
  -c 'set session_replication_role = replica' \
  -f "$TMP/02-auth.sql" \
  -f "$TMP/03-dados.sql"

# --------------------------------------------------------------------- grants
# Redundante na maioria das vezes (todo projeto Supabase novo já nasce com
# default privileges para anon/authenticated/service_role), mas roda mesmo
# assim como rede de segurança — inclui a conferência de que nenhuma tabela
# ficou sem RLS.
echo "[3/6] grants (rede de segurança) + conferência de RLS"
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-project/grants.sql

# ------------------------------------------------------- histórico de migrations
echo "[4/6] histórico em supabase_migrations.schema_migrations"
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL
for f in supabase/migrations/*.sql; do
  base="$(basename "$f" .sql)"
  "$PSQL" "$DST_DB_URL" -q -c "insert into supabase_migrations.schema_migrations (version, name) values ('${base%%_*}', '${base#*_}') on conflict (version) do nothing"
done

# ------------------------------------------------------------------ storage
if [ "$SEM_STORAGE" = "1" ]; then
  echo "[5/6] storage: pulado (--sem-storage)"
else
  echo "[5/6] storage: copiando os arquivos (os dumps não levam o S3)"
  npx tsx scripts/migrate-project/copy-storage.ts
fi

# --------------------------------------------------------------- conferência
echo "[6/6] conferindo contagens: origem (API) x destino (psql)"
npx tsx scripts/migrate-project/contagens-via-api.ts > "$TMP/origem.txt"
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-project/contagens.sql > "$TMP/destino.txt"
echo "--- diff origem × destino (vazio = idênticos) ---"
diff "$TMP/origem.txt" "$TMP/destino.txt" && echo "(idênticos)"

# ----------------------------------------------------------- .env.espelho
if [ -f .env.espelho ] && [ -n "${DST_SUPABASE_URL:-}" ] && [ -n "${DST_SERVICE_ROLE_KEY:-}" ]; then
  awk -v url="$DST_SUPABASE_URL" -v anon="${DST_ANON_KEY:-}" -v srv="$DST_SERVICE_ROLE_KEY" '
    /^SUPABASE_URL=/               { print "SUPABASE_URL=" url; next }
    /^NEXT_PUBLIC_SUPABASE_URL=/   { print "NEXT_PUBLIC_SUPABASE_URL=" url; next }
    /^SUPABASE_ANON_KEY=/          { print "SUPABASE_ANON_KEY=" anon; next }
    /^NEXT_PUBLIC_SUPABASE_ANON_KEY=/ { print "NEXT_PUBLIC_SUPABASE_ANON_KEY=" anon; next }
    /^SUPABASE_SERVICE_ROLE_KEY=/  { print "SUPABASE_SERVICE_ROLE_KEY=" srv; next }
    { print }
  ' .env.espelho > .env.espelho.tmp && mv .env.espelho.tmp .env.espelho
  echo ".env.espelho apontado para o destino (RESEND_API_KEY e CRON_SECRET seguem vazias de propósito)"
fi

echo
echo "Espelho carregado via API (sem pg_dump/senha na origem). A produção NÃO foi tocada."
echo "Próximo: §8 (config de Auth no dashboard) e §9 (validação local) do runbook."
