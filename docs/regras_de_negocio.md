# Regras de Negócio — Migração Bubble → React + Supabase + Vercel

> **Fonte de verdade** para a reconstrução do sistema **Sotwise** (gestão de logística de importação/exportação).
> Stack alvo: **React** (frontend) · **Supabase** (Postgres + Auth) · **Vercel** (deploy).
>
> Origem das regras: documentação do projeto no Notion ("Documentação Sotwise"), uma página por tela ("Rua").
> Status: 🚧 em construção — preenchido por blocos temáticos.

---

## Índice

1. [Convenções gerais](#1-convenções-gerais)
2. [Visão geral do sistema](#2-visão-geral-do-sistema)
3. [Modelo de dados](#3-modelo-de-dados)
   - 3.1 [profiles (ex-User)](#31-profiles-ex-user)
   - 3.2 [roles (ex-Profile) — papéis de permissão](#32-roles-ex-profile--papéis-de-permissão)
   - 3.3 [role_permissions — matriz CRUD por módulo](#33-role_permissions--matriz-crud-por-módulo)
   - 3.4 [activity_logs — auditoria](#34-activity_logs--auditoria)
   - 3.5 [Cadastros (Registration)](#35-cadastros-registration)
   - 3.7 [Bloco transacional — Orders, lotes, checklist, ETD](#37-bloco-transacional--orders-lotes-checklist-e-etd)
   - 3.9 [Bloco Pre-loading — pre_loadings + checklist](#39-bloco-pre-loading--pre_loadings--checklist)
   - 3.10 [Bloco Shipments — shipments + checklist](#310-bloco-shipments--shipments--checklist)
   - 3.11 [Mapa de relações (Blocos 1–4)](#311-mapa-de-relações-blocos-14)
   - 3.12 [Bloco Auxiliares — Login e To do list](#312-bloco-auxiliares--login-e-to-do-list)
4. [Sistema de permissões (RBAC)](#4-sistema-de-permissões-rbac)
5. [Fluxos de negócio](#5-fluxos-de-negócio) _(em construção)_
6. [Integrações externas](#6-integrações-externas) _(pendente)_
7. [Controle de acesso — a validar com o cliente](#7-controle-de-acesso--a-validar-com-o-cliente)
8. [Decisões pendentes do cliente](#8-decisões-pendentes-do-cliente)
9. [Stack técnica](#9-stack-técnica)
10. [Versionamento (GitHub)](#10-versionamento-github)
11. [Requisitos de Segurança](#11-requisitos-de-segurança)
12. [Log de implementação — Supabase](#12-log-de-implementação--supabase)

---

## 1. Convenções gerais

Regras que valem para todas as tabelas, para não repetir em cada uma.

- **Chaves primárias:** `uuid` gerado por `gen_random_uuid()`. Substitui o ID automático do Bubble.
- **Campos de sistema** (equivalentes aos built-in do Bubble), presentes em toda tabela:
  - `created_at timestamptz not null default now()` — ex-`Created Date`
  - `updated_at timestamptz not null default now()` — ex-`Modified Date`, atualizado por trigger
  - `created_by uuid references public.profiles(id)` — ex-`Creator` (quando aplicável)
- **Nomenclatura:** tabelas e colunas em `snake_case` minúsculo. Ex.: `Date of birth` → `date_of_birth`.
- **Idioma:** a **interface é 100% em inglês** (regra recorrente na doc). Nomes de tabela/coluna em inglês; comentários e este MD em PT.
- **Sem exclusão física (soft delete global):** o padrão do sistema é **nunca apagar de verdade**. Usuários e papéis usam status Active/Blocked; **todos os cadastros (Registration) usam soft delete** — "excluir" marca o registro como inativo. Convenção: coluna `deleted_at timestamptz` (NULL = ativo; preenchido = excluído). Registros soft-deleted **somem das listagens** mas continuam visíveis em registros antigos que já os referenciam (histórico preservado). Nunca usar `DELETE` físico em tabelas de negócio.
- **Auth vs. Perfil:** o Supabase separa credenciais (`auth.users`, gerenciado) dos dados de negócio (`public.profiles`). Nunca duplicar email/senha em tabelas próprias.
- **Trigger de `updated_at`:** função compartilhada `set_updated_at()` aplicada a todas as tabelas.
- **Rastreio de origem (migração):** enquanto a migração do Bubble estiver em andamento, toda tabela de negócio tem uma coluna `bubble_id text` (nullable, com índice único parcial) que guarda o `_id` original do registro no Bubble — usada para resolver FKs, permitir upsert idempotente e auditar/reconciliar. Ver [seção 12](#12-log-de-implementação--supabase). Pode ser removida ao final da migração.
- ⚠️ **Fonte de verdade: Bubble > Figma.** O **Bubble em produção** é a referência real de regra de negócio, campos e comportamento. O **Figma é apenas protótipo visual** — contém dados mockados, colunas que não existem, textos genéricos reaproveitados e typos. Sempre que houver divergência, **vale o Bubble**. Prints do Figma servem para entender intenção de layout, não para derivar schema.

---

## 2. Visão geral do sistema

**Sotwise** é um sistema interno de **gestão de logística de importação/exportação**. Fluxo central:

- **Orders** (pedidos) — com lotes (Batch No.) e uma timeline de etapas obrigatórias (Order progress / checklist).
- **Pre-loading** e **Shipments** (embarques) — portos de origem/destino, ETD, seal/PL, exportação XLS.
- **Registration** (cadastros de apoio) — Factories, Carriers, Clients, Exporters, Countries, Cities, POLs, PODs, Categories, Agents, Business Unit, Order Type, entre outros. Inclui lógica de **Factory × Category**.
- **Users / Profile / Meu Perfil** — autenticação e o sistema de permissões (RBAC).
- **Auxiliares** — To do list, ETD Factories, Reports.

Blocos de documentação (ordem de trabalho):
1. ✅ **Auth & Perfil** — Users, Profile, Meu Perfil _(documentado)_
2. ✅ **Cadastros** (Registration) — 12 cadastros + Contacts _(documentado)_
3. ✅ **Orders** — pedidos, lotes, checklist, ETD _(documentado)_
4. ✅ **Pre-loading & Shipments** — Pre-loading (3.9) e Shipments (3.10) documentados; falta detalhar o checklist de Shipments
5. ✅ **Auxiliares** — Login (3.12.1) e To do list (3.12.2) documentados

---

## 3. Modelo de dados

### 3.1 profiles (ex-User)

**Origem Bubble:** Data Type `User`. **Telas:** Rua Users, Rua Meu Perfil.
**Descrição:** usuários do sistema. Login por e-mail + senha (convite por e-mail define a senha). Cada `auth.users` tem um `profile` 1:1. **Não há exclusão** — controle de acesso por status Active/Blocked.

#### Mapeamento de campos

| Campo Bubble | Coluna Supabase | Tipo | Regra / Observação |
|---|---|---|---|
| _(ID Bubble)_ | `id` | `uuid` PK | Igual ao `auth.users.id`. Vem do auth, não gerado aqui. |
| E-mail | — | — | Vive em `auth.users.email`. **Não** replicado. Obrigatório; **não editável** pelo usuário. |
| Full name | `full_name` | `text` | Obrigatório. Editável pelo próprio usuário em Meu Perfil. |
| Date of birth | `date_of_birth` | `date` | Opcional. Editável em Meu Perfil. |
| Profile | `role_id` | `uuid` FK → `roles.id` | **Obrigatório.** Papel de permissão do usuário (ver 3.2). Era o `user_profile` do print. |
| Company | `company` | `company_type` (enum) | **Obrigatório.** Option set de 2 valores: **BR / China**. Ver enum abaixo. Possível eixo de segregação de dados (ver seção 7). |
| Status | `status` | `user_status` (enum) | Active / Blocked. Bloqueado **não consegue logar**. Substitui `IsDisabled`. |
| hidden | `hidden` | `boolean` | ✅ **Em uso** (não é legado). Oculta o usuário de listagens, mas ele continua funcional. Distinto de `status` (que bloqueia login). Default: false. |
| ~~profile~~ (texto) | — | — | ⚠️ **Provável legado.** Não aparece na doc funcional. Confirmar antes de descartar. |
| ~~Conversion?~~ | — | — | ⚠️ Não aparece na doc funcional. Confirmar se é usado. |
| ~~master~~ | — | — | ❌ **Descartado.** Substituído pelo RBAC (ver seção 4). "Admin" = um `role` com todas as permissões. |
| ~~Slug~~ | `slug` | `text` | Manter se houver URL amigável de usuário; senão, legado. Confirmar. |
| Created Date | `created_at` | `timestamptz` | Ver convenções. |
| Modified Date | `updated_at` | `timestamptz` | Ver convenções. |

#### Regras específicas (da doc)

- **Criação (tela Users):** admin cria com Full name, Date of birth, E-mail, Profile, Company. Sistema envia **convite por e-mail** (sem senha inicial). Toast: "User created successfully!".
- **Sem senha no cadastro:** senha é definida pelo usuário via convite. **Troca de senha** só existe no fluxo de Login (não em Meu Perfil).
- **Convite (decisão 2026-08-13, revista):** o app **não usa o SMTP do Supabase** — o "Custom SMTP" do painel é restrito a Owner/Admin da org (Vista/pub) e ficou bloqueado. Em vez disso, a criação (`createUserRecord`) usa `admin.auth.admin.generateLink({ type: "invite" })`, que **cria o usuário e emite o link sem enviar nada**, e o e-mail é despachado pela **API do Resend** (`lib/email/resend.ts` + template em `lib/email/invite.ts`). O link aponta para `{origin}/auth/callback?token_hash=<hashed_token>&type=invite&next=/update-password` — o callback (`app/auth/callback/route.ts`) valida via `verifyOtp`. Se o envio falhar, faz rollback (`deleteUser`, com cascade no profile). Enquanto o usuário não define a senha (`last_sign_in_at` nulo), a lista o mostra como **Pending**. Reenvio hoje é o "Forgot password" da tela de login.
  - **Envio validado 2026-08-13** com `EMAIL_FROM=onboarding@resend.dev` (domínio de teste do Resend): `last_event: delivered` no Gmail. ⚠️ O domínio de teste **só entrega para o e-mail dono da conta Resend** e tende a cair em spam.
  - **Config ainda necessária:**
    1. **Env** `RESEND_API_KEY` + `EMAIL_FROM` no `.env.local` **e na Vercel** (senão em prod não envia).
    2. **Site URL + Redirect URLs** (Supabase → Auth → URL Configuration) com o domínio de produção (estavam em `localhost:3000`) — o `generateLink` usa o `origin` da requisição, mas o Supabase valida o redirect.
    3. **Domínio próprio verificado no Resend** (DKIM/SPF no DNS) e `EMAIL_FROM` apontando para ele — pré-requisito para entregar a usuários reais (fora o dono da conta) e sair do spam.
  - Os templates nativos do Supabase ("Invite user" etc.) **não são mais usados** para o convite, já que o e-mail é montado no app.
- **Bloqueio:** `status = Blocked` impede login. Reset de senha e bloqueio/desbloqueio exigem **modal de confirmação**. ✅ **Confirmado:** o bloqueio tem **efeito imediato** — o usuário perde o acesso na hora, com a **sessão ativa encerrada**, não apenas o próximo login negado. ⚠️ Implicação técnica: exige verificação do `status` a cada request (middleware/API route) ou revogação ativa da sessão no Supabase Auth — checar apenas no login é insuficiente.
- **Ação em massa:** a lista permite selecionar vários usuários (checkbox) e aplicar ação em lote.
- **Meu Perfil:** usuário edita **apenas** `full_name` e `date_of_birth`. E-mail e papel são **somente leitura**.
- **Acesso à tela Users:** restrito a quem tem permissão **Access** no módulo Users (ver seção 4). Não é um flag especial.

#### SQL

```sql
create type public.company_type as enum ('BR', 'China');
create type public.user_status  as enum ('active', 'blocked');

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  date_of_birth  date,
  role_id        uuid not null references public.roles(id),
  company        public.company_type not null,
  status         public.user_status  not null default 'active',
  hidden         boolean not null default false,   -- oculta de listagens (não bloqueia login)
  slug           text unique,              -- manter só se houver URL amigável; senão remover
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_profiles_role_id on public.profiles(role_id);
create index idx_profiles_company on public.profiles(company);
create index idx_profiles_status  on public.profiles(status);

-- Função compartilhada de updated_at (definida uma vez, usada por todas as tabelas)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria profile automaticamente ao registrar usuário no auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

> ⚠️ Nota de migração: o trigger acima cria o profile com `full_name` vazio e sem `role_id`/`company` (que são `not null`). No fluxo real, a criação vem da **tela Users** (admin informa tudo), então a criação do profile deve acontecer ali, com os campos preenchidos — não via auto-trigger. Reavaliar o trigger quando desenharmos o fluxo de convite. Deixado aqui como referência.

---

### 3.2 roles (ex-Profile) — papéis de permissão

**Origem Bubble:** Data Type `Profile`. **Tela:** Rua Profile.
**Descrição:** os **papéis de permissão** do sistema (ex.: Administrator, User BR). Cada papel tem um nome e uma **matriz de permissões por módulo** (ver 3.3). "Admin" não é um campo — é um papel com todas as permissões marcadas. Sem exclusão; controle por status.

> ⚠️ Renomeado de `Profile` para `roles` para evitar a confusão histórica com a tabela `profiles` (usuários). Ajuste de clareza na migração.

| Campo Bubble | Coluna Supabase | Tipo | Regra / Observação |
|---|---|---|---|
| Profile (nome) | `name` | `text` | Obrigatório. Único. Ex.: Administrator, User BR. |
| Permissões | _(tabela `role_permissions`)_ | — | Matriz por módulo. Normalizada em tabela separada (3.3). |
| Permissions (tipo) | _(derivado)_ | — | Rótulo Admin/User na lista. **Derivado**: "Admin" = tem todas as permissões. Não é coluna. |
| ~~Status~~ | — | — | ❌ **Removido.** O status Active/Blocked de perfil **não é usado** no sistema. Confirmado com o cliente. |

```sql
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();
```

#### 3.2.1 Papel `client` — usuário externo (implementado 2026-08-19)

Quarto papel, ao lado de `owner`/`admin`/`user`, e o único que **não é interno**: é o
contato do cliente da AGK, que entra para acompanhar os próprios pedidos. Migration
`20260819120000_client_role_and_scope.sql`.

- **Não recebe nenhuma linha em `role_features`.** A ausência é a regra: como o RBAC é
  fail closed, todo `requireFeature()` nega, e o cliente é devolvido ao portal. As
  features do catálogo são todas telas internas — não existe subconjunto delas que faça
  sentido para quem é de fora.
- **`profiles.client_id`** (FK → `clients`, nullable) é a fronteira de dados: um usuário
  pertence a **um** cliente, um cliente tem **N** usuários. Todos os usuários do mesmo
  cliente enxergam **todos** os pedidos daquele cliente (decisão 7 da Fase 2). `company`
  (BR/China) **não** se aplica ao externo — quem recorta é o `client_id`.
- **Obrigatoriedade cruzada** (papel `client` ⇒ `client_id` preenchido; papel interno ⇒
  `client_id` null) não é CHECK: o nome do papel mora em `roles` e CHECK não faz
  subquery. Fica em `resolveRoleScope()` (`app/(dashboard)/users/actions.ts`) na
  escrita, e em `requireClientScope()` (`lib/dal.ts`) na leitura — que **encerra a
  sessão** de um cliente sem vínculo em vez de deixá-lo entrar sem escopo.
- **Convite:** mesmo fluxo do 3.1 (admin cria pela tela Users, Resend entrega o link),
  com seletor de Client no formulário e um texto de e-mail próprio — o externo não foi
  "convidado para o SOTWISE", foi convidado para acompanhar os pedidos da empresa dele.
- **Portal:** route group `app/(client)/`, rota `/portal`, casca própria (sem sidebar,
  sem mensagens, sem copilot). Login, `/` e todo `requireFeature` negado levam o cliente
  para lá; `requireInternal()` faz o caminho inverso nas telas internas sem feature
  própria (`/profile`, preferências, mensagens).
- **Onde se vê o vínculo:** na tela Users (coluna Profile mostra `Client · <empresa>`) e
  na tela Clients, coluna **Portal users** — os usuários externos daquele cliente, com
  bloqueado riscado. A busca de Clients passou a casar com nome de usuário também
  ("de que cliente é a Fernanda?"). Não existe campo "contato do cliente" em `clients`:
  o contato **é** o usuário.
- **O que o portal mostra:** número do pedido, referência do cliente, tipo, status e a
  contagem de itens por estágio. Fora: fábrica, exporter, leader/requester, BU, número
  de lote (o cliente acompanha produto) e datas de ETD (expor estimativa a terceiro é
  decisão de negócio ainda não tomada). Pedido `in_negotiation` não aparece; `canceled`
  aparece.

---

### 3.3 role_permissions — matriz CRUD por módulo ⚠️ NÃO USADA NESTA FASE

> ⚠️ **Decisão: esta tabela NÃO será implementada nesta fase.** O RBAC foi simplificado para dois papéis (`admin` / `user`) — ver seção 4. A modelagem abaixo fica documentada como **referência para uma evolução futura**, caso o cliente venha a exigir permissões granulares por módulo. A lista de módulos (que estava travada em standby) deixa de ser um bloqueio.

**Origem:** a "matriz de permissões" da Rua Profile (checkboxes Access/Create/Edit/Delete por módulo).
**Descrição:** normaliza a matriz. Uma linha por (papel × módulo), com 4 booleans. Alternativa a espalhar dezenas de colunas no `roles`.

Regras da doc:
- Ações por módulo: **Access / Create / Edit / Delete**. **Shipments não tem Create.**
- O checkbox do módulo (grupo) marca/desmarca as 4 ações de uma vez.
- Admin = todas as ações de todos os módulos = `true`.
- ⚠️ **Lista completa de módulos ainda não confirmada** (ver seção 8). Enum abaixo é rascunho.

```sql
-- Rascunho — completar a lista de módulos (ver seção 8)
create type public.app_module as enum (
  'orders', 'shipments', 'pre_loading', 'etd', 'todo_list',
  'agents', 'business_unit', 'clients', 'exporters', 'factories',
  'carriers', 'categories', 'countries', 'cities', 'pols', 'pods',
  'order_type', 'users', 'roles'
);

create table public.role_permissions (
  role_id    uuid not null references public.roles(id) on delete cascade,
  module     public.app_module not null,
  can_access boolean not null default false,
  can_create boolean not null default false,
  can_edit   boolean not null default false,
  can_delete boolean not null default false,
  primary key (role_id, module)
);
```

> Nota: `can_create` fica sempre `false` para o módulo `shipments` (regra de UI: Shipments sem Create). Pode ser reforçado por constraint quando confirmado.

---

### 3.4 activity_logs — auditoria

**Origem:** "Activity history" (Rua Meu Perfil) + histórico mencionado na Rua Users.
**Descrição:** registro das ações dos usuários, exibido com filtro de período ("Last 7 days", "View more").

> ⚠️ Entidade **inferida** da doc — não há Data Type explícito documentado ainda. Estrutura abaixo é uma proposta a validar quando mapearmos o que exatamente é logado.

| Campo | Coluna | Tipo | Observação |
|---|---|---|---|
| Usuário | `user_id` | uuid FK → profiles | De quem é a ação. |
| Ação | `action` | text | Ex.: "created order", "blocked user". Vocabulário a definir. |
| Entidade | `entity_type` / `entity_id` | text / uuid | Alvo da ação (opcional). |
| Data | `created_at` | timestamptz | Base do filtro por período. |

```sql
create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index idx_activity_logs_user_created on public.activity_logs(user_id, created_at desc);
```

---

### 3.5 Cadastros (Registration)

**Origem Bubble:** vários Data Types de apoio. **Telas:** Rua Registration - *.
**Descrição:** cadastros de referência que alimentam Orders/Shipments. Padrão CRUD uniforme entre eles.

**Regras comuns a todos os cadastros (da doc):**
- CRUD simples; **paginação de 10 por página**; busca por nome; estados com dados / vazio (Empty) / carregando.
- Create/Edit em **drawer**; excluir via **popup de confirmação**.
- **Soft delete** (ver convenções): "excluir" marca `deleted_at`, não apaga.
- **Fora do RBAC:** cadastros são livres para **qualquer usuário autenticado** (não entram na matriz de permissões da seção 4). Confirmado com o cliente.
- Interface 100% em inglês.

> Nota: como estão fora do RBAC e várias telas mencionavam "Profile Filters a confirmar", isso fica **resolvido**: não há filtro por perfil nos cadastros.

#### 3.5.1 factories

Fábrica de origem da mercadoria. **Único campo: o nome.** O Create permite adicionar **várias de uma vez** (nome → "Add" → lista → "Create").

```sql
create table public.factories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  deleted_at  timestamptz,               -- soft delete
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_factories_updated_at
  before update on public.factories
  for each row execute function public.set_updated_at();
```

#### 3.5.2 categories + category_factories

Categoria que classifica os pedidos. Tem nome + **lista de fábricas vinculadas** (obrigatório ≥ 1). A combinação **Factory × Category** é o "nível atômico de controle" (Orders, lotes, checklists penduram nela).

✅ **Cardinalidade M-para-N — CONFIRMADA (2026-08-19).** Uma categoria pode estar em várias fábricas e uma fábrica em várias categorias. Confirmado pelo cliente e pelos dados do GSS, onde `SupplierCategory` é junção de verdade (com `city` + `code` a mais, que não modelamos) — ver [INTEGRACAO_GSS §3](INTEGRACAO_GSS.md). Segue como tabela de junção; a hipótese antiga de migrar `category_id` para dentro de `factories` está **descartada**.

**Tela construída em 2026-08-19** (`/registration/categories`) — era uma das três bibliotecas sem UI; `cities` (3.5.7) e `exporters` (3.5.6) ganharam a sua no mesmo dia, então **todas as bibliotecas têm tela agora**. Nome + multi-select de fábricas, busca também pelo nome da fábrica ("que categorias a Dajin atende?"), soft delete que **não** apaga a junção — pedido antigo continua íntegro. A regra ≥ 1 fábrica é imposta no `categoryFormSchema`; o `POST /api/categories` segue aceitando `{ name }` sem vínculo para não quebrar o contrato de quem já chama a API (o `factory_ids` lá é opcional).

```sql
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- Junção M-N Factory × Category (validar cardinalidade no merge)
create table public.category_factories (
  category_id uuid not null references public.categories(id) on delete cascade,
  factory_id  uuid not null references public.factories(id) on delete cascade,
  primary key (category_id, factory_id)
);
```

> Regra de UI: vincular ao menos uma fábrica é obrigatório ao criar/editar categoria. Reforçar na aplicação (o banco não impõe "≥1" sozinho).

#### 3.5.3 contacts

Contatos avulsos (nome, e-mail, telefone). **Sem dono** — é uma lista simples, vinculável a partir de Agents (e potencialmente Clients/Exporters). Todos os campos obrigatórios, **exceto e-mail que aceita "N/A"** (quando não há e-mail). Tem export XLS.

```sql
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,                      -- NULL = "N/A" (sem e-mail)
  email_na      boolean not null default false,  -- marca explícita de "N/A"
  phone_number  text not null,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);
create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();
```

#### 3.5.4 agents + agent_contacts

Agente de logística. Nome, país (FK Countries), e-mail (com "N/D"/N/A), telefone, e **contatos vinculados** (M-N com `contacts`). Tem filtros e export XLS.

✅ **Pendência resolvida (Bloco 4 — Pre-loading):** não existe um campo "tipo" próprio no sentido antigo. Os campos **"Agent Brazil"** e **"Agent China"** do Pre-loading são o **mesmo cadastro `agents`**, filtrados por um campo **"local"** que é um **option set** (enum), definido no cadastro do agente — **distinto do `country_id`**. Modelado abaixo como `location`.

⚠️ **Relação `carriers ↔ agents` — confirmada.** O campo "Carrier agent" do Pre-loading é filtrado pelos agentes selecionados porque a tabela **`carriers`** carrega o vínculo com `agents` (ver 3.5.8).

```sql
-- Option set do "local" do agente (usado no filtro Agent Brazil / Agent China do Pre-loading)
create type public.agent_location as enum ('brazil', 'china');   -- ⚠️ confirmar valores completos

create table public.agents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  country_id    uuid references public.countries(id),
  location      public.agent_location,          -- option set; base do filtro Agent Brazil/China
  email         text,
  email_na      boolean not null default false,
  phone_number  text,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id)
);
create trigger trg_agents_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

-- Contatos vinculados ao agente (M-N)
create table public.agent_contacts (
  agent_id    uuid not null references public.agents(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  primary key (agent_id, contact_id)
);
```

#### 3.5.5 clients

Cliente que faz os pedidos. Nome + país (FK Countries, obrigatório). A lista exibe **contadores de pedidos por status** (total / in negotiation / in production / shipped / delivered / canceled) — derivados de Orders. ⚠️ Estratégia dos contadores **a decidir no Bloco 3** (ver seção 8).

```sql
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  country_id  uuid not null references public.countries(id),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();
```

#### 3.5.6 exporters

Empresa exportadora. Nome + **sigla (acronym)**, ambos obrigatórios.

**Tela construída em 2026-08-19** (`/registration/exporters`). CRUD com checagem de nome duplicado (mesma do simple-crud — a lição do "Chongqing 4x" no POL) e soft delete. A sigla aparece como badge porque é ela que a lista de Orders mostra na coluna Exporter (`acronym || name`). São 4 exporters em produção.

```sql
create table public.exporters (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  acronym     text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_exporters_updated_at
  before update on public.exporters
  for each row execute function public.set_updated_at();
```

#### 3.5.7 countries, cities, pols, pods (geografia)

Hierarquia geográfica: **Country → City → POL** (cada cidade agrupa POLs), e **POD** separado (porto de destino). Countries já vem pré-populado.

- `countries`: só nome. Usado por Clients, Agents, Cities.
- `cities`: nome + **POLs vinculados** (não obrigatório). Relação City→POL.
- `pols` (Ports of Loading): só nome (porto de embarque).
- `pods` (Ports of Discharge): só nome (porto de destino).

**Tela de Cities construída em 2026-08-19** (`/registration/cities`) — cadastro name-only, no molde de POL/POD/Countries, com criação em lote. 652 cidades em produção.

⚠️ **O vínculo `city_pols` não é editável pela tela, de propósito.** Hoje ele é só LIDO (o detalhe do Pre-loading usa a cidade para distinguir dois POLs de mesmo nome — ver `app/(dashboard)/pre-loading/[id]/page.tsx`), e `cities` é uma das 14 bibliotecas que o GSS passa a ser dono. Abrir escrita do vínculo aqui criaria um segundo dono do mesmo dado justamente às vésperas de a integração assumi-lo. Se o vínculo precisar ser mantido à mão antes da Fase 5, é decisão a tomar — não um esquecimento.

```sql
create table public.countries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_countries_updated_at before update on public.countries
  for each row execute function public.set_updated_at();

create table public.pols (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_pols_updated_at before update on public.pols
  for each row execute function public.set_updated_at();

create table public.pods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_pods_updated_at before update on public.pods
  for each row execute function public.set_updated_at();

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_cities_updated_at before update on public.cities
  for each row execute function public.set_updated_at();

-- Cidade agrupa POLs (M-N; validar se um POL pode estar em várias cidades)
create table public.city_pols (
  city_id uuid not null references public.cities(id) on delete cascade,
  pol_id  uuid not null references public.pols(id) on delete cascade,
  primary key (city_id, pol_id)
);
```

#### 3.5.8 carriers

Transportadora/armadora. Só nome. Criação em lote (Add vários).

✅ **Vínculo com `agents` — confirmado (Bloco 4).** A tabela `carriers` **carrega a relação com agentes**: é isso que permite ao Pre-loading filtrar o campo "Carrier agent" com base nos agentes já selecionados. ⚠️ A cardinalidade exata (um carrier tem N agentes? M-N?) precisa ser confirmada no merge do banco do Bubble — modelada abaixo como M-N por segurança.

```sql
create table public.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create trigger trg_carriers_updated_at before update on public.carriers
  for each row execute function public.set_updated_at();

-- Vínculo carrier ↔ agent (base do filtro "Carrier agent" no Pre-loading)
-- ⚠️ cardinalidade a confirmar no merge do banco (pode ser 1-N em vez de M-N)
create table public.carrier_agents (
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  agent_id   uuid not null references public.agents(id) on delete cascade,
  primary key (carrier_id, agent_id)
);
```

#### 3.5.9 business_units

Unidade de negócio (Moto, Agro, HA, Sports, Auto, Other). Nome + **imagem obrigatória** (ícone). **Não tem status/soft delete na doc** — mas mantemos `deleted_at` por consistência (confirmar). Imagem vai para **Supabase Storage** (bucket `business-units`), guardando só o path.

```sql
create table public.business_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon_path   text not null,             -- path no bucket 'business-units' do Supabase Storage
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_business_units_updated_at before update on public.business_units
  for each row execute function public.set_updated_at();
```

#### 3.5.10 order_types

Tipo de pedido (Gift, Exchange, Samples, Sales). Nome + **ícone SVG** + **cor** (para o chip "Type" em Orders). Ícone vai para Supabase Storage (bucket `order-types`); cor guardada como texto (hex ou nome da paleta).

```sql
create table public.order_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon_path   text not null,             -- SVG no bucket 'order-types'
  color       text not null,             -- cor da tag (hex ou token da paleta)
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_order_types_updated_at before update on public.order_types
  for each row execute function public.set_updated_at();
```

> **Supabase Storage (uploads):** Business Unit (imagem) e Order Type (ícone SVG) usam buckets do Supabase Storage. Padrão: guardar apenas o `path` na tabela; servir via URL assinada ou bucket público conforme sensibilidade. Confirmado com o cliente. Limites da doc para BU: .png/.jpeg/.svg, ≤5MB, 1 imagem.

#### 3.5.11 shipment_models

Modelo/modal de embarque. Alimenta o campo **"Ship Model" / "Shipment Model"** de Shipments. Valores observados no Bubble: **Courier, Air, Hand Carrier, FCL** (provavelmente também LCL — confirmar lista completa).

```sql
create table public.shipment_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create trigger trg_shipment_models_updated_at before update on public.shipment_models
  for each row execute function public.set_updated_at();
```

⚠️ Card "Documentação - Rua Registration - Shipment Models" ainda não revisado em detalhe — confirmar se tem campos além do nome.

---

---

### 3.7 Bloco transacional — Orders, lotes, checklist e ETD

**Origem Bubble:** `[Vistapub] Order`, `CheckList` / `CheckList x Item`, `List of Factories x Categories x Lote`, dados de ETD. **Telas:** Rua Orders, Rua Orders - Checklist, Rua ETD Factories.
**Descrição:** o núcleo do sistema. Um **pedido (Order)** é criado, recebe **entradas de fábrica×categoria×lote**, e progride por uma **timeline de etapas obrigatórias (checklist)** até ser entregue. O status do pedido é **derivado** dos lotes, não editado diretamente.

#### Visão geral do fluxo

```
Order (pedido, PO auto)
  ├── order_factory_category (N entradas: Category + Factory + Batch + Ship requirement)
  │        └── etd_info (1:1 — dados de ETD da entrada) ──< etd_history (log)
  ├── order_checklist_steps (N — estado de cada etapa FIXA do progresso)
  │        └── step_attachments (documentos anexos por etapa)
  └── status = rollup dos lotes (override manual só p/ in_negotiation/in_production/canceled; ver 3.7.1)
```

#### 3.7.1 orders

Pedido. PO gerado automaticamente e **não editável**. Exclusão: a doc atual diz "irreversível / cannot be undone" — ⚠️ mas isso **contradiz nossa política global de soft delete**. Ver pendência abaixo.

| Campo Bubble | Coluna | Tipo | Regra |
|---|---|---|---|
| Order number (PO) | `po_number` | text/serial | **Auto-gerado, não editável.** Único. Formato a confirmar. |
| Order type | `order_type_id` | uuid FK → order_types | Classifica o pedido. |
| Schedule requested | `schedule_requested` | date | Data solicitada. |
| ASAP? | `asap` | boolean | Urgência. ⚠️ Efeito sobre schedule a confirmar. |
| Client | `client_id` | uuid FK → clients | Cliente. |
| Client reference | `client_reference` | text | Referência do cliente. |
| Business unit | `business_unit_id` | uuid FK → business_units | Unidade de negócio. |
| Requester | `requester_id` | uuid FK → profiles | Quem solicitou. |
| Exporter | `exporter_id` | uuid FK → exporters | Exportador. |
| Leader | `leader_id` | uuid FK → profiles | Líder/responsável. ⚠️ Doc confirma que é pessoa (User), apesar do placeholder "Select factory" no design. |
| Status | `status` | `order_status` (enum) | **Rollup dos lotes**, com override manual limitado (ver regra abaixo). Editável à mão apenas para `in_negotiation` / `in_production` / `canceled`; os demais vêm do rollup automático. |
| Date PO | `date_po` | date | Data do pedido (qual data exatamente: a confirmar). |

```sql
-- Status da ORDER (rollup dos lotes — ver regra de cálculo logo abaixo)
-- Confirmado com o cliente via planilha "StatusSOT": Order tem enum PRÓPRIO,
-- distinto do enum de status do Batch (não é 1:1 com o lote).
create type public.order_status as enum (
  'in_negotiation',        -- gatilho: criação da Order
  'in_production',         -- TODOS os lotes em produção (+ etapas Order/PO/PI/deposit payment completas)
  'partially_preloading',  -- ao menos 1 lote em pré-carga, os outros ainda não
  'pre_loading',           -- TODOS os lotes em pré-carga
  'partially_shipped',     -- ao menos 1 lote embarcado, os outros ainda não
  'shipped',               -- TODOS os lotes em trânsito
  'partially_delivered',   -- ao menos 1 lote entregue, os outros ainda não
  'delivered',             -- TODOS os lotes entregues
  'canceled'               -- ver regra de cancelamento em batches
);
-- `partially_preloading` e `pre_loading` entraram depois do schema inicial:
-- ver supabase/migrations/20260805120000_order_status_preloading.sql.

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  po_number          text not null unique,       -- auto-gerado
  order_type_id      uuid references public.order_types(id),
  schedule_requested date,
  asap               boolean not null default false,
  client_id          uuid references public.clients(id),
  client_reference   text,
  business_unit_id   uuid references public.business_units(id),
  requester_id       uuid references public.profiles(id),
  exporter_id        uuid references public.exporters(id),
  leader_id          uuid references public.profiles(id),
  status             public.order_status not null default 'in_negotiation',
  date_po            date,
  deleted_at         timestamptz,                -- ver pendência: hard vs soft delete
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id)
);
create trigger trg_orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
```

> ✅ **Status derivado — regra confirmada com o cliente (planilha "StatusSOT"):** `status` não é gravado manualmente. É calculado a partir do conjunto de status dos `batches` da Order, com a seguinte precedência:
>
> | Status da Order | Condição sobre os lotes |
> |---|---|
> | `in_negotiation` | Estado inicial, ao criar a Order — e enquanto os lotes não estiverem **todos** em produção |
> | `in_production` | **Todos** os lotes em `in_production` (e etapas Order/PO/PI/deposit payment completas — deposit payment pode estar "NA" em casos específicos) |
> | `partially_preloading` | Ao menos 1 lote em `preloading` e os demais fora dessa fase |
> | `pre_loading` | **Todos** os lotes em `preloading` |
> | `partially_shipped` | Ao menos 1 lote em `in_transit` e os demais ainda não |
> | `shipped` | **Todos** os lotes em `in_transit` |
> | `partially_delivered` | Ao menos 1 lote em `delivered` e os demais ainda não |
> | `delivered` | **Todos** os lotes em `delivered` |
> | `canceled` | Ver regra de cancelamento em `batches` — usuário devolveu todos os lotes para `in_negotiation`/`in_production` e a Order é cancelada a partir daí |
>
> A avaliação é da fase **mais adiantada para a mais atrasada** (delivered →
> in_transit → preloading → produção): um lote entregue decide o status antes de
> um lote que ainda está em produção. Implementação: `rollupOrderStatus()` em
> `lib/order-status.ts`, chamada por `syncOrderStatus()` em todo ponto que muda
> o status ou o conjunto de lotes de uma Order.
>
> Implementação: coluna materializada em `orders.status`, recalculada por trigger sempre que um `batches.status` mudar (ou via função chamada no fim de cada transição de lote). `pre_loading` do batch **não aparece named diretamente** no status da Order — ele só conta como "ainda em produção" até virar `in_transit`.
>
> ⚠️ **Override manual (confirmado nos prints de produção — tela Edit order):** o rollup acima é o comportamento automático, mas a tela de **edição do pedido** expõe um dropdown de Status que permite ao usuário definir manualmente **apenas 3 valores**: `in_negotiation`, `in_production` e `canceled` — as fases **anteriores ao embarque**, que são decisão humana/comercial. Os demais status (`partially_shipped`, `shipped`, `partially_delivered`, `delivered`) **não são editáveis à mão** — só o rollup os atribui, conforme os lotes progridem no fluxo de Pre-loading/Shipment. Ou seja: **manual até In Production; automático dali em diante.** A criação (Create order) não expõe status — nasce sempre `in_negotiation`.

#### 3.7.2 batches (lotes)

Lote do pedido. Criado no modal Factory × Category (select-or-create). **Regra do ciclo de vida e do split confirmada com o cliente** (ver detalhamento abaixo).

##### Enum de status do lote (diferente do status da Order — ver 3.7.1)

```sql
create type public.batch_status as enum (
  'in_negotiation',  -- gatilho: lote aberto no SOT
  'in_production',   -- gatilho: etapa "deposit payment" desabilitada ou completada
  'preloading',      -- gatilho: lote vinculado/selecionado para um Pre-loading
  'in_transit',      -- gatilho: etapa "loading date" com completed date preenchida
  'delivered',       -- gatilho: etapa "Delivery Date" com completed date preenchida
  'canceled'         -- ver regra de cancelamento abaixo
);
```

##### Ciclo de vida confirmado

```
in_negotiation → in_production → preloading → in_transit → delivered
       ↑______________↑
       (cancelamento só é possível a partir daqui)
```

- **Avanço em bloco:** ao finalizar a etapa "Pre-loading", **todos** os lotes selecionados naquele plano de embarque avançam juntos para `in_transit`. Ao finalizar a etapa "Shipment", **todos** os lotes daquele embarque avançam juntos para `delivered` — encerrando a esteira para eles.
- **Cancelamento:** só é possível enquanto o lote está em `in_negotiation` ou `in_production` (antes de entrar num Pre-loading). O usuário devolve o(s) lote(s) para um desses dois status e então cancela; um lote `canceled` **não é mais elegível** para nenhuma operação (não entra em Pre-loading, não conta no rollup da Order).

##### Split por carregamento parcial (Total / Partial / None)

Ao finalizar um Pre-loading (lote passando de `preloading` para `in_transit`), o sistema roda uma checagem **linha a linha** sobre cada entrada `order_factory_category` (Factory × Category) daquele lote, atribuindo manualmente **Total / Partial / None**:

- **Total** → a entrada está resolvida; segue no lote normalmente até `in_transit` → `delivered`.
- **Partial / None** → a diferença que não foi carregada é retirada do lote atual e:
  - se já existe um "próximo lote" para aquela Order, a entrada migra para ele;
  - se não existe, o sistema **cria um novo lote** (ex.: Lote 2), contendo **todas** as entradas `order_factory_category` do lote original que não ficaram como Total.
- **O lote original** (a parte que efetivamente carregou) segue seu curso normal: `in_transit` → `delivered`.
- **O lote novo** nasce direto em `in_production` (pula `in_negotiation`, pois já foi negociado antes) e refaz o ciclo a partir daí.
- Hoje (Bubble) a **decisão** Total/Partial/None é manual (usuário atribui por entrada); a **troca de status do lote** em si (avançar de etapa) é automática, disparada pelos gatilhos acima.

✅ **Numeração do lote — RESOLVIDA (print de produção, popover da coluna Batch No.):** o `batch_number` é um **sequencial simples de 2 dígitos por pedido**, no formato `.NN` (`.01`, `.02`, `.03`...), começando em `.01` e **resetando a cada pedido**. Não tem relação com o PO number (o `1490` etc. é o número do pedido, não do lote). Sem limite superior. A leitura anterior (`NNNN .NN`, "independente do PO") estava **errada** — corrigida aqui.

> **Popover da coluna "Batch No." (UI):** clicar no ícone 👁 de uma linha expande os lotes do pedido, cada um com seu **status individual** (chip colorido). Exemplo real (pedido JP4): lote `.01` = Delivered (verde), lote `.02` = In production (laranja) → status do pedido no rollup = **Partially Delivered** (valida a regra de precedência em 3.7.1). Quando há muitos lotes, a UI trunca: exibe os 6 primeiros + contador "+N" (ex.: `.01/.02/.03/.04/.05/.06 + 5` = 11 lotes).

```sql
create table public.batches (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  batch_number    text not null,                -- ".NN" sequencial por pedido, reseta em ".01" (ex: ".01", ".02")
  status          public.batch_status not null default 'in_negotiation',
  split_from_batch_id uuid references public.batches(id),  -- linhagem: aponta para o lote-pai quando nasceu de um split
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (order_id, batch_number)
);
create trigger trg_batches_updated_at before update on public.batches
  for each row execute function public.set_updated_at();
```

> Nota de implementação: como o número reseta por pedido, gerar `batch_number` = `.` + (contagem de lotes daquele `order_id` + 1, com 2 dígitos). O split (Partial/None) cria o próximo `.NN` na sequência do pedido.

#### 3.7.3 order_factory_category (entradas)

As entradas Category + Factory + Batch + Ship requirement de um pedido. É a `List of Factories x Categories x Lote` do Bubble. Criável manualmente ou via **bulk import CSV**.

> ✅ **Granularidade do carregamento confirmada:** o status Total/Partial/None (ver 3.7.2) é atribuído **por entrada** `order_factory_category`, não pelo lote inteiro — um lote pode ter várias entradas Factory×Category, cada uma com seu próprio resultado de carregamento. Por isso `batch_id` aqui é mutável: uma entrada Partial/None **migra** para o lote novo criado pelo split.

> ✅ **Confirmado com o cliente (design):** a atribuição do `batch_id` acontece **junto** com a criação da entrada — no modal "Factory x Category" (aberto a partir da etapa PO via botão "+ Factory x Category"), cada linha importada (CSV) ou criada manualmente já tem um seletor de **Batch No.** com opção de escolher um lote existente ou criar um novo ali mesmo ("+ Add batch"). Essa mesma entidade é reexibida em formato agrupado (Factory / Categories (Qty.) / Date of factory) dentro da etapa "Place the order" — são os mesmos dados, não uma tabela nova.
>
> ✅ **Mecânica do seletor "Batch No." — detalhada (print do popup, linha existente da tabela "Factory x Category"):** o campo "Batch No." de cada linha é um combobox que, ao ser clicado, abre um popover listando **todos os lotes do pedido** (`.01`, `.02`, `.03`...) cada um com seu chip de status atual (`Pre-loading`, `In negotiation`, etc.) e um ícone de lixeira para excluir o lote direto dali. A seleção é feita por **checkbox** — marcar um lote diferente **troca** (reatribui) o `batch_id` daquela entrada para o lote marcado (é sempre um único lote marcado por entrada, coerente com `order_factory_category.batch_id` sendo uma FK simples, não N:N). O botão **"+ Add batch"** no rodapé do popover cria um lote novo (`.NN` seguinte na sequência do pedido) e já o deixa disponível na lista para marcar — ou seja, dá pra criar **e** trocar o lote da entrada sem sair do popover, tanto ao editar uma linha já existente na tabela quanto ao configurar uma linha nova em "New entry".

> ✅ **"Ship requirement" — significado confirmado pelo cliente:** data especulativa (estimativa de planejamento, não trava o sistema) porém **obrigatória** no preenchimento. Representa a data em que a **fábrica precisa entregar/ter pronta** a mercadoria daquela entrada Factory×Category. É puramente informativa — **não dispara alertas, bloqueios ou notificações automáticas** quando a data passa sem a etapa concluída. Por pertencer à entrada (não ao lote), a data **viaja junto** quando a entrada migra de lote num split (ver 3.7.2).

> ✅ **Sem filtro por Company/BU (print da tela "Factory x Category"):** os campos de busca **Category** e **Factory** do modal (seção "New entry") listam **todos** os cadastros do sistema — sem segmentação por Company/BU do pedido.

> ✅ **Bulk import CSV — validação confirmada (print da tela "Bulk import from CSV"):** o modal "Factory x Category" tem um segundo modo, acessado pelo botão "Bulk import" (alternativa ao "New entry" manual), que troca a tela para upload de arquivo CSV (com "Download template" disponível para o usuário preencher no formato certo). Após o upload, o CSV é parseado em uma lista de **preview** (uma linha por entrada, antes de gravar qualquer coisa no banco). Regra de validação client-side confirmada pelo cliente:
> - Cada linha do preview tem um indicador de status na lateral direita, **verde** quando a Category **e** a Factory daquela linha batem com um cadastro existente no sistema (por nome/código, igual à busca do "New entry" manual).
> - Se a Category **ou** a Factory da linha não for encontrada nos cadastros, o indicador daquela linha fica **vermelho** em vez de verde.
> - O botão **"Insert (N)"** (N = quantidade de linhas do preview) fica **desabilitado/bloqueado** enquanto **houver pelo menos uma linha vermelha** no preview — não é possível importar parcialmente ignorando só as linhas inválidas; o lote inteiro do CSV fica travado até todas as linhas ficarem verdes.
> - Não há criação automática de Category/Factory a partir do CSV (comportamento *fail closed*, igual ao resto do sistema — ver seção 11): o usuário precisa **corrigir o valor na planilha e reenviar** o CSV, ou **cadastrar** a Factory/Category faltante em Registration antes de conseguir importar.
> - Batch No. e Ship requirement (colunas também presentes no template do CSV, ver linha da tabela `order_factory_category` acima) não passam por essa mesma validação de "existe no cadastro" — são texto/data livres por linha, seguindo a mesma mecânica de "escolher existente ou criar novo" do seletor manual.

> ✅ **Elegibilidade do lote pro seletor Batch No. — regra do Bubble confirmada:** um lote só aceita **novas** entradas Factory x Category (criação manual, CSV, ou troca de lote de uma entrada existente) enquanto está em **In Negotiation** ou **In Production**. A partir do momento em que avança pra **Pre-Loading** em diante (In Transit, Delivered, Canceled), ele "fecha" pra esse cadastro e some da lista de opções do seletor — mas se uma entrada já estiver ligada a ele, continua exibido normalmente (só não é mais possível trocar *para* ele). Mesmo critério que já valia no backend (`assertBatchEditable`); a mudança aqui é refletir isso na lista do seletor em vez de só rejeitar no servidor.

```sql
create type public.loading_status as enum ('total', 'partial', 'none');

create table public.order_factory_category (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  category_id      uuid not null references public.categories(id),
  factory_id       uuid not null references public.factories(id),
  batch_id         uuid references public.batches(id),  -- mutável: migra de lote em caso de split
  ship_requirement date not null,               -- data (especulativa) em que a fábrica precisa entregar; sem gatilho automático
  loading_status   public.loading_status,        -- atribuído ao finalizar o Pre-loading daquele lote
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_ofc_updated_at before update on public.order_factory_category
  for each row execute function public.set_updated_at();
```

#### 3.7.4 etd_info + etd_history

Dados de ETD (data estimada de saída da fábrica) por entrada fábrica×categoria. Editados no drawer "ETD information" do checklist, **com histórico de alterações**. A rua **ETD Factories é apenas uma VIEW read-only** sobre estes dados (não é tabela nova).

- ✅ **Dispatch location — reconfirmado** como **FK → factories** (o print mostrando "China"/"Brazil" era dado mockado só para visualização de layout, não reflete o schema real).
- ✅ **Ready / Inspection — confirmado:** são apenas **booleans simples**, sem lógica adicional. Na rua ETD Factories esse mesmo campo `ready` aparece com o rótulo **"Ready parts"** — mesmo campo, nome de UI diferente.
- ✅ **Initial date / Current date — confirmado.** O `initial_date` é preenchido **manualmente pelo usuário na etapa "ETD" do checklist da Order** (etapa #8, fase Order) — essa é a **origem** do dado. Ao ser preenchido, dispara automaticamente o `current_date` com a data do dia. O campo é depois apenas **exibido** em outras telas: coluna "Initial Date" na rua ETD Factories e coluna "ETD Initial" no modal de Confirm Shipping do Pre-loading (daí aparecer vazio quando ainda não foi preenchido na origem).
- ✅ **Ready date — NOVO campo (print do Bubble).** Além do boolean `ready`, existe uma **data** registrada **automaticamente no momento em que o checkbox "Ready Parts" é marcado**. Ela alimenta o cálculo do "Gap of Ready" na listagem.
- 🔄 **History — CORRIGIDO (print da tela "ETD update"):** a leitura anterior ("grava só o diff") estava **errada** — cada entrada de `etd_history` é um **snapshot completo** do estado do `etd_info` no momento daquela edição (Insp./Ready/Remarks/Current date/Dispatch location/Dispatch date), não só o campo que mudou. Prova: duas entradas de história do mesmo registro mostram `ready` diferente entre si (uma antes, outra depois de marcado) enquanto os demais campos se repetem — snapshot, não diff pontual.

> ✅ **Etapa "ETD" do checklist — linha a linha, não agrupado (print da tela):** diferente da etapa "Place the Order" (agrupada por Factory, ver 3.7.5), a etapa ETD reexibe **uma linha por entrada `order_factory_category`** do pedido (Factory + Category + Batch, sem agrupar), com colunas editáveis inline: **Insp.** (`inspection`), **Ready?** (`ready`), **Initial Date**, **Current Date** (read-only, auto), **Dispatch loc.** (busca por Factory) e **Dispatch date**. Uma entrada sem `etd_info` ainda (comum — só ~1317 das 9441 entradas migradas do Bubble tinham ETD preenchido) fica com todos os campos em branco/desmarcado até o primeiro edit, que cria a linha (upsert por `order_factory_category_id`).
>
> ✅ **Insp./Ready — trava só na edição inline (correção):** os dois booleans só andam em uma direção (não marcado → marcado) **na linha da tabela** — uma vez `true` ali, o checkbox trava e não dá mais pra desmarcar por esse caminho. Mas **dentro do modal "ETD update" a trava não vale**: é justamente a via autorizada pra corrigir um valor já marcado, com o motivo obrigatório em Remarks ficando registrado no histórico.
>
> ✅ **Modal "ETD update" (ícone de seta) — confirmado com print:** é a via **auditada** de edição — um dropdown "Select what you want to change" com 5 opções (**Current Date, Ready, Inspection, Dispatch Location, Dispatch Date** — note que **Initial Date não está na lista**, só editável inline), o campo correspondente aparece abaixo, e um **Remarks obrigatório** (motivo da mudança) antes de "Save changes". Cada save grava uma linha em `etd_history` com o snapshot completo (ver acima) + `changed_at`. Abaixo do form, a própria tela lista esse histórico completo (mesmas colunas do snapshot + Factory/Category fixos da entrada + coluna "Date/Time"), paginado; Remarks truncado na tabela com ícone de olho abrindo o texto completo num popover "Full remarks".

```sql
create table public.etd_info (
  id                    uuid primary key default gen_random_uuid(),
  order_factory_category_id uuid not null unique references public.order_factory_category(id) on delete cascade,
  remarks               text,
  ready                 boolean not null default false,   -- "Ready Parts" na UI
  ready_date            date,     -- registrada AUTOMATICAMENTE quando `ready` é marcado; base do "Gap of Ready"
  inspection            boolean not null default false,   -- flag simples, sem lógica adicional
  dispatch_location_id  uuid references public.factories(id),   -- vem de factories
  initial_date          date,     -- preenchido MANUALMENTE pelo usuário; dispara current_date ao ser preenchido
  dispatch_date         date,
  current_date          date,    -- preenchido automaticamente = data de hoje, no momento em que initial_date é preenchido
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()   -- exibido como "Last Updated" na listagem
);
create trigger trg_etd_info_updated_at before update on public.etd_info
  for each row execute function public.set_updated_at();

-- Log de alterações do ETD (History) — grava um SNAPSHOT completo do etd_info
-- a cada edição feita via modal "ETD update" (não um diff pontual — ver 3.7.4)
create table public.etd_history (
  id           uuid primary key default gen_random_uuid(),
  etd_info_id  uuid not null references public.etd_info(id) on delete cascade,
  changed_fields jsonb not null,               -- snapshot: { field, inspection, ready, remarks, current_date, dispatch_location_name, dispatch_date }
  changed_by   uuid references public.profiles(id),
  changed_at   timestamptz not null default now()
);

-- ETD Factories (rua read-only): VIEW, não tabela — colunas conforme Bubble real
-- create view public.etd_factories_view as
--   select cl.name as client,
--          b.batch_number             as batch,
--          f.name                     as factories,
--          cat.name                   as categories,
--          o.date_po                  as order_date,
--          ofc.ship_requirement       as shipment_req,
--          e.initial_date,
--          e.current_date,
--          (e.current_date - e.initial_date)      as days_delay,   -- calculado
--          e.updated_at               as last_updated,
--          e.ready                    as ready_parts,
--          e.inspection,
--          (current_date - e.ready_date)          as gap_of_ready, -- calculado, só quando ready = true
--          b.status
--   from public.order_factory_category ofc
--   join public.orders o        on o.id = ofc.order_id
--   join public.factories f     on f.id = ofc.factory_id
--   join public.categories cat  on cat.id = ofc.category_id
--   left join public.batches b  on b.id = ofc.batch_id
--   left join public.etd_info e on e.order_factory_category_id = ofc.id
--   left join public.clients cl on cl.id = o.client_id
--   where b.status in ('in_production', 'preloading');   -- filtro padrão da tela
```

##### Rua ETD Factories — layout e regras confirmados (print do **Bubble em produção**)

> ⚠️ **Fonte de verdade:** as regras abaixo vêm do **Bubble rodando em produção**, não do Figma. O Figma é apenas protótipo visual — pode conter dados mockados, colunas que não existem e textos genéricos. Sempre validar contra o Bubble.

**Colunas da listagem (ordem real):**

| # | Coluna (UI) | Origem |
|---|---|---|
| 1 | Client | `orders.client_id → clients.name` |
| 2 | Batch | `batches.batch_number` — formato `.NN` sequencial por pedido (ex.: `.01`, `.02`), resetando a cada pedido. Sem limite superior. |
| 3 | Factories | `order_factory_category.factory_id → factories.name` |
| 4 | Categories | `order_factory_category.category_id → categories.name` |
| 5 | Order date | `orders.date_po` (a confirmar se é exatamente esse campo) |
| 6 | Shipment Req. | `order_factory_category.ship_requirement` |
| 7 | Initial Date | `etd_info.initial_date` |
| 8 | Current Date | `etd_info.current_date` |
| 9 | **Days Delay** | 🧮 **Calculado** — ver abaixo |
| 10 | Last Updated | `etd_info.updated_at` |
| 11 | Ready Parts | `etd_info.ready` (checkbox) |
| 12 | Inspection | `etd_info.inspection` (checkbox) |
| 13 | **Gap of Ready** | 🧮 **Calculado** — ver abaixo |

**Campos calculados (não persistidos — computados em tempo de leitura):**

- **Days Delay** = **|`current_date` − `initial_date`|** (valor absoluto). É a medida de atraso da entrada. Exibe `-` quando não há dados suficientes para o cálculo. Pode ter valor fracionário (ex.: `8.5`).
  > ✅ **Nunca negativo — confirmado com o cliente (13/08/2026).** Quando a ETD é *antecipada*, `current_date` fica antes de `initial_date` e a subtração crua dá negativo (26 entradas em produção, de −1 a −109 dias). A regra é contar o desvio **pelos dois lados**: o negativo vira positivo. Implementado em `daysDelay()` (`app/(dashboard)/etd-factories/page.tsx`) — o copilot usa a mesma função, para a resposta bater com a tela.
  >
  > ⚠️ **Dado sujo conhecido:** 1 entrada com `initial_date = 0020-08-20` (provável erro de digitação de `2020-08-20`) produz Days Delay de 732.654 dias. O módulo não resolve isso — precisa correção no dado (`etd_info` id `e13775d2-ab4d-4420-9423-8990a4fe8c70`).
- **Gap of Ready** = **data de hoje** − `ready_date`. Só tem valor nas linhas em que `ready` está marcado (senão exibe `-`).
- ⚠️ **Ambos usam a data de HOJE / são recalculados a cada abertura da tela** — não são congelados no banco. Implicação: são colunas derivadas na VIEW (ou computadas no frontend), nunca colunas materializadas.

**Controles do topo:**
- Busca por **PO number** (campo único). ✅ **Confirmado:** o segundo campo "PL number" que aparece no Figma **não existe** no Bubble — é invenção do protótipo, descartar.
- Botão **Filters**.
- ✅ Botão **Download XLS — MANTIDO nesta tela.** É a **exceção** confirmada à decisão global de cortar exportações do sistema: especificamente na rua ETD Factories o XLS permanece. _(Escopo exato — se respeita filtros aplicados e quais colunas exporta — ainda a confirmar; ver seção 8.)_

> ❌ **Descartado (só existe no Figma):** as colunas **Loading**, **Cons. point** (consolidation point) e **POD** (port of discharge) que aparecem na "variante vazia" da tela no protótipo **não existem no Bubble** e não devem ser implementadas. Mesmo caso do campo de busca "PL number".

**Outras regras confirmadas:**
- ✅ **Sem criação de registro.** O texto "Create new records" que aparece no estado vazio é um **resquício de texto genérico reaproveitado** de outra tela e **não tem função** — não existe botão de criar aqui. Os dados exibidos são originados no checklist da Order (etapa ETD). ⚠️ **A confirmar:** se a tela permite *edição inline* dos campos (o mockup do Figma mostrava um seletor de data na coluna Initial Date), ou se é estritamente leitura, com toda a edição acontecendo na etapa ETD do checklist da Order.
- ✅ **Filtro padrão da lista — reconfirmado.** Mostra apenas lotes com status `in_production` e `preloading` (mesmo com o enum de batch tendo 6 valores, o padrão continua sendo só esses dois).
- ⚠️ **Typo de UI para o designer:** "Delived" → **"Delivered"** (aparece no Figma; verificar se também ocorre no Bubble).

#### 3.7.5 order_checklist_steps + step_attachments

O **Order Progress**: as etapas obrigatórias. **As etapas são FIXAS (definidas no código)** — não há tabela de configuração. Cada pedido guarda apenas o *estado* de cada etapa.

- ✅ **Lista completa e ordenada das etapas — confirmada pelo cliente.** 24 etapas fixas, agrupadas em 4 fases. A coluna de status de lote que aparecia junto na planilha do cliente foi **descartada** (tentativa de filtro que não funcionou bem na prática — não usar como regra).

| # | Etapa | Fase | Toggle (opcional)? |
|---|---|---|---|
| 1 | Order | Order | — fixa |
| 2 | PO | Order | — fixa |
| 3 | PI | Order | — fixa |
| 4 | Deposit Payment | Order | ✅ toggle |
| 5 | Packing Confirm. | Order | ✅ toggle |
| 6 | Condition Confirm. | Order | ✅ toggle |
| 7 | Place the Order | Order | — fixa |
| 8 | ETD | Order | — fixa |
| 9 | Balance Payment | Order | ✅ toggle |
| 10 | Pre-Loading | Order | — fixa |
| 11 | Consolidation Point | Preloading | _(a mapear)_ |
| 12 | City | Preloading | _(a mapear)_ |
| 13 | Port of Loading | Preloading | _(a mapear)_ |
| 14 | Shipping Docs | Preloading | _(a mapear)_ |
| 15 | Agents | Preloading | _(a mapear)_ |
| 16 | Booking | Preloading | _(a mapear)_ |
| 17 | Loading Date | Preloading | _(a mapear)_ |
| 18 | Shipping Date | Shipment | _(a mapear)_ |
| 19 | BL | Shipment | _(a mapear)_ |
| 20 | Original Docs | Shipment | _(a mapear)_ |
| 21 | Inspection Report | Shipment | _(a mapear)_ |
| 22 | ETA Brazil | Shipment | _(a mapear)_ |
| 23 | ATA Brazil | Shipment | _(a mapear)_ |
| 24 | Delivered | Shipment | _(a mapear)_ |

> ✅ **Toggle = etapa opcional (ativar/desativar), confirmado nos prints de produção (ligado e desligado).** Algumas etapas têm um **toggle** que liga/desliga se aquela etapa **faz parte do fluxo daquele pedido específico**. Toggle **off = a etapa fica visível porém desabilitada/apagada** (texto e ícone acinzentados, toggle cinza) e **não precisa ser cumprida** — não bloqueia o avanço do pedido. Não **some** da lista; apenas fica inativa. **Não é conclusão** — a conclusão continua sendo pelo preenchimento dos campos (`completed_on`); o toggle é uma camada separada de "essa etapa se aplica a este pedido?". Na fase **Order**, as etapas com toggle são exatamente **Deposit Payment, Packing Confirm., Condition Confirm. e Balance Payment** (todas ligadas a pagamento/confirmação, que nem sempre se aplicam) — confirmado nos dois estados (on/off). As etapas com toggle das fases Preloading e Shipment ainda serão confirmadas por print. Modelado como coluna `enabled` em `order_checklist_steps` (ver abaixo).

> ⚠️ **Ordem sequencial dentro da fase — regra vs. realidade:** o esperado é que as etapas dentro de uma mesma fase sejam completadas em ordem (ex.: dentro de "Order", PO antes de PI antes de Deposit Payment...). Confirmado com o cliente que **isso não é garantido hoje no Bubble** — é um gap conhecido, não uma regra de negócio a replicar. Na versão nova, avaliar se vale a pena **impor** a ordem sequencial (bloquear conclusão de uma etapa se a anterior da mesma fase não estiver concluída) já que parece ser o comportamento pretendido, mesmo que não implementado hoje. Confirmar com o cliente se essa é uma melhoria desejada ou se a flexibilidade atual (completar fora de ordem) deve ser preservada.

- Ícones: laranja = a etapa exige algo além da data e ainda não cumpriu; azul = só a data pendente; verde = concluída.
- **Conclusão da etapa:** `completed_on` é a condição comum às 24, mas **não é a única** — 13 etapas exigem também um documento, um cadastro escolhido ou um número digitado. Tabela abaixo. Os demais campos (Estimated date, Responsible, Signed by) continuam opcionais.

##### Condição de conclusão por etapa (✅ confirmado com o cliente)

Toda etapa exige `completed_on`. A coluna "+ além da data" é o que se soma a isso:

| # | Etapa | + além da data |
|---|---|---|
| 1 | Order | — |
| 2 | PO | documento **e** entradas Factory × Category |
| 3 | PI | documento — **só quando o Order Type é Sales**; Samples, Gift e Replacement fecham só com a data |
| 4 | Deposit Payment | — |
| 5 | Packing Confirm. | — |
| 6 | Condition Confirm. | — |
| 7 | Place the Order | documento |
| 8 | ETD | "Initial date" preenchido em TODAS as entradas Factory × Category |
| 9 | Balance Payment | — |
| 10 | Pre-Loading | documento |
| 11 | Consolidation Point | consolidation point escolhido (cadastro de **fábricas**) |
| 12 | City | city escolhida |
| 13 | Port of Loading | port of loading escolhido — cadastro de **portos** (`pols`), **não** de fábricas |
| 14 | Shipping Docs | documento |
| 15 | Agents | os 5: carrier agent, agent Brazil, agent China, contact Brazil, contact China |
| 16 | Booking | booking number |
| 17 | Loading Date | — |
| 18 | Shipping Date | — |
| 19 | BL | documento |
| 20 | Original Docs | documento |
| 21 | Inspection Report | — (aceita documento, mas **hoje é opcional**; pode virar obrigatório) |
| 22 | ETA Brazil | — |
| 23 | ATA Brazil | — |
| 24 | Delivered | — |

##### Ordem de preenchimento: Estimated date antes de Completed on (✅ confirmado 12/08/2026)

**`Completed on` só pode ser preenchido se o `Estimated date` estiver preenchido** — não se conclui uma etapa que nunca foi prevista. Vale nas 24 etapas, nas três telas.

- Na UI o campo "Completed on" fica **desabilitado** enquanto não há estimativa, com o texto "Set the estimated date" no lugar do `dd/mm/yyyy`.
- No servidor a regra é reforçada em `validateStepDates` (`lib/checklist-completion.ts`), chamada pelas três actions de gravação — a trava não é só visual.
- **Limpar o `Estimated date` de uma etapa já concluída é bloqueado**, senão o par ficaria inválido. Primeiro limpa a conclusão, depois a estimativa.
- ⚠️ **Não é retroativo.** Boa parte do acervo migrado do Bubble tem `completed_on` sem `estimated_date` (a estimativa não veio na migração). Essas etapas continuam válidas e concluídas; o campo segue editável nelas, para não ficarem presas. A validação só julga quando a gravação mexe numa das duas datas — editar Responsible numa etapa dessas não é barrado.

> Implementado em `lib/checklist-completion.ts`, aplicado **na leitura** pelas três telas (Order, Pre-loading, Shipment). A mesma regra vale para o contador "X of Y steps completed", para o filtro "Hide completed steps" e para a trava do **Confirm Shipping** — verde significa a mesma coisa em todo lugar.
>
> ⚠️ As colunas `done` de `order_checklist_steps` e `pre_loading_checklist_steps` continuam sendo só o **espelho de `completed_on`** (é o que os writers gravam). Não são a fonte da verdade da conclusão: parte das condições (anexos, entradas Factory × Category, ETD) muda fora do save da etapa, e um valor gravado envelheceria. Quem pergunta "está concluída?" chama `isStepChecked`.
>
> ⚠️ **A To do list continua listando por `completed_on IS NULL`**, não pela regra completa — de propósito. Etapa migrada do Bubble sem documento reapareceria como tarefa em massa (o mesmo ruído de migração que o filtro de status terminal já trata). Revisar quando o acervo migrado estiver completo.
- **Etapas opcionais (toggle):** as 4 etapas marcadas acima podem ser desativadas; desativadas somem do checklist e não precisam ser cumpridas.
- Enquanto etapas **ativas e obrigatórias** não concluídas, o pedido **não avança**.
- A **Camada 2 do RBAC** (Profile Filters for Steps) — deny por etapa/perfil, escopo indefinido (ver 3.7.5 e seção 8).

```sql
-- Fase/grupo de cada etapa (usado para agrupamento visual e possíveis regras de bloqueio entre fases)
create type public.checklist_phase as enum ('order', 'preloading', 'shipment');

-- 24 etapas fixas do Order Progress, em ordem — confirmado com o cliente
create type public.checklist_step as enum (
  'order',                 -- 1  · fase: order
  'po',                    -- 2  · fase: order
  'pi',                    -- 3  · fase: order
  'deposit_payment',       -- 4  · fase: order
  'packing_confirm',       -- 5  · fase: order
  'condition_confirm',     -- 6  · fase: order
  'place_the_order',       -- 7  · fase: order
  'etd',                   -- 8  · fase: order
  'balance_payment',       -- 9  · fase: order
  'pre_loading',           -- 10 · fase: order
  'consolidation_point',   -- 11 · fase: preloading
  'city',                  -- 12 · fase: preloading
  'port_of_loading',       -- 13 · fase: preloading
  'shipping_docs',         -- 14 · fase: preloading
  'agents',                -- 15 · fase: preloading
  'booking',               -- 16 · fase: preloading
  'loading_date',          -- 17 · fase: preloading
  'shipping_date',         -- 18 · fase: shipment
  'bl',                    -- 19 · fase: shipment
  'original_docs',         -- 20 · fase: shipment
  'inspection_report',     -- 21 · fase: shipment
  'eta_brazil',            -- 22 · fase: shipment
  'ata_brazil',            -- 23 · fase: shipment
  'delivered'              -- 24 · fase: shipment
);
```

> Nota: a ordem numérica (1–24) é a ordem de exibição/precedência das etapas. O mapeamento etapa→fase acima é informativo; se for necessário consultar a fase de uma etapa em SQL (ex. para regras de bloqueio), considerar uma tabela de lookup `checklist_step_meta(step, phase, display_order)` em vez de embutir a fase só no enum.

```sql
create table public.order_checklist_steps (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  step          public.checklist_step not null,
  enabled       boolean not null default true,   -- TOGGLE: só as etapas opcionais podem ir a false; false = etapa não faz parte deste pedido
  done          boolean not null default false,  -- espelho de completed_on; a conclusão real é isStepChecked (ver 3.7.5)
  estimated_date date,
  responsible_id uuid references public.profiles(id),
  completed_on  date,                            -- preenchido = etapa concluída
  signed_by_id  uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (order_id, step)
);
create trigger trg_ocs_updated_at before update on public.order_checklist_steps
  for each row execute function public.set_updated_at();

-- Documentos anexados a uma etapa (Supabase Storage; guarda o path)
create table public.step_attachments (
  id            uuid primary key default gen_random_uuid(),
  checklist_step_id uuid not null references public.order_checklist_steps(id) on delete cascade,
  factory_id    uuid references public.factories(id),  -- só usado na etapa "Place the Order" (ver abaixo); null nas demais
  file_path     text not null,               -- bucket 'order-documents'
  file_name     text,
  uploaded_by   uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
```

> ✅ **Etapa "Place the Order" — visão agrupada por Factory (print da tela):** os campos padrão da etapa (Estimated date/Responsible/Completed on/Signed by) aparecem normalmente, e abaixo deles a **mesma entidade `order_factory_category`** da etapa PO é reexibida **agrupada por Factory**: uma linha por Factory com **"N° of categories"** = contagem de entradas daquela Factory neste pedido (não distinct — duas entradas com a mesma Category em lotes diferentes contam 2). Cada linha expande (chevron) pra uma sub-tabela **Categories | Batch Number**. Paginado (10 Factories por página).
> - **Anexo por grupo:** o botão **"+ Attach"** de cada linha faz upload de documento vinculado a **essa combinação (Factory + etapa "Place the Order" + pedido)**, não à etapa inteira — por isso `step_attachments` ganhou a coluna `factory_id` (nullable; demais etapas continuam com anexo por etapa só, `factory_id = null`). A lista "Attached documents" some da UI genérica de etapa só pra "Place the Order" (substituída pelo anexo por Factory).

#### Camada 2 do RBAC — "Profile Filters for Steps" (rua 25), 🔴 escopo indefinido

Depois de ler o card da rua 25 (**Users → Profile Step Permissions**), o desenho real desta funcionalidade ficou claro — e é diferente de uma matriz de permissão positiva:

- **É uma deny-list por etapa.** A tela tem **regras fixas predefinidas** "Deny Step [etapa]" (Deny Step Order, Deny Step PO, Deny Step PI, Deny Step Deposit Payment, Deny Step Deposit Confirmation...). Não se cria nem exclui regra — apenas se adiciona/remove quem fica **negado** naquela etapa.
- **Semântica de negação, não permissão:** por padrão todos veem a etapa; a regra **nega** especificamente. É o oposto de um allow-list.
- **Nível = por PERFIL** (confirmado com o cliente: "per profile"). ⚠️ **Contradição de design:** a tela atual do Bubble adiciona **usuários** individualmente ("Add user"), não perfis. Se a regra é por perfil, a UI precisa mudar para "Add profile". Levar ao designer/cliente.
- **Escopo indefinido:** não está decidido se esta rua entra no MVP. Com o RBAC simplificado (admin/user), ela pode se tornar redundante. Decisão macro pendente (ver seção 8).

Schema **proposto** (deny por perfil × etapa), a confirmar caso a rua entre no escopo:

```sql
-- Deny-list: perfis NEGADOS por etapa do checklist — PROPOSTA, escopo indefinido
create table public.role_step_denies (
  role_id  uuid not null references public.roles(id) on delete cascade,
  step     public.checklist_step not null,
  primary key (role_id, step)
);
-- Presença da linha = aquele perfil está NEGADO naquela etapa.
-- (A tela atual do Bubble adiciona por usuário; se confirmado "por perfil", muda a UI.)
```

> Camada 1 (`role_permissions`, CRUD por módulo) + Camada 2 (deny por etapa, acima). Ambas ficam **modeladas mas não usadas** enquanto o RBAC estiver simplificado a admin/user. Se a granularidade voltar, a Camada 2 é uma deny-list por perfil, não um allow por papel como eu havia proposto antes.

---

### 3.9 Bloco Pre-loading — pre_loadings + checklist

**Origem Bubble:** telas Pre-Loading (lista, criação, detalhe/checklist). **Fonte:** prints do **Bubble em produção**.
**Descrição:** o **Pre-loading (PL)** é o plano de embarque. Agrupa lotes (`batches`) que estão em `in_production`, percorre seu próprio checklist de 7 etapas, e ao ser confirmado gera um **Shipment** — momento em que se atribui Total/Partial/None por entrada Factory×Category e ocorre o eventual split de lotes (ver 3.7.2).

#### Visão geral do fluxo

```
Pre-loading (PL number auto)
  ├── clientes (N — pode agrupar lotes de CLIENTES DIFERENTES)
  ├── pre_loading_batches (N — lotes selecionados; lote passa a status 'preloading')
  ├── pre_loading_checklist_steps (7 etapas fixas: Consolidation Point → ... → Loading Date)
  │        └── step_attachments (documentos por etapa)
  └── "Confirm Shipping" → cria Shipment
           └── por entrada Factory×Category: Total / Partial / None
                    └── Partial/None → split de lote (ver 3.7.2)
```

#### 3.9.1 pre_loadings

| Campo (UI) | Coluna | Tipo | Regra |
|---|---|---|---|
| Pre-Loading No. / PL number | `pl_number` | text | **Auto-gerado**, formato `PL - NNNN` (ex.: `PL - 1354`). Exibido só como número na lista (`1353`). |
| Pre-Loading Create Date / Date PL | `created_date` | date | Preenchido automaticamente na criação. |
| Client(s) | _(tabela `pre_loading_clients`)_ | — | ⚠️ **Múltiplos clientes** — um PL pode agrupar lotes de clientes diferentes. Obrigatório. |
| Client(s) Reference | `client_reference` | text | Obrigatório. |
| Port of Destination / POD | `pod_id` | uuid FK → pods | Obrigatório. |
| Responsible and Signer | `responsible_signer_id` | uuid FK → profiles | |
| Leader | `leader_id` | uuid FK → profiles | Obrigatório. |
| Cons. Point | _(via etapa do checklist)_ | — | FK → `factories` (ver nota abaixo). Exibido na lista. |
| POL | _(via etapa do checklist)_ | — | FK → `pols`. Exibido na lista. |
| Loading Date | _(via etapa do checklist)_ | — | Data da etapa "Loading Date". Exibida na lista. |
| Preloading completed? | _(derivado)_ | — | ✅ Fica marcado quando a etapa **"Loading Date" do checklist está com datas preenchidas**. |
| Booking Status | `booking_status` | text | ✅ **Campo aberto** (texto livre, não enum). Ex.: "Provisório". |
| Seal number | `seal_number` | text | ✅ **Campo aberto** (texto livre). Nº do lacre do container. **Preenchido após a criação** (não no create do PL) — normalmente no momento do embarque. Serve de busca na lista. |
| Total PO's | _(derivado)_ | — | ✅ Contagem do que está **dentro dos lotes associados** ao PL. |

> ✅ **Consolidation Point — confirmado:** as opções vêm do cadastro **`factories`** (mesma tabela das fábricas), não é um cadastro próprio.

```sql
create table public.pre_loadings (
  id                     uuid primary key default gen_random_uuid(),
  pl_number              text not null unique,        -- auto-gerado, formato "PL - NNNN"
  created_date           date not null default current_date,
  client_reference       text not null,
  pod_id                 uuid not null references public.pods(id),
  responsible_signer_id  uuid references public.profiles(id),
  leader_id              uuid not null references public.profiles(id),
  booking_status         text,                        -- campo ABERTO (texto livre); ex.: "Provisório"
  seal_number            text,                        -- campo ABERTO; nº do lacre; preenchido após criação; buscável na lista
  deleted_at             timestamptz,                 -- soft delete (confirmado)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.profiles(id)
);
create trigger trg_pre_loadings_updated_at before update on public.pre_loadings
  for each row execute function public.set_updated_at();

-- Clientes do PL (M-N — um PL pode agrupar lotes de clientes diferentes)
create table public.pre_loading_clients (
  pre_loading_id uuid not null references public.pre_loadings(id) on delete cascade,
  client_id      uuid not null references public.clients(id),
  primary key (pre_loading_id, client_id)
);

-- Lotes selecionados para o PL
create table public.pre_loading_batches (
  pre_loading_id uuid not null references public.pre_loadings(id) on delete cascade,
  batch_id       uuid not null references public.batches(id),
  primary key (pre_loading_id, batch_id)
);
```

#### 3.9.2 Lista de Pre-loading — regras de UI confirmadas

- **Busca:** por `PL number`.
- ✅ **Filtros (modal "Filters") — confirmados**, agrupados em 4 seções:

  | Grupo | Campos |
  |---|---|
  | **Customer / Order data** | `Client` (múltiplo — "Choose some client") · `Client Reference` (busca texto) · `Leader` (busca) · `Orders` (dropdown "Choose Orders") |
  | **Involved agents** | `Agent Brazil` (busca) · `Agent China` (busca) |
  | **Transport and logistics** | `Carrier` (busca por nome) · `POL (Port of Loading)` (dropdown) · `POD (Port of Discharge)` (busca) · `Consolidation Point` (busca) |
  | **Dates** | `Loading Date` — **range** (dois campos de data: de/até) |

  Ações do modal: **Clear Filters** e **Filter**.
- ✅ **Download XLS — MANTIDO nesta tela.** Assim como na rua ETD Factories, é uma **exceção** confirmada à decisão global de cortar exportações.
- ✅ **Edição (ícone de lápis):** reabre o **mesmo modal da criação** — é um componente reutilizável, com os dados já preenchidos. Permite reeditar inclusive a seleção de lotes.
- ✅ **Exclusão (ícone de lixeira): soft delete**, seguindo a política global do sistema.
- ⚠️ **Pre-loadings confirmados somem desta lista.** Quando um PL é confirmado ("Confirm Shipping") e vira Shipment, ele **deixa de ser exibido na lista de Pre-loading** — passa a ser acessível apenas pela tela de Shipments. Implicação: a listagem de PL filtra por "ainda não confirmados". Modelagem: um campo `shipping_confirmed_at` em `pre_loadings` (ou a simples existência do registro em `shipments`) determina a exibição.

#### 3.9.3 Criação do Pre-loading (modal "Create pre-loading")

Fluxo do modal, em ordem:

1. **Pre-loading information** — `Pre-Loading No.` e `Create Date` já vêm preenchidos (read-only).
2. **Operational details** — `Client` (múltiplo, obrigatório), `Client(s) Reference` (obrigatório), `Port of Destination` (obrigatório).
3. **Responsible** — `Responsible and Signer`, `Leader` (obrigatório).
4. **Order selection** — busca por `Order number` + botão `Clear filters`, e uma tabela paginada com **checkbox por linha**:

   | Coluna | Conteúdo |
   |---|---|
   | Clients | Nome do cliente |
   | PO / Batch Number | Formato `PO / lote` (ex.: `1488 / 2`, `1485 / 1`) |
   | Factories Number | Contagem de entradas Factory×Category do lote (ex.: "1 register", "3 registers", "0 register") — cada linha é expansível (`⌄`) para ver as entradas |

5. Botão **Create** (habilitado só com os obrigatórios preenchidos) ou **Cancel**.

> Observação: a coluna "PO / Batch Number" usa o formato `PO / lote` na seleção, enquanto a rua ETD Factories exibe o lote como `1310 .010`. São representações diferentes do mesmo par (Order + batch).

#### 3.9.4 Detalhe do Pre-loading

**Table information** (dados de consulta, read-only):
- **Main information:** `PL number`, `Date PL`, `POD (Port of Discharge)`
- **Responsible:** `Leader`, `Responsible and Signer`, `Client(s) Reference`

**Tabela de lotes vinculados:** `Client` | `Order Number . Batches` (ex.: `1483 .02`) | `Status` (ex.: `Pre-loading`)

**Order progress:** o checklist de 7 etapas (ver 3.9.4).

#### 3.9.5 pre_loading_checklist_steps — as 7 etapas

Mesmas etapas 11–17 já mapeadas no enum `checklist_step` (fase `preloading`), aqui confirmadas com seus **campos específicos**:

| Etapa | Campos padrão | Campo(s) específico(s) |
|---|---|---|
| Consolidation Point | Estimated date · Responsible · Completed on · Signed by · Attached documents | `consolidation_point_id` → **factories** |
| City | idem | `city_id` → cities |
| Port of Loading | idem | `pol_id` → pols |
| Shipping Docs | idem | — (só os campos padrão) |
| Agents | idem | `carrier_agent_id`, `agent_brazil_id`, `agent_china_id`, `contact_brazil_id`, `contact_china_id` |
| Booking | idem | `booking_number` (text) |
| Loading Date | idem | — (a data vem de "Completed on"/"Estimated date") |

**Ícones de estado das etapas** (iguais aos de Orders): laranja = a etapa exige algo além da data e ainda não cumpriu (o tooltip diz o quê) · verde ✓ = concluída · azul = só a data pendente.

##### Regras de comportamento — diferenças em relação ao checklist de Orders

- ✅ **Sem toggle de conclusão — gatilho confirmado.** Diferente da Rua Orders - Checklist (que tem switch por etapa), aqui **não existe toggle manual**. A conclusão da etapa (✓ verde) é **derivada dos campos preenchidos**, com `completed_on` (Completed date) sempre obrigatório. Estimated date, Responsible e Signed by nunca travam a conclusão.
  - ⚠️ **Revisado (12/08/2026):** a versão anterior desta regra dizia que `completed_on` era o **único** campo obrigatório. Não é: o cliente detalhou etapa a etapa e 13 das 24 exigem também documento, cadastro escolhido ou número digitado — ver a tabela em **3.7.5**. Aqui isso alcança Consolidation Point, City, Port of Loading, Shipping Docs, Agents e Booking. _(A evidência antiga de "Port of Loading" concluída com o campo vazio era bug do Bubble; agora o campo é exigido de verdade.)_
- ✅ **Shipping Docs não tem campo específico.** O campo "Consolidation Point" que aparece nessa etapa no Figma é **erro de reuso do protótipo** — no Bubble a etapa tem apenas os campos padrão (Estimated date, Responsible, Completed on, Signed by, Attached documents).
- ✅ **Table information (cabeçalho do PL) é apenas visual/read-only** dentro do checklist. Toda a edição dos dados do PL (PL number, POD, Leader, Client(s) Reference, etc.) é feita **fora**, na lista de Pre-loading, pelo ícone de lápis — que reabre **o mesmo popup usado na criação**.

> ✅ **Agents — regra confirmada:** `Agent Brazil` e `Agent China` são o **mesmo cadastro `agents`**, filtrado pelo **local** ao qual o agente pertence — que é um **option set** (não é FK para `countries`), definido no cadastro do agente. O **`Carrier agent` também vem de `agents`**, filtrado com base no(s) agente(s) já selecionado(s): existe uma **tabela `carriers`** no Bubble que faz o vínculo carrier ↔ agent. `Contact Brazil` e `Contact China` vêm dos **contatos vinculados ao agente** escolhido (via `agent_contacts`), não da lista solta de `contacts`.

> ⚠️ **Impacto no modelo de `agents` (seção 3.5.4):** o campo "local" ser um **option set** significa que `agents` precisa de uma coluna enum própria (ex.: `location`), e **não** apenas o `country_id` que estava modelado. Ver ajuste em 3.5.4 e a nota sobre `carriers` abaixo.

```sql
-- ⚠️ MODELO UNIFICADO — ver nota abaixo
-- O checklist é ÚNICO e contínuo: as 7 etapas do Pre-loading e as 7 do Shipment
-- pertencem à mesma entidade (o PL/embarque), não a duas entidades separadas.
create table public.pre_loading_checklist_steps (
  id                     uuid primary key default gen_random_uuid(),
  pre_loading_id         uuid not null references public.pre_loadings(id) on delete cascade,
  step                   public.checklist_step not null,   -- consolidation_point .. delivered (#11–24)
  done                   boolean not null default false,  -- espelho de (completed_on IS NOT NULL); conclusão real = isStepChecked (3.7.5). Sem toggle manual nesta tela
  estimated_date         date,
  responsible_id         uuid references public.profiles(id),
  completed_on           date,
  signed_by_id           uuid references public.profiles(id),
  notes                  text,                                  -- campo de texto aberto (visto na etapa Original Docs)

  -- campos específicos por etapa (preenchidos conforme o `step`)
  consolidation_point_id uuid references public.factories(id),  -- etapa Consolidation Point
  city_id                uuid references public.cities(id),     -- etapa City
  pol_id                 uuid references public.pols(id),       -- etapa Port of Loading
  carrier_agent_id       uuid references public.agents(id),     -- etapa Agents
  agent_brazil_id        uuid references public.agents(id),     -- etapa Agents
  agent_china_id         uuid references public.agents(id),     -- etapa Agents
  contact_brazil_id      uuid references public.contacts(id),   -- etapa Agents
  contact_china_id       uuid references public.contacts(id),   -- etapa Agents
  booking_number         text,                                  -- etapa Booking

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (pre_loading_id, step)
);
create trigger trg_plcs_updated_at before update on public.pre_loading_checklist_steps
  for each row execute function public.set_updated_at();
```

> ✅ **Checklist ÚNICO e contínuo — confirmado.** As etapas #11–24 (7 do Pre-loading + 7 do Shipment) pertencem ao **mesmo checklist**, ancorado no `pre_loading_id`. **Não existe uma tabela separada de checklist para Shipment.** Motivo estrutural confirmado com o cliente: quando um Pre-loading vira Shipment, ele **deixa de aparecer na lista de Pre-loading** — a tela de Shipment passa a ser o único lugar onde as informações do PL continuam acessíveis, por isso ela exibe a timeline completa das 14 etapas.
>
> 💡 Como Shipment é 1:1 com Pre-loading, ancorar tudo em `pre_loading_id` é suficiente. Se na implementação a tabela `shipments` for fundida em `pre_loadings` (ver nota em 3.10.1), o checklist já estará no lugar certo.

> ⚠️ **Decisão de modelagem a revisar:** os campos específicos estão como colunas nullable na mesma tabela (esparsas — só uma etapa usa cada). Alternativa: tabela de detalhe por etapa ou coluna `jsonb payload`. A forma acima é mais legível e tipada; a esparsidade é aceitável dado que são 7 etapas fixas.

#### 3.9.6 Confirmação → Shipment ("Confirm Shipping")

- Enquanto o checklist não está completo, o botão de confirmação fica **desabilitado**. Quando **todas as 7 etapas estão concluídas** (✓ verde), ele libera.
- Ao clicar, abre o modal de criação do Shipment com:
  - `Signer` (obrigatório) e `Loading Date` (obrigatório)
  - ✅ **`Container Number`** e **`Shipment Model`** — confirmados como preenchidos **aqui**, no momento da conversão PL → Shipment (não em nenhuma etapa do checklist). O `Carrier` também é definido neste ponto ou herdado da etapa Agents (a confirmar).
  - Tabela: **Factories** | **Categories** | **ETD Initial** (✅ **read-only** — exibe o `initial_date` preenchido na etapa ETD da Order; aparece vazio se ainda não foi preenchido lá) | **PO Nº / Batch Nº** | **Status** (dropdown por linha: **None / Partial / Total**)
- ✅ Cada linha é uma entrada `order_factory_category`. Após atribuir o status a **todas** as linhas e confirmar:
  - Entradas **Total** → seguem no lote atual, que vai para `in_transit`
  - Entradas **Partial/None** → migram para o próximo lote (existente ou **criado na hora**), que nasce em `in_production` — ver regra completa em 3.7.2
- O lote original segue `in_transit` → `delivered`.



```
auth.users ──1:1── profiles ──N:1── roles ──1:N── role_permissions (CRUD por módulo)
                      │                    └─1:N── role_step_denies (deny por etapa — proposta)
                      └── company (enum BR/China)

countries ──1:N── clients
countries ──1:N── agents ──M:N── contacts   (agent_contacts)
countries ──(usado por)── cities ──M:N── pols   (city_pols)

categories ──M:N── factories   (category_factories)

── BLOCO TRANSACIONAL ──
orders ──N:1── clients, order_types, business_units, exporters
orders ──N:1── profiles (requester, leader)
orders ──1:N── batches
orders ──1:N── order_factory_category ──N:1── categories, factories
                      │                └──N:1── batches
                      └──1:1── etd_info ──1:N── etd_history
                                  └── dispatch_location → factories
orders ──1:N── order_checklist_steps ──1:N── step_attachments
orders.status = rollup(batches.status)

ETD Factories = VIEW read-only sobre order_factory_category + etd_info

pods · carriers  (referenciados por Shipments — Bloco 4)
```

---

### 3.10 Bloco Shipments — shipments + checklist

**Origem Bubble:** telas Shipments (lista, filtros, checklist). **Fonte:** prints do **Bubble em produção**.
**Descrição:** o **Shipment** é o embarque efetivo. Nasce automaticamente da confirmação de um Pre-loading ("Confirm Shipping") e percorre as 7 etapas finais do fluxo (#18–24 do enum `checklist_step`, fase `shipment`), até `Delivered`.

#### 3.10.1 shipments

> ✅ **Regras estruturais confirmadas:**
> - **Relação 1:1 com Pre-loading** — cada PL confirmado gera exatamente um Shipment.
> - **Não tem número próprio:** o Shipment **herda o `pl_number`** do Pre-loading que o originou (exibido como `PL- 1352` na lista).
> - **Sem criação manual e sem edição:** não existe botão "Create" (consistente com a regra antiga de RBAC "Shipments não tem Create") nem ação de editar. Clicar numa linha leva **direto ao checklist**.

**Colunas da lista:**

| Coluna | Origem |
|---|---|
| PL Number | `pre_loadings.pl_number` (herdado) |
| Client | Clientes do PL — **múltiplos** (ex.: "Valflex, JP4"; "AGK, Figaro, Magnetron") |
| Order Type | Tipos das Orders envolvidas — **múltiplos** (ex.: "Sales, Samples") |
| POL | Da etapa Port of Loading do PL |
| **Ship Model** | `shipment_model_id` → **`shipment_models`** (Courier, Air, Hand Carrier, FCL) |
| Loading Date | Da etapa Loading Date do PL |
| Ship Date | Da etapa Shipping Date (#18) — ⚠️ campo exato a confirmar no checklist. Aparece vazio quando a etapa ainda não foi concluída. |
| ETA | Da etapa ETA Brazil (#22) — ⚠️ idem. |
| Sum of Orders | ✅ **Soma de lotes** — apesar do rótulo dizer "Orders", o número contado são os lotes. _(O usuário prefere ver como "POs"; manter o rótulo, mas a contagem é de lotes.)_ |
| Status | ✅ **3 valores: `In Transit`, `Delivered` e `Canceled`.** Reflete o status dos lotes do embarque. _(Print do Bubble mostra In Transit e Delivered em uso; `canceled` confirmado pelo cliente como status válido do Shipment.)_ |

✅ **Ordenação:** hoje disponível apenas em **PL Number** e **Loading Date**. _(Limitação herdada do Bubble, onde ampliar exigiria refatorar o banco. Na versão nova em Postgres isso deixa de ser um obstáculo — a ordenação pode ser estendida a todas as colunas sem custo estrutural.)_

✅ **Order Type múltiplo:** um mesmo embarque pode conter lotes de tipos de pedido diferentes (ex.: "Sales, Samples"), daí a coluna exibir vários valores.

##### ⚠️ Exclusão de Shipment — regra definida

Ação disponível na lista: apenas **excluir** (ícone de lixeira). Regra acordada:

- **Soft delete em cascata lógica:** ao excluir um Shipment, marcam-se como inativos (`deleted_at`) o Shipment, o Pre-loading vinculado e **toda a cadeia até os lotes**. Nada é apagado fisicamente.
- ⚠️ **Ponto em aberto que precisa de decisão:** "inativar até os lotes" significa que os **lotes saem de circulação**. Mas os lotes pertencem a uma **Order que continua existindo** — e a Order pode ficar sem nenhum lote ativo, o que quebra o rollup de status (seção 3.7.1). Cenários a definir com o cliente:
  1. Os lotes voltam para um status anterior (ex.: `in_production`) e ficam disponíveis para um novo Pre-loading? — provavelmente o comportamento desejado, já que a mercadoria não deixou de existir.
  2. Os lotes são realmente inativados e a Order fica "órfã"?
  3. A exclusão só é permitida em certos status (ex.: antes de `in_transit`)?
- **Recomendação:** tratar a exclusão de Shipment como um **"desfazer o embarque"** — reverter os lotes para o status anterior ao Pre-loading em vez de inativá-los. Isso preserva a integridade do fluxo e evita Orders sem lotes. Validar com o cliente.

```sql
create table public.shipments (
  id                  uuid primary key default gen_random_uuid(),
  pre_loading_id      uuid not null unique references public.pre_loadings(id),  -- 1:1; pl_number vem daqui
  shipment_model_id   uuid references public.shipment_models(id),
  carrier_id          uuid references public.carriers(id),     -- "Carrier on the shipment"
  container_number    text,
  status              text not null default 'in_transit',      -- 'in_transit' | 'delivered' | 'canceled'
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id)
);
create trigger trg_shipments_updated_at before update on public.shipments
  for each row execute function public.set_updated_at();
```

> ✅ **Transição para `delivered`:** quando a etapa **Delivered (#24)** do checklist é concluída, dois efeitos ocorrem em conjunto: **todos os lotes** do embarque passam para `batch_status = 'delivered'` **e** o `shipments.status` passa para `delivered`. Implementar como trigger ou função transacional para garantir atomicidade.

> 💡 **Nota de modelagem:** como a relação é 1:1 e o Shipment herda o número do PL, uma alternativa seria **não criar tabela separada** e apenas adicionar as colunas de shipment em `pre_loadings` (com um flag `shipping_confirmed_at`). A tabela separada acima foi escolhida por clareza semântica e porque o Shipment tem campos próprios (container, carrier, ship model) — mas vale reavaliar na implementação se a simplificação compensa.

#### 3.10.2 Filtros da lista de Shipments

Busca por **PL number**. Modal "Filters" com 5 grupos:

| Grupo | Campos |
|---|---|
| **Basic information** | `Client` (busca por nome) |
| **Business details** | `Status Shipment` (dropdown) · `Leader` (dropdown) · `Orders` (múltiplo, "Type some Orders") · `Order Type` (dropdown) |
| **Involved agents** | `Agent Brazil` · `Agent China` (busca) |
| **Production Details** | `Carrier on the shipment` (dropdown) · **`Container Number`** (texto livre) · `Consolidation Point` (dropdown) · `POL` · `POD` · `Shipment Model` |
| **Date Ranges** (todos de/até) | `Loading date` · `Ship Date` · **`BL Date`** · `ETA` · `ATA` · `Delivered` |

Ações: **Clear filters** e **Filter**.

> Observação: os filtros revelam campos que a lista não exibe — **Container Number** e **BL Date** — confirmando que existem como dados do Shipment (preenchidos nas etapas do checklist).

#### 3.10.3 Detalhe do Shipment (Table information)

Ao clicar numa linha da lista, cai direto no detalhe/checklist. O cabeçalho **"Table information"** (read-only, "Informational data for consultation") tem 3 blocos:

| Bloco | Campos |
|---|---|
| **Shipping Information** | PL Number · Container Number · Client · Shipment leader · Business unit (múltiplo, ex.: "HA, Moto") · Order type (múltiplo, ex.: "Sales, Samples") · Total orders · Status |
| **Logistics & Transportation** | Consolidation point · Shipment Model · Agent Brazil · Agent China · Carrier |
| **Data & Ports** | Loading date · Shipment date · Port of loding [sic — typo de UI] · POD · ETA Brazil · ATA Brazil · **Delivery date** (= `completed_on` da etapa Delivered #24) |

**Batches in shipment container** — tabela dos lotes do embarque:

| Coluna | Conteúdo |
|---|---|
| Client | Cliente do lote |
| PO Number . Batches | Ex.: `1488 .01`, `1487 .01` |
| Order date | Data do pedido |
| Factories | **Tags** com as fábricas envolvidas (ex.: `Wenxin`; `Aideli` `Tongqing` `Baixin`) |
| _(ação)_ | Botão **"View parts"** — abre modal (ver abaixo) |

##### Modal "View parts"

Abre a partir de cada linha da tabela de batches. Mostra o **status de carregamento por entrada Factory × Category** daquele lote:

- Cabeçalho: **PO number** (read-only, ex.: `1487 .01`)
- Tabela: **Factory** | **Category** | **Part** (dropdown: **Total / Partial / None**)
- Ações: **Cancel** e **Save**

> ✅ **Descoberta importante:** os status Total/Partial/None **continuam editáveis depois** da criação do Shipment — não são atribuídos apenas uma vez no modal de "Confirm Shipping". O botão **Save** persiste alterações.
>
> ⚠️ **Consequência a definir:** se a regra de split (Partial/None → gera novo lote, ver 3.7.2) roda na confirmação do Pre-loading, o que acontece quando um status é **alterado aqui, depois**? Cenários:
> 1. Muda de `Total` → `Partial`: precisa criar um lote novo retroativamente?
> 2. Muda de `Partial` → `Total`: o lote que foi criado pelo split deve ser removido/esvaziado?
>
> Sem regra definida, editar aqui pode gerar lotes órfãos ou inconsistência no rollup de status da Order. **Precisa ser validado com o cliente** — ver seção 8.

#### 3.10.4 Checklist do Shipment — timeline completa (14 etapas)

> ✅ **Não existe checklist próprio de Shipment.** A tela exibe o **mesmo checklist contínuo** do Pre-loading, com as **14 etapas** (#11–24). As 7 primeiras (fase preloading) aparecem já concluídas ✓; as 7 seguintes (fase shipment) são preenchidas aqui. Ver modelagem unificada em 3.9.5.

**Motivo estrutural:** quando um Pre-loading é confirmado e vira Shipment, ele **sai da lista de Pre-loading**. A tela de Shipment passa a ser o único ponto de acesso às informações daquele PL — daí exibir a timeline inteira.

| # | Etapa | Campos |
|---|---|---|
| 11–17 | Consolidation Point · City · Port of Loading · Shipping Docs · Agents · Booking · Loading Date | Herdadas do PL, exibidas concluídas ✓ (ver 3.9.5) |
| 18 | Shipping Date | Padrão. Alimenta "Ship Date" na lista e "Shipment date" no header |
| 19 | BL | Padrão + anexos (Bill of Lading) |
| 20 | Original Docs | Padrão + anexos + **campo de texto aberto** (observações) |
| 21 | Inspection Report | Padrão + anexos |
| 22 | ETA Brazil | Padrão. Alimenta "ETA" na lista |
| 23 | ATA Brazil | Padrão. Chegada efetiva |
| 24 | Delivered | Padrão. Etapa final — ao concluir, os lotes vão para `delivered` |

**Campos padrão de toda etapa:** `Estimated date` · `Responsible` · `Completed on` · `Signed by` · `Attached documents` (+ botão Attach).

✅ **Nenhuma etapa da fase Shipment tem campo específico próprio** além do texto aberto em Original Docs — diferente das etapas do Pre-loading (que têm Consolidation Point, City, POL, Agents, Booking number).

##### Regras de edição e conclusão — confirmadas

- ✅ **Etapas #11–17 (fase Pre-loading) são READ-ONLY aqui.** Aparecem apenas para consulta — toda a edição delas acontece enquanto o PL ainda está na tela de Pre-loading. Depois de confirmado, não há mais edição dessas etapas.
- ✅ **Etapas #18–24 (fase Shipment) são editáveis** nesta tela.
- ✅ **`Delivery date` no header** vem do `completed_on` da etapa **Delivered (#24)**.
- ✅ **Ao concluir a etapa "Delivered" (#24):**
  - **todos os lotes** do embarque passam para `delivered`
  - o **status do Shipment** passa para `Delivered`
  - a esteira daquele embarque encerra
- ⚠️ **Bug conhecido no Bubble:** no print, a etapa "Port of Loading" aparece concluída ✓ mas com o campo `Port of Loading` **vazio** ("Select Port of Loading"). Confirmado com o cliente que **isso é um erro** — deveria estar preenchida. Reforça a pendência sobre o gatilho de conclusão: hoje a etapa pode ser marcada como concluída sem os campos obrigatórios preenchidos. **Na versão nova, validar antes de permitir a conclusão.**
- ⚠️ **Anexos:** não confirmado se são obrigatórios em alguma etapa (ex.: BL, Original Docs, Inspection Report parecem candidatos naturais). Ver seção 8.

> Observação sobre os ícones: verde ✓ = concluída · azul ● = pendente/atual (visto em ATA Brazil e Delivered, ainda sem `Completed on` preenchido).

---

### 3.11 Mapa de relações (Blocos 1–4)

```
auth.users ──1:1── profiles ──N:1── roles          (RBAC simplificado: admin | user)
                      └── company (enum BR/China)

── CADASTROS ──
countries ──1:N── clients
countries ──1:N── agents ──M:N── contacts   (agent_contacts)
agents ──M:N── carriers   (carrier_agents)   ← base do filtro "Carrier agent"
agents.location = option set (brazil/china)
cities ──M:N── pols   (city_pols)
categories ──M:N── factories   (category_factories)
shipment_models · pods · business_units · order_types · exporters

── ORDERS ──
orders ──N:1── clients, order_types, business_units, exporters
orders ──N:1── profiles (requester, leader)
orders ──1:N── batches ──(split)──> batches   (split_from_batch_id)
orders ──1:N── order_factory_category ──N:1── categories, factories
                      │                └──N:1── batches   (batch_id mutável — migra no split)
                      │                └── loading_status (total/partial/none)
                      └──1:1── etd_info ──1:N── etd_history
                                  └── dispatch_location → factories
orders ──1:N── order_checklist_steps ──1:N── step_attachments
orders.status = rollup(batches.status)   — ver tabela de precedência em 3.7.1

── PRE-LOADING & SHIPMENT ──
pre_loadings ──M:N── clients   (pre_loading_clients)
pre_loadings ──M:N── batches   (pre_loading_batches)
pre_loadings ──N:1── pods, profiles (leader, responsible_signer)
pre_loadings ──1:N── pre_loading_checklist_steps   ← CHECKLIST ÚNICO (14 etapas #11–24)
                          ├── consolidation_point → factories
                          ├── city → cities · pol → pols
                          ├── carrier_agent / agent_brazil / agent_china → agents
                          └── contact_brazil / contact_china → contacts
pre_loadings ──1:1── shipments ──N:1── shipment_models, carriers
     └── PL confirmado sai da lista de Pre-loading; passa a ser visto só em Shipments

── VIEWS ──
ETD Factories = VIEW read-only sobre order_factory_category + etd_info + batches
To do list    = VIEW read-only sobre order_checklist_steps + pre_loading_checklist_steps
                (filtro: responsible = usuário logado E completed_on IS NULL)
```

---

### 3.12 Bloco Auxiliares — Login e To do list

**Origem Bubble:** telas Login (autenticação) e To do list. **Fonte:** cards de documentação + guias.

#### 3.12.1 Login / Autenticação

**Descrição:** porta de entrada do sistema. No Bubble, tudo (login, reset de senha, sessão) é nativo. Na migração, **o Supabase Auth cobre a mesma mecânica nativamente** — não é reconstrução, é configuração.

**Mapa de tradução Bubble → Supabase Auth:**

| Regra (Bubble hoje) | Equivalente Supabase Auth |
|---|---|
| Login e-mail + senha | `supabase.auth.signInWithPassword()` |
| Senha com hash | Gerenciado pelo Auth (nunca guardar senha em tabela própria) |
| "Stay logged in" — sessão de **7 dias** | Config de expiração de sessão/JWT no projeto Supabase |
| "Forgot password" → e-mail com link | `supabase.auth.resetPasswordForEmail()` |
| Token na URL do link | Token de recovery gerado pelo Auth |
| Link expira em **24h** | Config de expiração do link de recovery |
| "Update password" com token | `supabase.auth.updateUser({ password })` |
| Redireciona pós-login → **Orders** | Regra da aplicação (rota inicial autenticada) |
| Usuário logado que abre Login → vai pro app | Guard de rota na aplicação |

**Regras de negócio confirmadas (preservar):**
- Sessão persiste **7 dias**.
- Link de reset expira em **24h**; e-mail não cadastrado retorna erro (não envia).
- Senha: **mínimo 8 caracteres** (libera o "Update password"); medidor de força (weak/good/strong) é **informativo, não bloqueia**.
- Destino pós-login: rua **Orders**.
- Interface 100% em inglês.

> **Envio de e-mail:** hoje é o disparo nativo do Bubble. Na migração, começar pelo **SMTP padrão do Supabase Auth** e, futuramente, plugar um **provedor dedicado de disparo** (SendGrid, Resend, AWS SES, etc.) quando o cliente decidir. É configuração de infra, não bloqueia o build. _(Decisão do provedor final: pendente — ver seção 8.)_

> **Sem tabela nova.** Login não gera entidade — usa `auth.users` (Supabase) + `profiles` (já modelada em 3.1). O medidor de força é lógica de frontend.

#### 3.12.2 To do list

**Descrição:** lista das **tarefas pendentes do usuário logado** — etapas de checklist (de Orders, Pre-loading e Shipment) que ainda não foram concluídas e são de responsabilidade dele. É uma **VIEW read-only**, não tabela nova.

**Regras confirmadas:**
- ✅ **Escopo:** apenas tarefas do **usuário logado** (`responsible_id = current user`), não do time inteiro.
- ✅ **Critério:** apenas etapas **não concluídas** (`completed_on IS NULL`).
- ✅ **View (por linha):** é **somente leitura e navega** — leva o usuário à página do checklist correspondente (Order / PL / Shipment), onde a conclusão de fato acontece. Não edita nada na própria To do list.
- ✅ **Download XLS:** **cortado** (segue a decisão global; não é uma das 3 exceções).
- Colunas: PO number, PL number, Step, Status PO, Responsible, Date preview, Client.
- Filtros: Client, Responsible, Status, Step, Date Preview (range).
- Interface 100% em inglês.

> As "abas Inbox/Pre-loading/Shipment" citadas em documentação antiga do MD **não existem** no design atual — a lista é única.

> ✅ **Filtro de status terminal (implementação, 2026-08-06):** além de `completed_on IS NULL` + responsável, a lista **omite** etapas cujo registro já encerrou a esteira — Order `delivered`/`canceled` e Shipment `delivered`/`canceled`. Sem isso, ~982 etapas de pedidos/embarques já finalizados (buracos da migração Bubble→Supabase, sem `completed_on`) apareciam como tarefas falsas. Etapas de embarques ainda `in_transit` continuam listadas. É filtro de **exibição** — não altera dado. Ver `TERMINAL_STATUS` em `app/(dashboard)/todo/page.tsx`.

```sql
-- To do list: VIEW read-only sobre as etapas de checklist pendentes do usuário.
-- Combina as etapas de Orders e de Pre-loading/Shipment.
-- create view public.todo_list_view as
--   select o.po_number, null::text as pl_number, s.step, o.status as status_po,
--          s.responsible_id, s.estimated_date as date_preview, o.client_id
--   from public.order_checklist_steps s
--   join public.orders o on o.id = s.order_id
--   where s.completed_on is null
--   union all
--   select o.po_number, pl.pl_number, s.step, /* status do PL */ null, s.responsible_id,
--          s.estimated_date, /* client via pre_loading_clients */ null
--   from public.pre_loading_checklist_steps s
--   join public.pre_loadings pl on pl.id = s.pre_loading_id
--   -- ... joins conforme necessidade
--   where s.completed_on is null;
-- Filtro de aplicação: responsible_id = auth.uid()
```

> ⚠️ A VIEW acima é um esqueleto — a forma exata (colunas de PL/Order, como resolver client e status em cada ramo) se define na implementação. O que está **confirmado** é a regra: pendentes (`completed_on IS NULL`) do usuário logado, read-only, com navegação para o checklist.



O sistema **não** usa um simples flag admin. É um **RBAC (Role-Based Access Control)** de duas camadas:

---

## 4. Sistema de permissões (RBAC)

> ✅ **SIMPLIFICADO — decisão confirmada.** A matriz completa (Access/Create/Edit/Delete × módulo) foi avaliada como **over-engineering** para a necessidade real. O sistema precisa distinguir apenas **dois papéis**.

**Modelo adotado — dois papéis:**

| Papel | Permissões |
|---|---|
| `admin` | Acesso total. Pode cadastrar novas informações, executar deletes adicionais, e é o **único** que pode criar/editar usuários e papéis. |
| `user` | Acesso operacional ao fluxo (Orders, Pre-loading, Shipments, cadastros). |

**Camada 2 — Filtros de etapas por papel** ("Profile Filters for Steps", rua 25)
Independente da simplificação acima, ainda existe a ideia de controlar **quais etapas do checklist** cada perfil enxerga/edita. 🔴 **Regra ainda não definida — aguardando validação do cliente** (ver seção 8). Como agora só há dois papéis, essa camada pode acabar sendo desnecessária ou virar uma configuração simples por etapa.

**Como isso vira acesso real no app:**
- **Nesta fase:** imposto na **camada de aplicação** (Vercel Functions / API routes). Ver seção 7.
- No frontend: esconder/desabilitar botões conforme o papel (ex.: `user` não vê botões de exclusão restritos a admin).
- ⚠️ A checagem de UI é **cosmética** — a mesma regra precisa ser imposta no servidor, senão é contornável.

> 💡 **Recomendação de implementação:** manter `profiles.role_id` → tabela `roles` (com dois registros: admin e user) em vez de um boolean `is_admin`. Custo idêntico hoje, mas permite reintroduzir papéis granulares no futuro sem migração de schema. As tabelas `role_permissions` (Camada 1) e `role_step_denies` (Camada 2, deny por etapa) ficam **modeladas mas não populadas/usadas** nesta fase — documentadas em 3.3 e 3.7.5 como referência caso a granularidade volte a ser necessária.

---

## 5. Fluxos de negócio

_Documentados por bloco. Bloco 1 (Auth & Perfil) coberto nas seções 3–4. Próximos blocos entram aqui._

### 5.1 Melhorias viabilizadas pela migração

Limitações do Bubble que **deixam de existir** em Postgres/Supabase e podem ser corrigidas sem custo estrutural. Não são requisitos — são oportunidades a validar com o cliente:

- **Ordenação de colunas:** hoje as listas ordenam por poucos campos (ex.: Shipments só por PL Number e Loading Date) porque ampliar isso no Bubble exigiria refatorar o banco. Em Postgres, ordenar por qualquer coluna é trivial — pode ser estendido a todas as listas.
- **Ordem sequencial das etapas do checklist:** hoje não é imposta (ver 3.7.5), embora seja o comportamento pretendido. Fácil de garantir na aplicação nova.
- **Validação ao concluir etapa:** hoje é possível marcar uma etapa como concluída com campos obrigatórios vazios (caso confirmado: "Port of Loading" ✓ sem POL selecionado). Impor validação evita esse tipo de inconsistência.
- **Campos calculados (Days Delay, Gap of Ready):** podem virar colunas de VIEW em vez de cálculo no frontend, ganhando consistência e permitindo ordenar/filtrar por eles.

---

## 6. Integrações externas

_Pendente. Já observado: envio de e-mail (convite de novo usuário, reset de senha) e exportação XLS (Shipments). Detalhar no bloco correspondente._

### 6.1 Copilot "Lapha" (API da Anthropic) — escopo confirmado 13/08/2026

Assistente dentro do SOT que responde perguntas sobre os dados do sistema. **Nome na interface: "Lapha"** (decidido em 13/08/2026), com ícone de robô na sidebar e no cabeçalho do painel. No código a coisa continua se chamando copilot — rota `/api/copilot`, `lib/copilot/`, `domain/copilot/` — porque renomear caminho não muda comportamento e quebraria links.

**Decisões do cliente:**

- ✅ **Somente leitura.** Não grava nada: consulta, resume, cruza e aponta pendências. Qualquer ação de escrita fica para uma fase futura, se houver.
- ✅ **Fonte única: o banco**, através de ferramentas tipadas por família de pergunta (Orders, ETD, Pre-loading, Shipments, pendências, agregados). O modelo **não** escreve SQL — escolhe ferramenta e parâmetros.
- ❌ **Leitura de anexos fora do escopo.** Descartada depois de dimensionado o custo (extração/OCR + `pgvector`, que não está instalado). `step_attachments` guarda só `file_path`/`file_name`.
- ✅ **Superfície:** painel lateral global, com o contexto da tela em que o usuário está. **Implementação (13/08/2026):** o acesso é um item **"Copilot" na sidebar esquerda** (mesmo visual dos itens Orders/Pre-loading); ao clicar, abre um **painel flutuante pela direita** (overlay, não empurra o conteúdo), que fecha no X ou clicando o item de novo. O copilot **espelha as telas** — ex.: "PLs abertos" usa a mesma regra da tela Pre-loading (o PL só sai quando a etapa Loading Date está concluída **e** já há embarque). _(Contexto da página atual: ainda pendente — a rota hoje só recebe as mensagens.)_
- ✅ **Resposta em streaming**, escrita ao vivo, e resultados renderizados como **linhas do próprio SOT** (clicáveis, navegando para a Order/lote/PL) — pouco texto corrido, muito dado. Não é uma janela de chat genérica. **Implementação (13/08/2026):** a rota emite o resultado estruturado de cada ferramenta como evento SSE (`type: "result"`) e o cliente o renderiza como tabela de linhas clicáveis (colunas = o que a ferramenta já curou; a linha navega para `/orders/[id]`, `/pre-loading/[id]` ou `/shipments/[id]`). O modelo escreve **só prosa curta** — não digita tabela markdown nem imprime ids (por isso não há dependência de markdown no projeto). _Renderização rica de `get_order_detail` (retrato de 1 PO) ainda é prosa; vira linhas depois._
- ✅ **Autorizado** o tráfego de dados do SOT para a API da Anthropic (conta AGK).

**Invariante de segurança (não negociável):** toda leitura do copilot passa por `verifySession()` / `requireFeature()` do `lib/dal.ts`. O copilot enxerga **exatamente** o que o usuário logado enxergaria nas telas — nem uma linha a mais. As tabelas seguem em RLS deny-all e todo acesso sai pelo `createAdminClient()`, então não existe segunda linha de defesa no banco: a checagem na camada de aplicação é a única (ver §4 e §11/A01).

**Definição de "atrasado" (13/08/2026):**

- ✅ **ETD — confirmado:** a entrada está atrasada quando **`Days Delay > 0`**, com `Days Delay` já em valor absoluto (§3.7.4). Ou seja: qualquer desvio entre `initial_date` e `current_date`, nos dois sentidos, conta como atraso; desvio zero e entrada sem uma das datas não contam.
- ⚠️ **Etapa de checklist — assumido, a confirmar:** `estimated_date` anterior à data de hoje e `completed_on` nulo. Mesmo critério que a To do list já usa para listar pendências (§3.12.2), somado ao vencimento da data prevista.

**O copilot não tem lista fechada de perguntas.** As ferramentas são parametrizadas (cliente, fábrica, categoria, status, responsável, período, faixa de atraso) e o modelo as combina livremente, então o espaço de perguntas é combinatório. O limite real é a **superfície de dados exposta**: uma pergunta sobre dado que nenhuma ferramenta alcança recebe "não tenho acesso a isso", nunca uma resposta inventada. A lista de perguntas levantada com o cliente serve para **calibrar** quais filtros cada ferramenta precisa ter e como teste de aceitação — não como allowlist.

#### Estado da implementação (13/08/2026)

Em produção a partir deste deploy. Peças: `app/api/copilot/route.ts` (rota SSE), `lib/copilot/client.ts` (modelo, system prompt, execução de ferramenta), `domain/copilot/tools.ts` (as 7 ferramentas), `components/copilot/` (painel e renderização das linhas).

- **Modelo:** `claude-opus-5`, com `output_config.effort: "medium"` e teto de 16k tokens por resposta (o teto cobre thinking + texto — no Opus 5 o thinking é adaptativo e vem ligado por padrão). Máximo de 8 rodadas de ferramenta por pergunta.
- **Ferramentas (8):** `resolve_entities`, `search_orders`, `get_order_detail`, `list_etd_entries`, `list_pre_loadings`, `search_shipments`, `trace_chain`, `list_pending_steps`. Cada uma declara a `feature` exigida; a rota só oferece ao modelo as que o usuário pode ver **e** revalida antes de executar.

##### Travessia da cadeia (13/08/2026)

As ferramentas nasceram espelhando **uma tela cada**, e por isso o copilot enxergava cada nível isolado: sabia os lotes de uma order, mas não em qual PL o lote entrou. Perguntas que atravessam níveis — _"o PO 1437 está em quais PLs?"_, _"os lotes desse cara estão onde?"_, _"o que tem nesse container?"_ — não tinham resposta, embora o dado exista: a junção **`pre_loading_batches`** (2.814 linhas) liga lote↔PL, e o embarque pendura no PL.

- **`trace_chain`** percorre `Shipment ↔ PL ↔ Lote ↔ Order ↔ Factory×Category` a partir de **qualquer ponto** (número da order, lote, PL ou container) e devolve uma linha por lote com o PL, o embarque e as entradas Factory×Category daquele lote.
- **`get_order_detail`** passa a dizer, em cada lote, os PLs em que ele está e o embarque correspondente.
- **`list_pre_loadings`** e **`search_shipments`** ganham o filtro `po_number` e a coluna com as orders que cada PL/embarque carrega.
- **Busca por número prefere o exato**: "PO 1437" é a order 1437, não as que contêm "1437"; só cai no parcial quando o exato não existe.
- **Split:** a linha que migrou para um lote-filho conta para o lote de ORIGEM (o que embarcou), subindo a linhagem por `split_from_batch_id` — mesma conta da tela do embarque, senão um lote embarcado apareceria sem nenhuma fábrica.
- ⚠️ **A permissão continua valendo por nível:** PL e embarque só aparecem para quem tem as features `pre_loading`/`shipments`, e o conteúdo (as orders dentro do PL) só para quem tem `orders`. A travessia não pode virar a porta dos fundos para dado que a tela negaria. Por isso `hasFeature()` foi extraído para `domain/access/features.ts` — o `can()` do DAL delega para lá, e a camada de domínio checa permissão sem arrastar o `next/headers`.
- 🔑 **`ANTHROPIC_API_KEY` é obrigatória no ambiente** (server-side, nunca com prefixo `NEXT_PUBLIC_`). Fica **fora** do `lib/env.ts` de propósito: aquele módulo valida no import e é carregado por todo acesso a dados, então chave ausente derrubaria o app inteiro em vez de só o copilot. Sem a chave, a rota responde **503** e o resto do sistema segue normal. **Precisa estar cadastrada nas variáveis de ambiente da Vercel** — não basta o `.env.local`.
- ⚠️ **Pegadinha de dev (13/08/2026):** um `next dev` já rodando pode ficar com o manifesto de rotas velho e devolver **404 (página HTML de not-found) para todo `/api/*`** — inclusive rotas antigas como `/api/[resource]`. No copilot isso aparece como "Failed to reach the copilot", porque o cliente tenta ler JSON de uma página HTML. Não é bug de código: `rm -rf .next` e subir o dev de novo. Antes de investigar o copilot, confirmar com `curl -X POST /api/copilot` — a rota sã responde `401 {"error":"Not authenticated."}` sem cookie de sessão.

---

## 7. Controle de acesso — a validar com o cliente

> ✅ **Decisões tomadas** (ver abaixo). O sistema atual (Bubble) não usa RLS; a migração começa impondo permissões na **camada de aplicação**.

### Situação atual vs. Supabase

O Bubble tem servidor próprio entre front e banco. O Supabase **expõe o banco direto ao cliente** por padrão. Estratégias:

- **Sem RLS e sem servidor:** qualquer um com a chave `anon` lê/escreve tudo. Inaceitável em produção.
- **Opção A — camada de aplicação (curto prazo):** operações sensíveis passam por Vercel Functions / API routes que impõem o RBAC no servidor. React não fala direto com o Supabase em dados sensíveis.
- **Opção B — RLS (ideal):** o RBAC é traduzido em policies no banco. Mais seguro; permite o React falar direto com o Supabase.

✅ **Decisão: começar com a Opção A** (camada de aplicação), evoluir para RLS depois. Ver decisões detalhadas abaixo.

### Decisões confirmadas

| Questão | Decisão |
|---|---|
| **Onde impor o RBAC** | ✅ **Camada de aplicação** nesta fase (Vercel Functions / API routes). RLS fica para uma fase posterior. |
| **Granularidade do RBAC** | ✅ **Apenas dois papéis: `admin` e `user`.** A matriz CRUD × módulo é over-engineering para a necessidade real. Admins podem cadastrar novas informações e executar alguns deletes adicionais; users têm acesso operacional. |
| **Usuário `Blocked`** | ✅ **Perde acesso imediatamente** — a sessão ativa é encerrada, não apenas o próximo login é bloqueado. Implicação técnica: exige verificação de status a cada request (ou revogação ativa da sessão no Supabase Auth), não basta checar no login. |
| **Quem gerencia papéis** | ✅ **Apenas admins** podem criar/editar papéis e usuários. |

> ⚠️ **Nota sobre a simplificação do RBAC:** reduzir para `admin`/`user` resolve a necessidade atual e destrava o desenvolvimento. Mas se no futuro o cliente pedir permissões por módulo (ex.: "esse usuário vê Orders mas não Shipments"), a matriz precisará ser reintroduzida. Para não fechar essa porta, a recomendação é manter a coluna `role_id` em `profiles` apontando para uma tabela `roles` (mesmo que ela contenha só dois registros hoje) em vez de usar um boolean `is_admin` — assim a evolução para papéis granulares é aditiva, sem migração de schema.

### Perguntas ainda abertas

- [ ] **Segregação por Company (BR/China):** um usuário BR vê os dados (Orders, Shipments...) da China, ou cada empresa vê só os seus? **← decisão de arquitetura crítica, ainda pendente.**

---

## 8. Decisões pendentes do cliente

Lacunas onde o sistema tem a funcionalidade mas **falta a regra definida**. Não são dúvidas técnicas — precisam de decisão de negócio.

- [x] ✅ **Lista completa de módulos (RBAC) — NÃO É MAIS NECESSÁRIA.** Estava em 🔴 STANDBY desde o início do projeto, travada aguardando definição do cliente. Com a decisão de simplificar o RBAC para dois papéis (`admin` / `user`), a matriz CRUD × módulo deixa de ser implementada — logo a lista de módulos não precisa ser definida. A tabela `role_permissions` fica documentada mas não usada. Ver seções 4 e 7.
- [x] ✅ **Combinação das 2 camadas de permissão — resolvida por simplificação.** Com apenas dois papéis, não há matriz por módulo para combinar. Resta apenas a eventual Camada 2 (filtros de etapas), ainda aguardando definição do cliente.
- [ ] **Campos legados do User** (`profile` texto, `Conversion?`, `slug`): confirmar se algum ainda é usado antes de descartar. _(`hidden` confirmado EM USO — oculta usuário de listagens; `master` descartado — substituído por RBAC.)_
- [ ] **Contadores de pedidos do Client** (total/negotiation/production/shipped/delivered/canceled): derivar em tempo real (view/count) ou materializar em colunas com trigger? Agora que os status de pedido estão definidos (`order_status`), decidir na implementação. Recomendação inicial: **view/count derivado**, migrar para materializado só se houver problema de performance.
- [x] ✅ **Lista completa e ordenada das etapas do checklist — resolvida.** 24 etapas fixas em 4 fases (Order, Preloading, Shipment), confirmadas pelo cliente. Ver enum `checklist_step` completo em 3.7.5. _(Pendência aberta: se a ordem sequencial dentro da fase deve passar a ser imposta no sistema novo, já que hoje não é garantida no Bubble.)_
- [ ] **Orders — hard vs soft delete:** a doc do card Orders diz exclusão "irreversível / cannot be undone", o que **contradiz a política global de soft delete**. Decidir: Orders é exceção (hard delete real) ou segue soft delete como o resto? _(Provável que a doc seja anterior à decisão de soft delete — confirmar com cliente.)_
- [x] ✅ **Regra dos lotes Total/Partial/None e split de lote — resolvida.** Atribuída por entrada `order_factory_category` (não pelo lote inteiro) ao finalizar o Pre-loading. Partial/None gera ou alimenta um novo lote (nasce em `in_production`); o lote original segue até `delivered`. Ver 3.7.2 e 3.7.3. _(`batch_number` confirmado: sequencial `.NN` por pedido — ver acima.)_
- [x] ✅ **Rollup do status do pedido — resolvido** (planilha "StatusSOT" do cliente). Order tem enum próprio (`order_status`, 7 valores incluindo `canceled`), calculado a partir da combinação "todos" / "ao menos um" dos status dos lotes. Ver tabela de precedência em 3.7.1.
- [x] ✅ **Cancelamento — resolvido.** Existe status `canceled` tanto para Order quanto para Batch. Só é possível cancelar um lote enquanto ele está em `in_negotiation` ou `in_production` (usuário devolve o lote para um desses status antes de cancelar). Lote cancelado não é mais elegível para nenhuma operação.
- [x] ✅ **"Ship requirement" — resolvido.** Data especulativa/obrigatória de quando a fábrica precisa ter pronta a mercadoria daquela entrada Factory×Category; puramente informativa, sem gatilho automático. Ver 3.7.3.
- [x] ✅ **Ready / Inspection / Initial date / Current date / History / Dispatch location (ETD) — todos resolvidos.** Ready e Inspection são booleans simples. Initial date é preenchido manualmente pelo usuário, por linha; ao preencher, dispara Current date automaticamente (data de hoje). Dispatch location confirmado como FK → factories (o "China"/"Brazil" no print era mock de layout). History grava apenas o diff dos campos alterados. Ver 3.7.4.
- [~] 🟡 **Envio de e-mail (convite) — parcialmente resolvido (2026-08-13).** O **convite agora entrega via Resend** (API própria, contornando o SMTP do Supabase que ficou bloqueado por permissão de owner) — envio confirmado `delivered` no Gmail. Ver 3.1. **Falta para produção:** (a) `RESEND_API_KEY`/`EMAIL_FROM` nas env vars da **Vercel**; (b) **domínio verificado no Resend** (sair do `onboarding@resend.dev`, que só entrega ao dono da conta e cai em spam); (c) **Site URL + Redirect URLs** de produção no Supabase. **Reset de senha** ("Forgot password") ainda usa o e-mail nativo do Supabase — migrar para o mesmo caminho do Resend fica pendente.
- [x] ✅ **Fase 2 — Notificação ao cliente: decisões de PRODUTO resolvidas (2026-08-18).** As 4 pendências de produto que estavam parqueadas na 2.1 foram respondidas pelo responsável de negócio:
  1. **Convite:** o admin da AGK convida os usuários do cliente, **só por e-mail**, sem auto-cadastro. (Reusa o fluxo de convite existente — ver 3.1 e item de Resend acima.)
  2. **Início da notificação:** **só de `in_production` pra frente.** `in_negotiation` **não** notifica.
  3. **Unidade acompanhada:** **produto** (rótulo que o cliente lê) carregado **pelo status do lote** (gatilho técnico). Como `batch = Factory × Category`, hoje 1 lote ≈ 1 produto, então notificar por lote = notificar por produto. Regra à prova de futuro: quando a Fase 1.3 da integração trouxer múltiplos produtos por lote, o **gatilho continua sendo o status do lote** e o e-mail passa a **listar os produtos daquele lote** — sem retrofit. O e-mail é rotulado por produto + nº do pedido, **nunca** por "lote 04".
  4. **O que vale e-mail:** cada **transição de status do lote** (`batch_status`).
  5. **Vocabulário amigável (interno → cliente):** `in_production` → **Em produção** · `preloading` → **Pré-carregamento** · `in_transit` → **Em trânsito** · `delivered` → **Entregue**. `in_negotiation` não é exibido nem notifica.
  6. **Agrupamento:** **1 e-mail por avanço** (sem digest diário).
  7. **Visibilidade:** **todos os usuários do mesmo cliente enxergam todos os pedidos do cliente** — o escopo é o `client_id`, sem restrição por usuário individual.

  ✅ **CONSTRUÍDA em 2026-08-19** (migration `20260819140000`). O desparque foi decisão explícita do responsável: o acompanhamento por produto da Fase 1.3 ainda não existe, e a notificação foi pedida para funcionar já. **Risco aceito e registrado:** quando a 1.3 trouxer múltiplos produtos por lote, o gatilho continua no lote (era a regra à prova de futuro da decisão 3) e o que muda é a montagem do e-mail — hoje ele lista as categorias das entradas `order_factory_category` daquele lote, então o retrofit é no texto, não no mecanismo.

  **Arquitetura:**
  - **Captura em trigger SQL** (`trg_batches_notify_client` → `client_notifications`), não em código: `batches.status` é escrito em CINCO lugares e não há choke point. O trigger pega todos, inclusive UPDATE feito à mão no SQL Editor.
  - **Outbox**, não envio dentro do trigger: o Postgres não fala com a internet no meio de uma transação. A tabela guarda `from_status`/`to_status`, tentativas, erro e **os destinatários congelados no envio** — que é a matéria-prima do histórico de comunicação (2.2).
  - **Disparo pelo app, sem cron** (cron foi descartado como mecanismo): `syncOrderStatus` é o único ponto por onde os nove caminhos de escrita já passam, e agenda a drenagem com `after()` do Next 16 — depois da resposta, sem atrasar a ação do usuário.
  - `POST /api/notifications/dispatch` (segredo do cron) é a rede de segurança: status mudado fora do app, envio que falhou, ou conferência manual.
  - **`canceled` NÃO notifica.** O vocabulário aprovado tem quatro estados e nenhum é cancelamento; avisar cancelamento por e-mail automático é decisão que ninguém tomou. Adicionar é uma linha no trigger.
  - Usuário `blocked` não recebe (o link levaria a uma porta fechada); cliente sem usuário no portal sai da fila marcado como processado, em vez de reprocessar para sempre.
- [x] ✅ **Fase 2 — Identidade do cliente: CONSTRUÍDA (2026-08-19).** Papel `client`, `profiles.client_id`, convite com seletor de Client e portal `/portal` (route group `app/(client)/`). Detalhe em **3.2.1**; migration `20260819120000`. **Ordem obrigatória: aplicar a migration ANTES do deploy** — a tela Users passa a selecionar `client_id` e, sem a coluna, o PostgREST devolve erro que o `fetchAll` converte em lista vazia (a tela não quebra, fica *vazia*, que é pior de diagnosticar). Ainda em aberto nesta fase: exibir ou não datas de ETD ao cliente; idioma do portal (hoje segue o inglês do app, enquanto o vocabulário de e-mail da decisão 5 está em PT-BR); reenvio de convite.
- [ ] **Regra exata do medidor de força de senha** (limiares por comprimento + classes de caractere): proposta da Vista/pub a confirmar. Informativo, não bloqueia o build.
- [ ] 🔴 **Idioma da interface — CONTRADIÇÃO a resolver.** A documentação das telas (Blocos 1–5) diz que a UI é **100% em inglês**; a seção 9 (Stack técnica, trazida de outro projeto) diz **100% PT-BR + BRL + America/Sao_Paulo**. Só um pode valer para a interface. Confirmar com o cliente. _(Itens como moeda BRL e fuso provavelmente valem; o idioma da UI é o ponto em conflito.)_
- [ ] **Stack técnica (seção 9) — validar aderência ao Sotwise.** A seção foi trazida de um template/outro projeto e traz menções fora do domínio de logística (sparklines de preço/custo, parser NF-e, "Zesta"). Confirmar quais itens se aplicam de fato ao Sotwise. _(Núcleo — Next.js/Supabase/Vercel/Asaas — é coerente; os exemplos de domínio não.)_
- [ ] **Cardinalidade Factory × Category** e **City × POL:** confirmar M-N vs 1-N no merge do banco externo.
- [ ] **Business Unit sem status:** a doc não menciona Active/Blocked nem exclusão lógica para BU. Confirmar se soft delete se aplica (mantido por consistência).
- [x] ✅ **Download XLS — cortado do sistema todo.** A exportação para Excel foi removida de todas as telas (Agents, Contacts e quaisquer outras). Não implementar botões de exportação XLS. _(Decisão do cliente.)_
- [x] ✅ **"Download CSV" no topo da tela Orders - Checklist — é erro de design.** Resquício do Figma, não reflete decisão real. Confirmado com o cliente: não implementar. Segue a mesma decisão de corte de exportação acima.
- [x] ✅ **Download XLS na rua ETD Factories — MANTIDO (exceção confirmada).** Diferente das demais telas, o botão de exportação permanece especificamente na ETD Factories. _(Escopo — se respeita filtros e quais colunas exporta — ainda em aberto, ver abaixo.)_
- [x] ✅ **Download XLS na lista de Pre-loading — MANTIDO (exceção confirmada).** Segunda exceção à decisão global de corte de exportações.
- [x] ✅ **Download XLS na lista de Shipments — MANTIDO (exceção confirmada).** Terceira exceção à decisão global de corte. Exportações permanecem em: ETD Factories, Pre-loading e Shipments; cortadas em todas as demais telas.
- [ ] **Download XLS (ETD Factories) — escopo:** respeita os filtros/busca aplicados no momento? Exporta exatamente as 13 colunas da listagem ou um conjunto diferente?
- [x] ✅ **Regra de geração do `batch_number` — RESOLVIDA (print de produção).** É um sequencial simples `.NN` (`.01`, `.02`...) **por pedido**, começando em `.01` e resetando a cada pedido. Não tem relação com o PO. Ver 3.7.2. _(Corrige a leitura anterior errada de `NNNN .NN` independente do PO.)_
- [ ] **Rua ETD Factories — edição inline?** Confirmar se a tela permite editar os campos de ETD direto na linha (Initial date, Ready, Inspection) ou se é estritamente leitura, com toda edição feita na etapa "ETD" do checklist da Order.
- [ ] **"Order date" na rua ETD Factories:** confirmar se corresponde exatamente a `orders.date_po` ou é outra data.
- [x] ✅ **Relação `carriers ↔ agents` — resolvida.** A tabela `carriers` carrega o vínculo com `agents`; é isso que filtra o campo "Carrier agent" no Pre-loading. Modelado como `carrier_agents` (M-N) em 3.5.8. _(Cardinalidade exata a confirmar no merge do banco.)_
- [x] ✅ **Campo "local" do Agent — resolvido.** É um **option set** próprio (enum `agent_location`), distinto do `country_id`. Ver 3.5.4. _(Valores completos do option set a confirmar — assumido brazil/china.)_
- [x] ✅ **Contact Brazil / Contact China — resolvido.** Vêm dos contatos **vinculados ao agente** selecionado (`agent_contacts`), não da lista solta de `contacts`.
- [x] ✅ **`booking_status` — resolvido.** É **campo aberto** (texto livre), não enum.
- [x] ✅ **Exclusão de Pre-loading — resolvida.** Segue **soft delete**, como o resto do sistema.
- [x] ✅ **Filtros da lista de Pre-loading — resolvidos.** 11 campos em 4 grupos (Customer/Order data, Involved agents, Transport and logistics, Dates). Ver 3.9.2.
- [x] ✅ **Criação do Shipment a partir do Pre-loading — resolvida.** Não há "Set manually": o botão **"Confirm Shipping"** só habilita quando as 7 etapas do checklist estão concluídas. Ver 3.9.6.
- [x] ✅ **"Shipping Docs" com campo "Consolidation Point" — era erro do Figma.** No Bubble a etapa tem só os campos padrão.
- [x] ✅ **Table information do PL no checklist — apenas visual.** Edição só pela lista (ícone de lápis → mesmo popup da criação).
- [ ] ⚠️ **Conclusão de etapa no checklist do Pre-loading/Shipment:** não há toggle manual (diferente do checklist de Orders). Confirmar **qual gatilho marca a etapa como concluída** — o preenchimento de `completed_on`? **Evidência:** foi encontrada no Bubble uma etapa ("Port of Loading") marcada como concluída ✓ com o campo específico **vazio** — confirmado pelo cliente como erro. Ou seja, hoje o sistema permite concluir sem validar os campos. **Na versão nova, impor a validação.**
- [x] ✅ **Shipments — exclusão: soft delete em cascata lógica.** Excluir um Shipment inativa (soft delete) o Shipment, o Pre-loading e toda a cadeia até os lotes. Nada é apagado fisicamente.
- [ ] 🔴 **Exclusão de Shipment — destino dos lotes (CRÍTICO).** "Inativar até os lotes" deixa a Order potencialmente sem lotes ativos, quebrando o rollup de status. Definir: os lotes **voltam** a um status anterior (ex.: `in_production`) e ficam disponíveis para novo Pre-loading, ou são realmente inativados? **Recomendação:** tratar como "desfazer o embarque" — reverter os lotes em vez de inativá-los. Ver 3.10.1.
- [x] ✅ **Shipments — `container_number`, `shipment_model_id` e `carrier_id` — resolvido.** São preenchidos no **modal de "Confirm Shipping"** (conversão PL → Shipment), não em etapas do checklist. Ver 3.9.6.
- [x] ✅ **Checklist de Shipment — resolvido.** Não existe checklist próprio: é o **mesmo checklist contínuo** do Pre-loading (14 etapas, #11–24), exibido inteiro na tela de Shipment porque o PL some da sua própria lista após ser confirmado. Ver 3.9.5 e 3.10.4.
- [x] ✅ **"View parts" — resolvido.** Modal que exibe e **permite editar** o status Total/Partial/None por entrada Factory×Category do lote. Ver 3.10.3.
- [x] ✅ **Etapas do Pre-loading na tela de Shipment — read-only.** Só as etapas #18–24 são editáveis lá.
- [x] ✅ **Conclusão da etapa "Delivered" (#24) — resolvida.** Passa todos os lotes do embarque para `delivered` e o Shipment para status `Delivered`; encerra a esteira.
- [x] ✅ **`Delivery date` — resolvido.** Vem do `completed_on` da etapa Delivered (#24).
- [ ] 🔴 **Edição de Total/Partial/None APÓS a criação do Shipment (via "View parts") — CRÍTICO.** O modal permite alterar o status já atribuído. Definir o que acontece com a regra de split: mudar `Total` → `Partial` cria um lote novo retroativamente? Mudar `Partial` → `Total` remove o lote gerado? Sem regra, gera lotes órfãos e quebra o rollup de status.
- [ ] **Anexos — obrigatoriedade por etapa:** confirmar se alguma etapa exige anexo para ser concluída (candidatos: BL, Original Docs, Inspection Report). Somado à pendência geral de tipos/tamanho/exclusão.
- [ ] **Typo de UI:** "Port of loding" → "Port of loading" no header do Shipment.
- [ ] **Shipment Models (cadastro):** confirmar lista completa de valores (vistos: Courier, Air, Hand Carrier, FCL) e se tem campos além do nome.
- [ ] **Modelagem shipments 1:1 com pre_loadings:** avaliar na implementação se compensa manter tabela separada ou fundir as colunas em `pre_loadings` com um flag de confirmação.
- [ ] **Anexos (step_attachments):** tipos e tamanho de arquivo permitidos, e confirmação (popup) ao excluir um anexo já enviado de uma etapa do checklist.
- [ ] 🔴 **Profile Filters for Steps (rua 25) — escopo indefinido.** Lida a rua: é uma **deny-list por etapa** (regras fixas "Deny Step [etapa]"; adiciona-se quem fica **negado**). Nível confirmado **por perfil** (não por usuário — mas a UI atual do Bubble adiciona usuários, contradição a levar ao designer). **Indefinido se entra no MVP** — com RBAC simplificado (admin/user) pode ser redundante. Schema proposto `role_step_denies` em 3.7.5. Demais detalhes (efeito do deny, lista de etapas cobertas) só resolver se a rua for confirmada no escopo.

---

## 9. Stack técnica

- **Framework:** Next.js (App Router, React Server Components, TypeScript estrito).
- **Backend/DB:** Supabase (Postgres + Auth + Storage + Edge Functions + Realtime).
- **ORM/queries:** acesso via `@supabase/supabase-js` no client e `@supabase/ssr` para sessão no servidor. Para queries complexas e migrations, usar SQL direto + migrations versionadas (pasta `supabase/migrations`).
- **Estilo:** Tailwind CSS + shadcn/ui como base de componentes. Tokens de design conforme a seção de design do projeto.
- **Validação:** Zod em todas as fronteiras (forms, server actions, edge functions).
- **Forms:** React Hook Form + Zod resolver.
- **Tabelas/dados:** TanStack Table (listas com busca, filtros, seleção de colunas, paginação). _(Casa com o padrão de listagem recorrente do sistema — Orders, Pre-loading, Shipments, cadastros: busca + filtros + paginação de 10.)_
- **Gráficos:** Recharts (sparklines de variação de preço/custo, gráficos do dashboard).
- **Estado servidor:** TanStack Query onde houver fetch client-side; preferir Server Components/Server Actions sempre que possível.
- **Pagamentos:** Asaas (gateway brasileiro) via API + webhooks.
- **Hospedagem:** Vercel (app) + Supabase Cloud (DB/Auth/Storage).
- **Idioma/Localização:** 100% PT-BR, moeda BRL, fuso America/Sao_Paulo. Formatar números/moeda com `Intl.NumberFormat('pt-BR')`.

> ⚠️ **Nota de consistência a resolver:** a documentação das telas (Blocos 1–5) afirma repetidamente que **a interface do Sotwise é 100% em inglês**. Esta seção de stack define **100% PT-BR**. Os dois não podem valer ao mesmo tempo para a UI. Provável explicação: a stack aqui foi trazida de um template/outro projeto (as menções a "sparklines de preço/custo", "parser NF-e" e "Zesta" abaixo não pertencem ao domínio de logística do Sotwise). **Confirmar com o cliente qual idioma vale para a interface** antes de implementar. Ver seção 8.

### Convenções de código
- TypeScript estrito, sem `any` implícito.
- Camada de domínio isolada de Supabase: repositórios/serviços que recebem o client, para facilitar teste e troca futura. _(Alinha com a intenção do MD de manter as regras de negócio — split de lotes, rollup de status — independentes da infra.)_
- Server Actions para mutações; nunca expor `service_role` ao client.
- Nomes de tabela/coluna em `snake_case`; tipos TS em `PascalCase`; gerar tipos com `supabase gen types typescript`. _(O schema deste MD já segue `snake_case`.)_

---

## 10. Versionamento (GitHub)

- Repositório no GitHub, branch principal `main` protegida (PR obrigatório, sem push direto).
- Fluxo: `main` (produção) ← `develop` (integração) ← `feature/*`, `fix/*`, `chore/*`.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
- PRs pequenos e descritivos; cada PR roda CI (lint, typecheck, build, testes).
- **CI/CD:** GitHub Actions para lint+typecheck+test+build; deploy automático via integração Vercel (preview por PR, produção no merge em `main`).
- Migrations do Supabase versionadas em `supabase/migrations` e aplicadas via CI ou Supabase CLI. Nunca alterar o schema manualmente em produção sem migration correspondente. _(Todo o SQL da seção 3 deste MD deve virar migrations versionadas — é o ponto de partida da pasta.)_
- `.env` nunca commitado; usar `.env.example` documentado. Secrets em Vercel e GitHub Actions Secrets.
- Estrutura sugerida do repo:
  ```
  /app            (Next.js App Router)
  /components     (UI: shadcn + componentes do projeto)
  /lib            (clients supabase, utils, formatadores BRL)
  /domain         (serviços/regras de negócio puras)
  /supabase
    /migrations
    /functions    (edge functions: webhooks Asaas, etc.)
  /docs
  ```

---

## 11. Requisitos de Segurança

> Diretrizes de segurança que o sistema deve cumprir, aplicáveis a todas as camadas independentemente de stack. Baseadas em OWASP. Mantidas genéricas; adaptar ao contexto (Next.js + Supabase + Asaas) na implementação.

### Princípios fundamentais

1. **Defesa em profundidade:** cada camada independentemente segura. Se o frontend valida, o backend também valida. Se o banco tem constraints, o código também verifica. Nenhuma camada depende de outra para segurança.
2. **Nunca confie no frontend:** toda entrada do cliente é potencialmente maliciosa. Toda validação deve existir no servidor; toda autorização verificada no backend. Dados do cliente são sugestões, não verdades.
3. **Menor privilégio:** cada componente, usuário, serviço, query e função com apenas as permissões mínimas necessárias. Vale para roles de banco, tokens de API, permissões de arquivo, escopos de OAuth.
4. **Falhe de forma segura (fail closed):** se algo der errado, negar acesso por padrão. Erros nunca abrem brechas. Exceções não tratadas resultam em negação, não concessão.
5. **Segredos fora do código — sempre:** nunca colocar API keys, tokens, senhas, connection strings ou chaves privadas no código-fonte, comentários, logs, mensagens de erro ou respostas de API. Usar variáveis de ambiente ou gerenciadores de secrets.
6. **Segurança por design, não por obscuridade:** o código deve ser seguro mesmo com repositório público. Os únicos segredos devem ser variáveis de ambiente.

### A01 — Broken Access Control
- Controle de acesso sempre no servidor, nunca apenas no cliente.
- Negar por padrão (deny by default) — acesso concedido explicitamente.
- Em toda operação de leitura, edição e exclusão: verificar se o usuário autenticado é dono ou tem permissão sobre aquele recurso específico.
- Proteger contra IDOR: nunca permitir acesso a recursos de outro usuário apenas trocando um ID.
- Proteger contra escalação de privilégio vertical (user → admin) e horizontal (user A → user B).
- CORS restritivo — apenas domínios autorizados, nunca wildcard (`*`) em produção com credenciais.
- Tokens/sessões: invalidar no servidor no logout, não apenas no cliente.
- Proteger contra SSRF: validar e filtrar todas as URLs fornecidas pelo usuário antes de qualquer requisição server-side.
- APIs: validar permissões em cada endpoint, não apenas nas rotas do frontend.

### A02 — Security Misconfiguration
- Remover funcionalidades, páginas, endpoints e frameworks não utilizados.
- Nunca expor stack traces, erros detalhados, nomes de tabela, versões de software ou informações de debug em produção.
- Headers de segurança HTTP obrigatórios em toda resposta: Content-Security-Policy (CSP) restritivo; X-Content-Type-Options: nosniff; X-Frame-Options: DENY (ou SAMEORIGIN se necessário); Strict-Transport-Security (HSTS) com max-age longo; Referrer-Policy: strict-origin-when-cross-origin; Permissions-Policy (restringir câmera, microfone, geolocalização, etc.).
- Desabilitar métodos HTTP desnecessários.
- Nunca usar credenciais, senhas ou configurações padrão em nenhum ambiente.
- Banco de dados: permissões mínimas por serviço/conexão.
- **Se o sistema usar RLS (Row Level Security), configurar em TODAS as tabelas sem exceção.** _(Ver seção 7 — a decisão de usar RLS ou impor segurança na camada de aplicação ainda depende do cliente; se RLS for adotado, esta regra vale integralmente.)_
- Desabilitar listagem de diretórios.
- Ambientes de desenvolvimento não devem ser acessíveis publicamente.

### A03 — Software Supply Chain Failures
- Usar lockfiles e commitá-los no repositório. _(Reforça a regra de lockfiles da seção 10.)_
- Preferir dependências com grande base de usuários, manutenção ativa e boa reputação.
- Nunca importar bibliotecas obscuras, abandonadas ou sem verificação.
- Verificar se as dependências não possuem vulnerabilidades conhecidas antes de usar.
- Não executar scripts de pós-instalação de pacotes sem revisar.
- Ao sugerir uma dependência, informar se há alternativas mais seguras ou nativas.

### A04 — Cryptographic Failures
- Senhas: sempre Argon2id, bcrypt ou scrypt. Nunca MD5, SHA-1, SHA-256 simples ou qualquer hash não projetado para senhas. _(No Sotwise, o hashing de senha é responsabilidade do Supabase Auth — ver 3.12.1 — que já usa algoritmo adequado; não implementar hashing próprio.)_
- Dados em trânsito: HTTPS/TLS obrigatório. Desabilitar TLS 1.0 e 1.1.
- Dados sensíveis em repouso: criptografia com algoritmo forte (AES-256-GCM ou equivalente).
- Nunca criar algoritmos criptográficos próprios — usar bibliotecas consolidadas.
- Tokens, IDs de sessão, códigos de verificação: gerar com CSPRNG (gerador criptograficamente seguro).
- Comparação de tokens e hashes: usar comparação em tempo constante (constant-time) para evitar timing attacks.
- Nunca logar senhas, tokens, chaves, dados de cartão ou dados pessoais sensíveis.
- Chaves de criptografia armazenadas em gerenciadores de secrets, nunca no código.

### A05 — Injection
- **SQL Injection:** sempre queries parametrizadas ou prepared statements. Nunca concatenar input do usuário em SQL. _(O acesso via `@supabase/supabase-js` já parametriza; em SQL direto/migrations, manter a regra.)_
- **XSS:** sanitizar toda entrada antes de renderizar; usar encoding de saída apropriado ao contexto (HTML, JS, URL, CSS); CSP restritivo como camada adicional; nunca usar HTML cru (`innerHTML`, `dangerouslySetInnerHTML`, etc.) com dados do usuário sem sanitização.
- **Command Injection:** nunca executar comandos do SO com input do usuário. Se inevitável, usar allowlist estrita.
- **NoSQL Injection:** validar e tipificar queries em bancos NoSQL.
- **Template Injection:** nunca inserir input do usuário diretamente em templates server-side.

### Pagamentos (Asaas) — reforço
- Validar a **assinatura dos webhooks** do Asaas antes de processar qualquer evento; tratar o corpo do webhook como não confiável.
- **Idempotência** em operações financeiras: a mesma operação disparada duas vezes ao mesmo tempo não pode cobrar/creditar em duplicidade (proteção contra race conditions e reenvio de webhook).
- Nunca confiar em valores de pagamento vindos do cliente; a fonte de verdade do valor é o servidor/Asaas.
- Nunca logar dados de pagamento sensíveis.

### Deploy e infraestrutura
- HTTPS obrigatório em produção.
- Variáveis de ambiente para todos os secrets; `.env` nunca commitado (sempre no `.gitignore`); incluir `.env.example` com valores fictícios.
- CORS restritivo.
- Rate limiting global e por endpoint.
- Backups automáticos e testados.
- Separação de ambientes (dev/staging/prod) com secrets distintos.
- Se usar containers: não rodar como root.
- Manter dependências atualizadas.

### Checklist de auto-revisão (a rodar em cada feature)
Todo código deve sobreviver a estas perguntas:
- E se eu trocar o ID por um de outro usuário? (IDOR)
- E se eu mandar 100 requisições iguais ao mesmo tempo? (rate limit / race condition)
- E se eu mandar um campo com 1 milhão de caracteres? (limite de tamanho)
- E se eu colocar `<script>alert(1)</script>` em qualquer campo? (XSS)
- E se eu mandar `' OR 1=1 --` em qualquer campo? (SQL injection)
- E se eu acessar sem estar logado? (autenticação)
- E se eu forjar ou manipular o token? (integridade de sessão)
- E se eu mandar uma URL externa onde deveria ser interna? (SSRF)
- E se eu tentar a mesma operação financeira duas vezes ao mesmo tempo? (idempotência)
- E se eu acessar/editar/deletar um recurso que não é meu? (autorização)
- E se eu enviar um arquivo `.exe` renomeado para `.jpg`? (validação de upload)
- E se eu inspecionar o response e encontrar dados de outros usuários? (vazamento)

> **Preferência geral:** biblioteca madura e testada > implementar do zero. Não reinventar autenticação, criptografia ou sanitização.

---

## 12. Log de implementação — Supabase

> Registro do que foi **efetivamente aplicado** no banco a partir deste MD, com as decisões e ajustes tomados na execução. Início: **2026-07-27**.

### 12.1 Ambiente
- **Projeto Supabase `AGK`** — ref `qqbeoljgpfllhcvqrsup`, região `sa-east-1`, org Vista (`vbtrfvrdsvvgyrktdtgh`), Postgres 17. (O repo `sotwise` e o projeto `AGK` são o mesmo produto.)
- **Acesso:** o conector Supabase MCP disponível **não alcança** este projeto (fica na org pessoal). As migrations foram aplicadas via **Management API** (`POST /v1/projects/{ref}/database/query`) com um Personal Access Token.
- **Repo:** `github.com/HenriqueShirakawa/sotwise`, branch `main`. Migrations versionadas em `supabase/migrations/`.

### 12.2 Migrations aplicadas
| Arquivo | O que faz |
|---|---|
| `20260727093000_init_schema.sql` | Schema inicial: **33 tabelas, 8 enums, 24 triggers `updated_at`, 68 FKs** — todo o modelo da seção 3 (menos o que foi pulado, ver 12.4). |
| `20260727094000_add_bubble_id_and_seed_roles.sql` | Coluna `bubble_id text` (índice único parcial) em **25 tabelas** de negócio; **seed dos papéis** `admin` / `user`. |
| `20260727095000_enable_rls_deny_all.sql` | **RLS habilitado (deny-all, sem policies)** nas 33 tabelas. |

### 12.3 Ajuste vs. o SQL da seção 3
- `etd_info.current_date` foi criada como **`"current_date"`** (com aspas): `current_date` é palavra reservada no Postgres e não pode ser nome de coluna sem aspas. Comportamento idêntico via `supabase-js`; apenas SQL manual precisa das aspas.

### 12.4 Deliberadamente NÃO implementado nesta fase (conforme o próprio MD)
- `role_permissions` (3.3) e `role_step_denies` (3.7.5) — RBAC granular; ver simplificação na seção 4.
- Trigger `handle_new_user` (3.1) — quebraria os `NOT NULL` (`role_id`/`company`); a criação de profile é pela tela Users.
- Views `etd_factories_view` (3.7.4) e `todo_list_view` (3.12.2) — a forma final se define na implementação.

### 12.5 Decisões de execução (complementam as seções 4 e 7)
- **RLS:** começou desligado (segurança na camada de aplicação) e depois foi habilitado em **deny-all** (fail closed) — some o aviso "UNRESTRICTED" do dashboard e fecha o acesso via chave `anon`. Acesso atual: só `service_role` (servidor / importador). **Policies por tabela ficam para a fase de RLS.**
- **`bubble_id`:** convenção nova durante a migração (ver [seção 1](#1-convenções-gerais)).
- **Usuários (import):** criar Auth users via **Admin API sem enviar e-mail**, com role `user` por padrão (admins reatribuídos depois). `profiles.id` = id do Auth; `bubble_id` = `_id` do User no Bubble.

### 12.6 Tooling da migração (no repo)
- Dependências: `@supabase/supabase-js`, `tsx`, `dotenv`.
- `scripts/migrate/` — `client.ts` (client `service_role`, server-side), `check.ts` (smoke test de conexão). `run.ts` (importador) **a construir** após a Discovery.
- `.env.local` (gitignored) com URL + chaves do Supabase; `.env.example` versionado (`.gitignore` abre exceção para ele).
- Scripts npm: `migrate` e `migrate:check`.

### 12.7 Migração de dados — CONCLUÍDA (Bubble LIVE → Supabase)

Importador idempotente em `scripts/migrate/` (fetcher da Data API pública, sem token; upsert por `bubble_id`; ordem por FK). Data API descoberta via `/meta`; fonte = ambiente **live** (`https://agksystem.com/api/1.1`). Rodado em 4 camadas — contagens no Supabase:

| Camada | Tabelas (contagem importada) |
|---|---|
| 1 — cadastros + users | profiles 52, factories 746, categories 115, category_factories 823, clients 113, agents 141, contacts 285, agent_contacts 284, carriers 24, cities 51, pols 72, city_pols 72, pods 25, exporters 4, business_units 6, order_types 4, shipment_models 5, countries 2 |
| 2 — transacional | orders 1.565, batches 3.122, order_factory_category 9.441 *(+689 órfãos pulados)*, etd_info 1.317 |
| 3 — pre-loading/shipment | pre_loadings 1.381, pre_loading_clients 1.409, pre_loading_batches 2.787, shipments 1.335 |
| 4 — checklist | order_checklist_steps 3.246, pre_loading_checklist_steps 3.882 *(itens legados/órfãos do Bubble ignorados)* |

**Reconciliações** (migrations `100000`/`101000`/`102000`): relaxados NOT NULLs sem dado na origem (`clients.country_id`, `order_types.color`/`icon_path`, `business_units.icon_path`, `order_factory_category.ship_requirement`, `pre_loadings.client_reference`/`pod_id`/`leader_id`); `bubble_id` virou **unique constraint** (habilita upsert idempotente). Templates de checklist (Sorted 1–24) mapeados 1:1 ao enum `checklist_step`; direções inconsistentes do Bubble (order→lista, shipment←item) normalizadas para FK única.

### 12.8 Pendências pós-migração (refinamento)
- [ ] **Uploads → Supabase Storage** (`generaldocs`/`*uploads` → `step_attachments`; buckets `business-units`, `order-types`, `order-documents`) — ainda não migrados.
- [ ] **etd_history histórico do Bubble** (só o snapshot mais recente entrou em `etd_info` na migração de dados; o histórico *anterior* à migração não foi trazido) e **detalhes de agentes por etapa** (`checklistxitemxagents` → `pre_loading_checklist_steps.agent_*`/`contact_*`). *(O front-end que grava novas entradas em `etd_history` daqui pra frente já está implementado — ver 3.7.4, modal "ETD update".)*
- [ ] Reavaliar os ~68k itens de checklist legados/órfãos não importados (limpeza na origem).
- [x] ~~Modal "Factory x Category" (frontend) — ainda não construído.~~ Implementado: New entry, seletor de lote (popover com "+ Add batch"), Bulk import CSV com validação (ver 3.7.3).

### 12.9 Decisões de segurança (confirmadas com o cliente)
- ✅ **Supabase nasce fechado:** RLS **deny-all** em todas as tabelas → a chave `anon`/`publishable` não lê nada; acesso apenas via `service_role` (servidor). Sem exposição pública do banco.
- ✅ **Policies de RLS por tabela:** adiadas para a **fase do app**, quando o modelo de acesso for definido (Opção A — segurança na camada de aplicação, ver seção 7). Até lá, o deny-all é o estado seguro.
- ✅ **Travar a Data API do Bubble:** **dispensado** — o Bubble será descontinuado em breve; não vale investir em endurecê-lo.
- ✅ **Rotação de credenciais** (PAT do Supabase e token do Bubble que apareceram no chat): cliente decidiu **não rotacionar agora** — o acesso ao histórico é restrito e o Bubble sai de cena. **Risco aceito.** _(Recomendação técnica: rotacionar quando conveniente.)_
