# Migração do SOTWISE para o Supabase do cliente

Runbook da **virada de projeto Supabase**: cópia 1:1 (schema + dados + usuários do
Auth + arquivos do Storage) do projeto atual para o projeto do cliente, e
apontamento da produção (Vercel) para o novo.

> **Escopo.** Só muda **onde o banco mora**. Nada de código de aplicação muda —
> o app inteiro fala com o Supabase por 4 variáveis de ambiente
> (`lib/supabase/admin.ts`, `lib/env.ts`). GSS, Resend e Anthropic não são
> afetados.

## 0. O que precisa estar em mãos

| Item | Origem (AGK atual) | Destino (cliente) |
|---|---|---|
| Project ref | `qqbeoljgpfllhcvqrsup` | a preencher |
| Connection string do Postgres | necessária | necessária |
| `service_role` key | já em `.env.local` | a preencher |
| `anon` key | já em `.env.local` | a preencher |
| Acesso ao dashboard | leitura/SQL | **owner** (para configurar o Auth) |

Use a **Session Pooler** (porta `5432`) e não a conexão direta — a direta é
IPv6-only e não fecha da máquina do dev. Formato:

```
postgresql://postgres.<project-ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

A senha está em **Project Settings → Database → Database password** (se ninguém
souber, dá para redefinir ali mesmo — redefinir não derruba nada além de conexões
que usem a senha antiga).

Crie `.env.migracao` na raiz (o `.gitignore` já cobre `.env*`):

```
SRC_DB_URL=postgresql://postgres.qqbeoljgpfllhcvqrsup:...@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
SRC_SUPABASE_URL=https://qqbeoljgpfllhcvqrsup.supabase.co
SRC_SERVICE_ROLE_KEY=...

DST_DB_URL=postgresql://postgres.<novo-ref>:...@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
DST_SUPABASE_URL=https://<novo-ref>.supabase.co
DST_SERVICE_ROLE_KEY=...
```

**Pré-condição do destino:** projeto **vazio** — Postgres 17, região `sa-east-1`,
`public` sem tabelas e **sem nenhum usuário no Auth**. Se já tiver usuário criado
(um admin de teste do cliente, por exemplo), apague antes: a restauração de
`auth.users` colide em e-mail duplicado.

Ferramentas: `pg_dump`/`psql` **17.x**. Não precisa instalar Postgres — os
binários avulsos resolvem:
`https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip`
(descompactar e usar `pgsql/bin/`).

## 1. Inventário da origem (antes de dumpar)

```bash
psql "$SRC_DB_URL" -c "select extname, extversion from pg_extension order by 1"
psql "$SRC_DB_URL" -c "select rolname from pg_roles where rolname not like 'pg\_%' and rolname not in ('postgres','anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_read_only_user','supabase_realtime_admin','dashboard_user','pgbouncer','pgsodium_keyholder','pgsodium_keyiduser','pgtle_admin') order by 1"
psql "$SRC_DB_URL" -f scripts/migrate-project/contagens.sql > origem-contagens.txt
```

O esperado é: extensões só as padrão do Supabase (`pgcrypto`, `uuid-ossp`,
`pg_graphql`, `pgjwt`, `supabase_vault`, `pg_stat_statements`), **nenhum** role
customizado, **nenhum** `pg_cron`/`pg_net` (o cron do sync GSS é da Vercel, não do
banco). Se aparecer algo fora disso, tratar antes de seguir.

## 2. Dumps (origem)

`$PG` = pasta `pgsql/bin` dos binários.

```bash
# schema do public (sem dono e sem grants — os grants são refeitos no passo 3)
$PG/pg_dump "$SRC_DB_URL" --schema=public --schema-only \
  --no-owner --no-privileges --quote-all-identifiers -f 01-schema.sql

# usuários do Auth (preserva uuid, e-mail e hash da senha)
$PG/pg_dump "$SRC_DB_URL" --data-only \
  --table=auth.users --table=auth.identities -f 02-auth.sql

# dados do public (COPY; inclui os setval das sequences)
$PG/pg_dump "$SRC_DB_URL" --schema=public --data-only -f 03-dados.sql
```

Os dumps têm dados pessoais e hashes — deixe-os **fora do repositório** (pasta
temporária) e apague no fim.

O schema `storage` **não** é dumpado de propósito: os arquivos moram no S3, e as
linhas de `storage.objects` são recriadas pelo upload no passo 5.

## 3. Restauração (destino)

```bash
$PG/psql "$DST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f 01-schema.sql \
  -c 'set session_replication_role = replica' \
  -f 02-auth.sql \
  -f 03-dados.sql
