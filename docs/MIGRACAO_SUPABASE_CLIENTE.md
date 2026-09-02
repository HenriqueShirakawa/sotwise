# Migração do SOTWISE para o Supabase do cliente

Runbook da **virada de projeto Supabase**: cópia 1:1 (schema + dados + usuários do
Auth + arquivos do Storage) do projeto atual para o projeto do cliente.

O trabalho está partido em **duas fases independentes**, que podem ficar semanas
separadas uma da outra:

| | O que acontece | Produção |
|---|---|---|
| **Fase A — Espelho** (§1–§10) | O projeto do cliente passa a ter tudo o que temos hoje: schema, dados, usuários, arquivos, config de Auth. É validado rodando o app **localmente** contra ele. | Segue no AGK. **Nada muda.** |
| **Fase B — Virada** (§11–§14) | A produção (Vercel) passa a apontar para o projeto do cliente. | Troca de banco. |

> **A Fase A não toca na Vercel.** É a regra que garante que o espelho não "entra
> em uso" sem querer: enquanto a Fase B não for executada, **nenhuma env var de
> Production ou Preview é alterada**. O espelho é um banco parado, que só a
> máquina do dev enxerga.

> **Escopo.** Só muda **onde o banco mora**. Nada de código de aplicação muda —
> o app inteiro fala com o Supabase por 4 variáveis de ambiente
> (`lib/supabase/admin.ts`, `lib/env.ts`). GSS, Resend e Anthropic não são
> afetados.

---

# Fase A — montar o espelho

> **Atalho.** Os passos §3 a §7 (dumps, restore, grants, policies de Realtime,
> migrations pendentes e Storage) estão scriptados em
> `scripts/migrate-project/espelhar.sh` — um comando, repetível:
>
> ```bash
> bash scripts/migrate-project/espelhar.sh          # carga (destino vazio)
> bash scripts/migrate-project/espelhar.sh --wipe   # zera o destino e recarrega
> bash scripts/migrate-project/espelhar.sh --conferir
> ```
>
> As seções abaixo continuam valendo como explicação do que ele faz e para
> quando algum passo precisar ser rodado à mão. Os §0–§2, §8 e §9 são humanos.

## 0. O que precisa estar em mãos

| Item | Origem (AGK atual) | Destino (cliente) |
|---|---|---|
| Project ref | `qqbeoljgpfllhcvqrsup` | a preencher |
| Connection string do Postgres | a preencher | a preencher |
| `service_role` key | já em `.env.migracao` | a preencher |
| `anon` key | já em `.env.local` | a preencher |
| Acesso ao dashboard | leitura/SQL | **owner ou admin** (para configurar o Auth) |

Sobre o acesso ao destino: no AGK nunca tivemos permissão de mexer em
Authentication → URL Configuration, e é por isso que o Site URL ficou preso em
`localhost:3000` até hoje. **Não repetir o erro** — peça ao cliente papel de
owner/admin na org dele antes de começar, ou combine que ele fica junto para
aplicar os passos do §8.

Use a **Session Pooler** (porta `5432`) e não a conexão direta — a direta é
IPv6-only e não fecha da máquina do dev. Formato:

```
postgresql://postgres.<project-ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

A senha está em **Project Settings → Database → Database password** (se ninguém
souber, dá para redefinir ali mesmo — redefinir não derruba nada além de conexões
que usem a senha antiga).

O arquivo `.env.migracao` já existe na raiz (gitignored — o `.gitignore` cobre
`.env*`) com a origem parcialmente preenchida. Falta o `SRC_DB_URL` e todo o
destino:

```
SRC_DB_URL=postgresql://postgres.qqbeoljgpfllhcvqrsup:...@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
SRC_SUPABASE_URL=https://qqbeoljgpfllhcvqrsup.supabase.co
SRC_SERVICE_ROLE_KEY=...

