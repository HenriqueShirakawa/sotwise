# SOTWISE (SOT)

Sistema operacional de importação da AGK: Orders, lotes, ETD por fábrica,
Pre-Loading, Shipments e o checklist de etapas de cada um. Integra com o GSS
(fonte das orders e dos lotes), com e-mail (Resend) e com WeChat.

- **Produção:** https://sot.gssdatahub.com (branch `main`)
- **Dev:** https://dev.sot.gssdatahub.com (branch `dev`)

Um push em qualquer uma das duas branches faz deploy na Vercel.

## Stack

- Next.js 16 (App Router, Server Actions, `proxy.ts`). **Leia `AGENTS.md`**:
  esta versão tem APIs diferentes das versões anteriores.
- React 19, Tailwind 4, shadcn/ui (Radix), TanStack Table
- Supabase (Postgres + Auth + Storage + Realtime). RLS é deny-all: o app lê
  e grava pelo admin client no servidor, e a autorização fica na DAL
  (`lib/dal.ts`) e em `lib/api-auth.ts`.
- Anthropic SDK (assistente "SIA", `app/api/copilot`)

## Como rodar

Requer Node 22+.

```bash
npm ci
cp .env.example .env.local   # preencha com as chaves do Supabase de dev (AGK)
npm run dev
```

A dev usa o Supabase AGK e **nunca** escreve no GSS (bloqueado em
`lib/gss/client.ts`).

## Scripts

| Comando             | O que faz                                          |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | servidor local                                     |
| `npm run lint`      | ESLint                                             |
| `npm run typecheck` | `tsc --noEmit`                                     |
| `npm test`          | testes unitários (vitest), sem rede nem banco      |
| `npm run test:watch`| testes em modo watch                               |
| `npm run check`     | lint + typecheck + testes (rode antes de push)     |
| `npm run build`     | build de produção                                  |

Os testes ficam ao lado do código (`lib/**/*.test.ts`) e cobrem as regras
puras: rollup de status da Order, conclusão das etapas do checklist, ETD, datas
da API e o payload enviado ao GSS. Regra nova ou corrigida ganha teste junto.

O CI (`.github/workflows/ci.yml`) roda lint, typecheck, testes e build em todo
push na `dev` e na `main` e em pull requests.

## Estrutura

```
app/          rotas (App Router): (auth), (dashboard), (client), api/
components/   UI compartilhada (shadcn em components/ui)
domain/       regras de negócio e contratos da API (OpenAPI, copilot)
lib/          infraestrutura: supabase, gss, email, wechat, dal, api-auth
types/        tipos gerados do banco (database.ts)
supabase/     migrations (aplicadas em ordem; ver abaixo)
scripts/      ferramentas de linha de comando (migração, sync GSS, postman)
miniprogram/  Mini Program do WeChat para fornecedores (outro runtime)
relay/        relay de IP fixo para a API do WeChat
docs/         documentação (regras de negócio, API, integração GSS, deploy)
```

## Banco e migrations

`supabase/migrations/` é a fonte do schema: os scripts de
`scripts/migrate-project/` recriam um banco do zero rodando todas em ordem.
Não apague nem edite uma migration já aplicada; crie uma nova. Uma migration
nova precisa ser aplicada nos dois projetos (dev = AGK, produção = SOT-VISTA)
**antes** do deploy do código que depende dela.

## Documentação

- [`docs/regras_de_negocio.md`](docs/regras_de_negocio.md): fonte de verdade
  das regras; atualize a cada decisão nova
- [`docs/INTEGRACAO_GSS.md`](docs/INTEGRACAO_GSS.md): sync, webhooks e cron do GSS
- [`docs/API.md`](docs/API.md) e `/api/docs` (Swagger) para a API REST
- [`docs/DEPLOY.md`](docs/DEPLOY.md): Vercel, domínios e variáveis
- [`docs/SCHEMA.md`](docs/SCHEMA.md): modelo de dados

## Segurança

O repositório é **público**. Nunca versione `.env*` (exceto `.env.example`),
dumps SQL, planilhas exportadas ou qualquer dado de cliente. Segredos ficam
só na Vercel e no `.env.local`.
