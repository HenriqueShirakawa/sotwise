#!/usr/bin/env bash
# =============================================================================
# Espelha o Supabase de ORIGEM no de DESTINO (Fase A de docs/MIGRACAO_SUPABASE_CLIENTE.md).
#
# Por que existe: a carga não é feita uma vez. O espelho envelhece a cada
# escrita na origem, então ele é recarregado — pelo menos mais uma vez, na
# véspera da virada, e é ESSA carga que vale. Um roteiro de 12 comandos digitados
# à mão erra na décima segunda; aqui é um comando só, repetível.
#
#   bash scripts/migrate-project/espelhar.sh              # carga (destino tem que estar vazio)
#   bash scripts/migrate-project/espelhar.sh --wipe       # ZERA o destino e recarrega
#   bash scripts/migrate-project/espelhar.sh --sem-storage
#   bash scripts/migrate-project/espelhar.sh --conferir   # só compara as contagens
#
# Lê as credenciais dos dois projetos de `.env.migracao` (gitignored).
# Os dumps vão para uma pasta temporária FORA do repo e são apagados no fim
# (contêm dados pessoais e hashes de senha) — use --manter-dumps para inspecionar.
#
# NUNCA toca na Vercel nem no `.env.local`: este script só fala com os dois
# bancos. Colocar o espelho em uso é outro assunto (Fase B do runbook).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."

WIPE=0; SEM_STORAGE=0; SO_CONFERIR=0; MANTER_DUMPS=0
for arg in "$@"; do
  case "$arg" in
    --wipe)         WIPE=1 ;;
    --sem-storage)  SEM_STORAGE=1 ;;
    --conferir)     SO_CONFERIR=1 ;;
    --manter-dumps) MANTER_DUMPS=1 ;;
    *) echo "Argumento desconhecido: $arg"; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- credenciais
[ -f .env.migracao ] || { echo "ERRO: .env.migracao não existe na raiz do repo."; exit 1; }
set -a; . ./.env.migracao; set +a

exigir() {
  local nome="$1"
  local valor="${!nome:-}"
  [ -n "$valor" ] || { echo "ERRO: $nome está vazio em .env.migracao"; exit 1; }
}
exigir SRC_DB_URL
exigir DST_DB_URL

# Salvaguarda mais importante do script: dumpar e restaurar no MESMO banco
# apagaria a origem. Comparação por host+usuário (a senha pode diferir).
alvo() { echo "$1" | sed -E 's#^postgresql://([^:]+):[^@]*@([^/]+).*#\1@\2#'; }
SRC_ALVO="$(alvo "$SRC_DB_URL")"
DST_ALVO="$(alvo "$DST_DB_URL")"
[ "$SRC_ALVO" != "$DST_ALVO" ] || { echo "ERRO: SRC_DB_URL e DST_DB_URL apontam para o mesmo banco ($SRC_ALVO)."; exit 1; }

# ------------------------------------------------------------------ binários
PG_BIN="${PG_BIN:-}"
if [ -z "$PG_BIN" ]; then
  if command -v pg_dump >/dev/null 2>&1; then PG_BIN="$(dirname "$(command -v pg_dump)")"; fi
fi
[ -n "$PG_BIN" ] || {
  cat <<'AJUDA'
ERRO: pg_dump/psql não encontrados.

Baixe os binários avulsos do PostgreSQL 17 (não precisa instalar o servidor):
  https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip
Descompacte e aponte para a pasta `pgsql/bin`:
  PG_BIN=/c/pgsql/bin bash scripts/migrate-project/espelhar.sh
AJUDA
  exit 1
}
PGDUMP="$PG_BIN/pg_dump"; PSQL="$PG_BIN/psql"
VERSAO="$("$PGDUMP" --version | grep -oE '[0-9]+' | head -1)"
[ "$VERSAO" -ge 17 ] || { echo "ERRO: pg_dump é $VERSAO.x; a origem é Postgres 17 (dump de 17 não restaura em versão menor)."; exit 1; }

echo "origem : $SRC_ALVO"
echo "destino: $DST_ALVO"
echo "pg_dump: $VERSAO.x em $PG_BIN"
echo

# ------------------------------------------------------------------ conferir
contagens() { "$PSQL" "$1" -v ON_ERROR_STOP=1 -f scripts/migrate-project/contagens.sql; }