DST_DB_URL=postgresql://postgres.<novo-ref>:...@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
DST_SUPABASE_URL=https://<novo-ref>.supabase.co
DST_SERVICE_ROLE_KEY=...
DST_ANON_KEY=...
```

Ferramentas: `pg_dump`/`psql` **17.x**. Não precisa instalar Postgres — os
binários avulsos resolvem:
`https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip`
(descompactar e usar `pgsql/bin/`). `$PG` daqui pra frente = essa pasta `bin`.

> Na máquina do dev isso **já está feito** (02/09/2026): PostgreSQL 17.6 em
> `C:\Users\henri\pgsql\bin`, com `PG_BIN` apontando para lá no `.env.migracao`.
> O `espelhar.sh` lê essa variável sozinho.

## 1. O projeto destino

Pré-condições, a conferir **antes** de dumpar qualquer coisa:

- **Postgres 17** (mesma major da origem — dump de 17 não restaura em 15).
- Região **`sa-east-1`** (São Paulo). A Vercel roda em `gru1`; região diferente
  soma latência a cada query de cada tela. Se o cliente já criou em `us-east-1`,
  é melhor recriar agora do que descobrir depois.
- Schema `public` **sem tabelas**.
- **Nenhum usuário no Auth.** Se o cliente já criou um admin de teste, apague:
  a restauração de `auth.users` colide em e-mail duplicado.
- Plano com **PITR/backup** compatível com o que o cliente espera.

Se o projeto já existe e está sujo, o §10 tem o procedimento de zerar.

## 2. Inventário da origem (antes de dumpar)

```bash
psql "$SRC_DB_URL" -c "select extname, extversion from pg_extension order by 1"
psql "$SRC_DB_URL" -c "select rolname from pg_roles where rolname not like 'pg\_%' and rolname not in ('postgres','anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_read_only_user','supabase_realtime_admin','dashboard_user','pgbouncer','pgsodium_keyholder','pgsodium_keyiduser','pgtle_admin') order by 1"
psql "$SRC_DB_URL" -f scripts/migrate-project/contagens.sql > origem-contagens.txt
```

O esperado é: extensões só as padrão do Supabase (`pgcrypto`, `uuid-ossp`,
`pg_graphql`, `pgjwt`, `supabase_vault`, `pg_stat_statements`), **nenhum** role
customizado, **nenhum** `pg_cron`/`pg_net` (o cron do sync GSS é da Vercel, não do
banco). Se aparecer algo fora disso, tratar antes de seguir.

## 3. Dumps (origem)

```bash
# schema do public (sem dono e sem grants — os grants são refeitos no passo 5)
$PG/pg_dump "$SRC_DB_URL" --schema=public --schema-only \
  --no-owner --no-privileges --quote-all-identifiers -f 01-schema.sql

# usuários do Auth (preserva uuid, e-mail e hash da senha)
$PG/pg_dump "$SRC_DB_URL" --data-only \
  --table=auth.users --table=auth.identities -f 02-auth.sql

# dados do public (COPY; inclui os setval das sequences)
$PG/pg_dump "$SRC_DB_URL" --schema=public --data-only -f 03-dados.sql
```

Os dumps têm dados pessoais e hashes de senha — deixe-os **fora do repositório**
(pasta temporária) e apague no fim.

O schema `storage` **não** é dumpado de propósito: os arquivos moram no S3, e as
linhas de `storage.objects` são recriadas pelo upload no §7.

## 4. Restauração (destino)

```bash
$PG/psql "$DST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f 01-schema.sql \
  -c 'set session_replication_role = replica' \
  -f 02-auth.sql \
  -f 03-dados.sql
