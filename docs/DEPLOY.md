# Deploy — Sotwise (Vercel + Supabase)

Guia rápido para colocar o app no ar. Hospedagem: **Vercel** (app) + **Supabase** (DB/Auth).

## 1. Variáveis de ambiente

O app precisa destas 4 (mesmos valores do `.env.local`). Configurar no projeto da Vercel
(**Settings → Environment Variables**, escopo **Production** e **Preview**):

| Variável | Onde é usada | Exposta ao browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Auth (login) | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Auth (login) | Sim |
| `SUPABASE_URL` | admin client (server) | Não |
| `SUPABASE_SERVICE_ROLE_KEY` | admin client (server) — acesso a dados | **Não** (nunca com prefixo `NEXT_PUBLIC_`) |

> ⚠️ Se faltar qualquer uma, o `next build` falha. O `SUPABASE_SERVICE_ROLE_KEY`
> é secreto e faz bypass de RLS — só server-side (`lib/supabase/admin.ts` é `server-only`).

## 2. Primeiro deploy

1. Login em vercel.com **com o GitHub** (a Vercel enxerga o repo automaticamente).
2. **Add New… → Project** → importar `HenriqueShirakawa/sotwise` (framework Next.js é detectado).
3. Preencher as 4 variáveis acima na tela de import.
4. **Deploy**. Ao fim, anote a URL (ex.: `https://sotwise.vercel.app`).

> **Produção hoje:** `https://sot.gssdatahub.com`. Ver §2.1.

Depois disso, todo push na branch `main` re-deploya em produção; cada PR gera um preview.

## 2.1. Domínio próprio (`sot.gssdatahub.com`)

O endereço de produção é `https://sot.gssdatahub.com`. O `*.vercel.app` continua
respondendo (a Vercel soma domínios, não substitui), mas é o `sot.` que vai para o
cliente — inclusive porque `*.vercel.app` é bloqueado pelo GFW e o time do cliente
acessa da China; `gssdatahub.com` passa.

O domínio é do cliente e o DNS autoritativo é a **Cloudflare** (conta do GSS, DNS
Setup: Full). Para ligar:

1. Vercel → Project → Settings → **Domains** → Add `sot.gssdatahub.com`. Ela devolve
   o alvo do CNAME (formato novo, `<hash>.vercel-dns-017.com`).
2. Cloudflare → **Add record**: `CNAME` / Name `sot` / Target = o valor da Vercel /
   **Proxy status `DNS only`** (nuvem cinza) / TTL Auto.

⚠️ O proxy da Cloudflare (nuvem laranja) **precisa ficar desligado**: com ele ligado a
Vercel não valida o domínio nem emite o certificado, e o acesso cai em erro 525. Depois
do certificado emitido dá para ligar o proxy, mas só com SSL/TLS em **Full (strict)**.

Registros vizinhos que já existiam na zona e **não** devem ser mexidos: `agk.` (app
Bubble antigo), `api.` e `bi.` (túneis Cloudflare do GSS).


## 3. Supabase — URL Configuration

No projeto AGK do Supabase → **Authentication → URL Configuration**:

- **Site URL:** `https://sot.gssdatahub.com`
- **Redirect URLs:**
  - `https://sot.gssdatahub.com/**`
  - `https://sotwise.vercel.app/**` (endereço legado, ainda ativo)
  - `http://localhost:3000/**` (desenvolvimento)

Necessário para o reset de senha e o convite (`/auth/callback`) redirecionarem
corretamente: o link do e-mail é montado a partir do **Site URL**, então enquanto ele
apontar para outro endereço o e-mail chega quebrado.

> Historicamente **não tivemos permissão** de mexer nesta tela no projeto AGK (é da org
> do cliente) e o Site URL ficou preso em `localhost:3000`. Enquanto isso não for
> corrigido pelo owner, o convite depende do contorno com `hashed_token` descrito em
> `docs/MIGRACAO_SUPABASE_CLIENTE.md`.

## 4. CI

`.github/workflows/ci.yml` roda **lint + typecheck + build** em cada push/PR (com env
placeholder — não conecta a nada). Serve de rede de proteção antes do deploy.

## Estado atual (fase 1)

Fundação (auth + shell) + **Registration**: Factories e Clients. Demais módulos são
placeholders. Segurança: RLS deny-all no Supabase; acesso a dados só via `service_role`
server-side atrás da DAL (`lib/dal.ts`). Ver `docs/regras_de_negocio.md` §12.9.