if [ "$SO_CONFERIR" = "1" ]; then
  TMP="$(mktemp -d)"
  contagens "$SRC_DB_URL" > "$TMP/origem.txt"
  contagens "$DST_DB_URL" > "$TMP/destino.txt"
  echo "--- diff origem × destino (vazio = idênticos) ---"
  diff "$TMP/origem.txt" "$TMP/destino.txt" && echo "(idênticos)"
  rm -rf "$TMP"
  exit 0
fi

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

# --------------------------------------------------------------------- dumps
TMP="$(mktemp -d -t sotwise-espelho-XXXXXX)"
limpar() { [ "$MANTER_DUMPS" = "1" ] && echo "dumps mantidos em $TMP" || rm -rf "$TMP"; }
trap limpar EXIT

echo "[1/7] dump do schema public"
"$PGDUMP" "$SRC_DB_URL" --schema=public --schema-only \
  --no-owner --no-privileges --quote-all-identifiers -f "$TMP/01-schema.sql"

echo "[2/7] dump dos usuários do Auth (uuid, e-mail e hash da senha)"
"$PGDUMP" "$SRC_DB_URL" --data-only \
  --table=auth.users --table=auth.identities -f "$TMP/02-auth.sql"

echo "[3/7] dump dos dados do public"
"$PGDUMP" "$SRC_DB_URL" --schema=public --data-only -f "$TMP/03-dados.sql"

# ----------------------------------------------------------------- restore
# session_replication_role=replica desliga FK e TRIGGERS durante a carga: é o que
# permite restaurar na ordem em que o dump saiu e o que impede o trigger de
# checklist e o de notificação ao cliente de dispararem para 1,5k orders.
# Tudo numa transação só — qualquer erro reverte por completo.
echo "[4/7] restaurando no destino"
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f "$TMP/01-schema.sql" \
  -c 'set session_replication_role = replica' \
  -f "$TMP/02-auth.sql" \
  -f "$TMP/03-dados.sql"

# O dump sai com --no-privileges, então as tabelas chegam sem GRANT e o PostgREST
# recusaria até a service_role — que é por onde passa TODO o acesso do app.
echo "[5/7] grants + policies de Realtime (não vêm no dump do public)"
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-project/grants.sql
"$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260813130000_messages_realtime.sql \
  -f supabase/migrations/20260820140000_orders_realtime.sql \
  -f supabase/migrations/20260820150000_shipments_realtime.sql \
  -f supabase/migrations/20260820160000_preloading_realtime.sql

# ------------------------------------------------- dívida de migrations
# O dump copia o que a ORIGEM tem — e a origem está atrás do repo. O espelho é o
# lugar seguro de aplicar o que falta antes da virada.
echo "[6/7] migrations do repo que a origem ainda não tem"
FALTA_LOADED_LINES="$("$PSQL" "$DST_DB_URL" -tAc "select to_regclass('public.shipment_loaded_lines') is null")"
if [ "$FALTA_LOADED_LINES" = "t" ]; then
  echo "      aplicando 20260828120000_shipment_loaded_lines.sql"
  "$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260828120000_shipment_loaded_lines.sql
  "$PSQL" "$DST_DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-project/grants.sql >/dev/null
else
  echo "      nada a aplicar"
fi

# Histórico, para o banco e `supabase/migrations/` passarem a bater.
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
  echo "[7/7] storage: pulado (--sem-storage)"
else
  echo "[7/7] storage: copiando os arquivos (os dumps não levam o S3)"
  npx tsx scripts/migrate-project/copy-storage.ts
fi

# --------------------------------------------------------------- conferência
echo
echo "--- diff das contagens: origem × destino (vazio = idênticos) ---"
contagens "$SRC_DB_URL" > "$TMP/origem.txt"
contagens "$DST_DB_URL" > "$TMP/destino.txt"
diff "$TMP/origem.txt" "$TMP/destino.txt" && echo "(idênticos)"

# ----------------------------------------------------------- .env.espelho
# Preenche as 4 variáveis do destino no `.env.espelho` (o `.env.local` que aponta
# para o espelho, §9 do runbook). Feito aqui para ninguém colar a chave errada à
# mão — e para o `.env.local` DE PRODUÇÃO nunca ser tocado por este script.
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
echo "Espelho carregado. A produção NÃO foi tocada."
echo "Próximo: §8 (config de Auth no dashboard) e §9 (validação local) do runbook."