```

`session_replication_role = replica` desliga a checagem de FK e os triggers
durante a carga — é o que permite restaurar na ordem em que o dump saiu (é o
caminho que a própria Supabase documenta) e também o que impede o trigger de
checklist (`trg_orders_seed_checklist`) e o de notificação ao cliente
(`client_notifications`) de dispararem para as 1,5k orders da carga. Como tudo
está numa transação só, qualquer erro reverte por completo.

## 5. Grants e policies que não vêm no dump

Os grants (a RLS deny-all continua protegendo `anon`/`authenticated`; sem os
grants o PostgREST recusa até a `service_role`):

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

## 6. Dívida de migrations

Conferência feita em **02/09/2026** contra a origem (todas as tabelas e colunas
criadas por `supabase/migrations/`, uma a uma, via PostgREST): **falta uma só** —
`shipment_loaded_lines` (migration `20260828120000`, a do split do lote
embarcado). Todo o resto do repo já está aplicado no AGK.

Como o dump copia o que a origem tem, o destino nasce com a mesma falta. **A
virada é a hora certa de zerar essa dívida**, e o espelho é o lugar seguro de
testar a migration antes:

```bash
$PG/psql "$DST_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260828120000_shipment_loaded_lines.sql
```

Revalide o inventário antes de executar (pode ter mudado desde 02/09):

```bash
$PG/psql "$SRC_DB_URL" -c "\d public.shipment_loaded_lines"
```

Depois, registre o histórico no destino para que banco e repo passem a bater:
inserir em `supabase_migrations.schema_migrations` a `version` (o prefixo numérico
do nome do arquivo) de cada migration de `supabase/migrations/`.

## 7. Storage (arquivos)

```bash
npx tsx scripts/migrate-project/copy-storage.ts --dry-run   # confere o inventário
npx tsx scripts/migrate-project/copy-storage.ts             # copia de verdade
```

Cria os buckets no destino com o mesmo nome/visibilidade e copia arquivo por
arquivo. Buckets em uso: `order-documents`, `business-units` (e `order-types`, se
existir). Repetível — usa `upsert`.

## 8. Configuração do projeto destino (dashboard — não vem no dump)

Nada disso está no banco; é config de projeto e precisa ser refeita à mão:

1. **Authentication → URL Configuration**
   - Site URL: `https://sot.gssdatahub.com` (domínio de produção vigente)
   - Redirect URLs: `https://sot.gssdatahub.com/**` + `https://sotwise.vercel.app/**`
     + `http://localhost:3000/**` (necessário para validar o espelho no §9)
   - _Este é o item que está quebrado no projeto antigo. Agora dá para
     consertar — se tivermos o acesso do §0._
2. **Authentication → Providers**: Email ligado; **Confirm email** e signup
   público conforme a origem (o app cria usuário por convite, via Admin API).
3. **Authentication → Emails**: os templates do reset/convite. O envio real é
   pelo Resend (`RESEND_API_KEY`), não pelo SMTP do Supabase.
4. **Project Settings → API**: copiar `anon` e `service_role` do destino para o
   `.env.migracao`.
5. Confirmar região `sa-east-1` e que o **PITR/backup** do plano está ligado.

## 9. Validar o espelho sem colocá-lo em uso

A validação da Fase A é **local**. Crie `.env.espelho` (gitignored) a partir do
`.env.local`, trocando só as 4 variáveis do Supabase pelas do destino.

O Next carrega `.env.local` e **não aceita** `--env-file`, então a troca é por
renomeação — guarde o de produção com outro nome e só depois ponha o espelho no
lugar (nunca sobrescreva o `.env.local` de produção sem backup):

```bash
mv .env.local .env.agk && cp .env.espelho .env.local && npm run dev
# ao terminar: mv .env.agk .env.local
```

Três salvaguardas, para o espelho não virar produção por acidente:

- **Não tocar em env var da Vercel** — nem Production, nem Preview. É o único
  acoplamento que existiria entre o espelho e o mundo real.
- **`RESEND_API_KEY` vazia** no `.env.espelho`: um convite de teste falha em vez
  de mandar e-mail de verdade para um cliente real que está na base copiada.
  Vale igual para as notificações de lote da Fase 2.
- **`CRON_SECRET` vazia**: a rota `/api/cron/sync-gss` responde `503` sem ela, e
  nenhum sync do GSS roda contra o espelho sem alguém pedir explicitamente.

Se depois fizer falta um ambiente compartilhado (para o cliente olhar), o caminho
é um **projeto Vercel separado** (`sotwise-espelho`) com essas mesmas env vars —
nunca as do projeto de produção. Nesse caso, some a URL dele às Redirect URLs do
§8.1.

Roteiro de aceite do espelho:

```bash
psql "$DST_DB_URL" -f scripts/migrate-project/contagens.sql > destino-contagens.txt
diff origem-contagens.txt destino-contagens.txt
```

