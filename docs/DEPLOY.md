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

Depois disso, todo push na branch `main` re-deploya em produção; cada PR gera um preview.

## 3. Supabase — URL Configuration

No projeto AGK do Supabase → **Authentication → URL Configuration**, adicionar a URL de produção:

- **Site URL:** `https://<seu-app>.vercel.app`
- **Redirect URLs:** `https://<seu-app>.vercel.app/**`

Necessário para o fluxo de reset de senha (`/auth/callback`) redirecionar corretamente.

## 4. CI

`.github/workflows/ci.yml` roda **lint + typecheck + build** em cada push/PR (com env
placeholder — não conecta a nada). Serve de rede de proteção antes do deploy.

## Estado atual (fase 1)

Fundação (auth + shell) + **Registration**: Factories e Clients. Demais módulos são
placeholders. Segurança: RLS deny-all no Supabase; acesso a dados só via `service_role`
server-side atrás da DAL (`lib/dal.ts`). Ver `docs/regras_de_negocio.md` §12.9.