```

`session_replication_role = replica` desliga a checagem de FK e os triggers
durante a carga — é o que permite restaurar na ordem em que o dump saiu (é o
mesmo caminho que a própria Supabase documenta). Como tudo está numa transação
só, qualquer erro reverte por completo.

Em seguida, os grants (a RLS deny-all continua protegendo `anon`/`authenticated`;
sem os grants o PostgREST recusa até a `service_role`):

```bash
$PG/psql "$DST_DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrate-project/grants.sql
```

E as 4 policies de Realtime, que vivem no schema `realtime` e por isso ficam fora
do dump do `public`:

```bash
$PG/psql "$DST_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260813130000_messages_realtime.sql \
  -f supabase/migrations/20260820140000_orders_realtime.sql \
  -f supabase/migrations/20260820150000_shipments_realtime.sql \
  -f supabase/migrations/20260820160000_preloading_realtime.sql
```

## 4. Migrations pendentes

Algumas migrations do repo estão marcadas como **não aplicadas na origem** — logo
não vêm no dump. Confira o que chegou no destino e complete o que faltar:

```bash
$PG/psql "$DST_DB_URL" -c "\d public.shipment_loaded_lines"
$PG/psql "$DST_DB_URL" -c "\d public.gss_inbound_orders"
$PG/psql "$DST_DB_URL" -c "\d public.pre_loading_checklist_steps"   # coluna carrier_id
```

Para cada uma que não existir:

```bash
$PG/psql "$DST_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260820120000_pl_step_carrier.sql \
  -f supabase/migrations/20260824120000_gss_orders_inbound.sql \
  -f supabase/migrations/20260828120000_shipment_loaded_lines.sql
```

> A virada é a hora certa de zerar essa dívida: com o destino sob nosso controle,
> o repo e o banco passam a bater.

## 5. Storage (arquivos)

```bash
npx tsx scripts/migrate-project/copy-storage.ts --dry-run   # confere o inventário
npx tsx scripts/migrate-project/copy-storage.ts             # copia de verdade
```

Cria os buckets no destino com o mesmo nome/visibilidade e copia arquivo por
arquivo. Buckets em uso: `order-documents`, `business-units` (e `order-types`, se
existir). Repetível — usa `upsert`.

## 6. Configuração do projeto destino (dashboard — não vem no dump)

Nada disso está no banco; é config de projeto e precisa ser refeita à mão:

1. **Authentication → URL Configuration**
   - Site URL: `https://agksystem.com` (ou o domínio de produção vigente)
   - Redirect URLs: `https://agksystem.com/**` + `https://<projeto>.vercel.app/**`
   - _Este é o item que estava quebrado no projeto antigo (ficou em
     `localhost:3000` porque não tínhamos o owner). Agora dá para consertar._
2. **Authentication → Providers**: Email ligado; **Confirm email** e signup
   público conforme a origem (o app cria usuário por convite, via Admin API).
3. **Authentication → Emails**: os templates do reset/convite. O envio real é
   pelo Resend (`RESEND_API_KEY`), não pelo SMTP do Supabase.
4. **Project Settings → API**: copiar `anon` e `service_role` do destino.
5. Confirmar região `sa-east-1` e que o **PITR/backup** do plano está ligado.

## 7. Virada

1. Atualizar `.env.local` (4 variáveis) para o destino.
2. Vercel → Settings → Environment Variables (**Production e Preview**):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`. As demais (`RESEND_*`, `GSS_*`, `CRON_SECRET`,
   `ANTHROPIC_API_KEY`, `API_TOKEN`, `GSS_INBOUND_SECRET`) **não mudam**.
3. **Redeploy** (a Vercel não recarrega env var sem novo deploy).
4. Congelar a origem: pausar o projeto antigo só depois da validação — ele é o
   rollback.

> **Todo mundo é deslogado.** O JWT secret é outro, então as sessões ativas
> morrem e cada usuário precisa entrar de novo. **As senhas continuam valendo**
> (o hash foi junto em `auth.users`).

## 8. Verificação

```bash
psql "$DST_DB_URL" -f scripts/migrate-project/contagens.sql > destino-contagens.txt
diff origem-contagens.txt destino-contagens.txt
```

`storage.objects` vai divergir se a origem tiver linhas órfãs; o resto tem que
bater exatamente. Depois, no app em produção:

- login com uma conta real (senha antiga);
- lista de Orders com dados e um pedido aberto com anexo (valida Storage);
- criar/ler uma mensagem (valida Realtime + `service_role`);
- `/access` abrindo como owner (valida RBAC e `role_features`).

## 9. Rollback

Reverter as 4 env vars da Vercel para o projeto antigo e redeployar. Como a
origem fica intacta e sem escrita durante a janela, o rollback é imediato — a
única perda é o que tiver sido escrito no destino depois da virada.

## 10. Depois da virada

- Registrar as 28 migrations em `supabase_migrations.schema_migrations` no
  destino, para que o histórico bata com `supabase/migrations/`.
- Apagar os dumps locais (`01-schema.sql`, `02-auth.sql`, `03-dados.sql`) e o
  `.env.migracao`.
- Atualizar as referências ao ref antigo em `.env.example` e `docs/DEPLOY.md`.
- Revogar as chaves do projeto antigo que estiverem circulando.