`storage.objects` pode divergir se a origem tiver linhas órfãs; o resto tem que
bater exatamente. Depois, no app local apontado para o espelho:

- login com uma conta real (a senha antiga tem que valer);
- lista de Orders com dados e um pedido aberto com anexo (valida Storage);
- criar/ler uma mensagem (valida Realtime + `service_role`);
- `/access` abrindo como owner (valida RBAC e `role_features`);
- um Pre-loading e um Shipment abertos (valida checklist e as colunas novas);
- reset de senha por e-mail (valida o Site URL do §8.1 — o link tem que apontar
  para o nosso domínio, não para `localhost` como no AGK).

## 10. Manter o espelho até a virada

O AGK continua recebendo escrita todo dia, então **o espelho envelhece a partir
do minuto seguinte à carga**. A regra é simples e não admite exceção:

> **A origem é a verdade. O espelho é descartável.** Nada é digitado no espelho
> esperando sobreviver — na virada ele é recarregado do zero.

Recarregar = zerar o destino e repetir §3–§7, o que o script faz de uma vez:

```bash
bash scripts/migrate-project/espelhar.sh --wipe
```

O `--wipe` roda, no destino, o equivalente a:

```sql
drop schema public cascade;
create schema public;
delete from auth.identities;
delete from auth.users;
```

(O Storage não precisa ser zerado — o `copy-storage.ts` é upsert.)

Uma recarga leva poucos minutos. A base é pequena — inventário da origem em
02/09/2026: 1.651 orders, 3.216 lotes, 9.867 `order_factory_category`, 16.510
passos de checklist de order, 9.926 de pre-loading, 1.416 pre-loadings, 1.368
shipments, 55 profiles. Faça uma carga agora, para validar, e **outra
imediatamente antes da Fase B** — essa última é a que vale.

---

# Fase B — a virada (só quando o cliente decidir)

## 11. Pré-condições

- [ ] Fase A concluída e o roteiro de aceite do §9 passou.
- [ ] Acesso de owner/admin no projeto do cliente confirmado (§0).
- [ ] Site URL e Redirect URLs corretos (§8.1) — senão todo e-mail sai quebrado.
- [ ] Janela combinada com o cliente: durante a recarga final **ninguém escreve
      no AGK** (o cron do GSS das 9h também não — conferir o horário).
- [ ] Recarga final feita (§10) com a origem já congelada.

## 12. A virada

1. Atualizar `.env.local` (4 variáveis) para o destino.
2. Vercel → Settings → Environment Variables (**Production e Preview**):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`. As demais (`RESEND_*`, `GSS_*`, `CRON_SECRET`,
   `ANTHROPIC_API_KEY`, `API_TOKEN`, `GSS_INBOUND_SECRET`) **não mudam**.
3. **Redeploy** (a Vercel não recarrega env var sem novo deploy).
4. Rodar o roteiro de aceite do §9 de novo, agora em produção.
5. Congelar a origem: pausar o projeto antigo só depois da validação — ele é o
   rollback.

> **Todo mundo é deslogado.** O JWT secret é outro, então as sessões ativas
> morrem e cada usuário precisa entrar de novo. **As senhas continuam valendo**
> (o hash foi junto em `auth.users`).

## 13. Rollback

Reverter as 4 env vars da Vercel para o projeto antigo e redeployar. Como a
origem fica intacta e sem escrita durante a janela, o rollback é imediato — a
única perda é o que tiver sido escrito no destino depois da virada.

## 14. Depois da virada

- Conferir `supabase_migrations.schema_migrations` no destino (§6).
- Apagar os dumps locais (`01-schema.sql`, `02-auth.sql`, `03-dados.sql`), o
  `.env.espelho` e o `.env.migracao`.
- Atualizar as referências ao ref antigo em `.env.example` e `docs/DEPLOY.md`.
- Revogar as chaves do projeto antigo que estiverem circulando.
- Se o AGK ficar de pé como rollback por um tempo, aplicar
  `20260828120000_shipment_loaded_lines.sql` **também nele** — ou aceitar que o
  rollback perde a feature de split.
