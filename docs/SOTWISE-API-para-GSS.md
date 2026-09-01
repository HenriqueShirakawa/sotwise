# SOTWISE — API de Integração (para o time do GSS)

Documento de referência para integração **GSS ↔ SOTWISE**. Cobre:

1. **Orders** — o GSS cria/atualiza pedidos no SOTWISE (`POST`, push) e lê o estado deles de volta (`GET`, pull — §1.5).
2. **API de Bibliotecas (cadastros)** — CRUD dos cadastros de referência.

- **Base URL:** `https://sotwise.vercel.app`
- **Formato:** JSON em todas as requisições e respostas (`Content-Type: application/json`)
- **Transporte:** servidor → servidor (não há CORS; chamadas de navegador de outra origem são bloqueadas)

---

## 1. Autenticação

Há **dois tokens distintos**, um para cada área. Ambos vão no header `Authorization`, no formato `Bearer <token>` (o prefixo `Bearer ` com espaço é obrigatório). Os valores são combinados fora de banda — peça ao responsável pelo ambiente.

| Área | Header | Token |
|---|---|---|
| Orders — POST e GET (`/api/gss/orders`) | `Authorization: Bearer <GSS_INBOUND_SECRET>` | `GSS_INBOUND_SECRET` |
| Bibliotecas / cadastros (`/api/{recurso}`) | `Authorization: Bearer <API_TOKEN>` | `API_TOKEN` |

Sem token válido a resposta é `401` com corpo JSON (a API nunca redireciona para tela de login).

---

## Glossário de códigos de status HTTP

Todo código usado nas duas áreas desta API (Orders e Bibliotecas), com o que ele significa aqui. Os detalhes específicos de cada endpoint estão nas seções [1.4](#14-respostas) e [2.4](#24-códigos-de-status).

| Código | Nome | O que significa nesta API |
|---|---|---|
| **200** OK | Sucesso | Requisição processada sem criar nada novo — leitura (`GET`) ou atualização de um registro já existente (`PATCH`, ou `POST` de order cujo `gss_id` já existia). |
| **201** Created | Criado | Um registro **novo** foi criado (`POST` que cria uma order ou um item de biblioteca). O corpo traz o registro com o `id` gerado. |
| **400** Bad Request | Requisição inválida | O que foi enviado tem algum problema: campo obrigatório faltando, formato errado (data, e-mail, uuid), ou uma referência (`gss_id`, FK) que não existe do lado do SOTWISE. É sempre erro de quem chamou — corrigir o payload e reenviar. |
| **401** Unauthorized | Não autenticado | Faltou o header `Authorization` ou o token está errado. Conferir se é o token certo para a área (`GSS_INBOUND_SECRET` vs `API_TOKEN`) e o prefixo `Bearer `. |
| **403** Forbidden | Acesso negado | Autenticado, mas sem permissão — só se aplica a sessão de usuário (conta bloqueada). Não deve acontecer com os tokens de integração. |
| **404** Not Found | Não encontrado | A URL não corresponde a nenhum recurso, ou o `{id}` de um `PATCH` não existe (ou já foi excluído). |
| **409** Conflict | Conflito de dados | O que foi enviado colide com algo que já existe — hoje isso é só o `po_number` de uma order duplicado. |
| **500** Internal Server Error | Erro interno | Falha inesperada do lado do SOTWISE (ex.: erro de banco). Não é problema do payload — se persistir, reportar ao time do SOTWISE com a mensagem recebida. |
| **503** Service Unavailable | Indisponível | Configuração faltando no ambiente do SOTWISE (ex.: `GSS_INBOUND_SECRET` não definido). Também é um problema do lado do SOTWISE, não do payload. |

> Regra geral: **4xx** = revise o que foi enviado; **5xx** = problema do lado do SOTWISE, não repita a chamada indefinidamente sem avisar o time.

---

# Parte 1 — Orders

Dois sentidos no mesmo path e com o mesmo token: `POST` — o GSS **cria ou atualiza** uma order no SOTWISE (§1.1 a §1.4); `GET` — o GSS **lê** as orders e o estado delas (§1.5).

```
POST https://sotwise.vercel.app/api/gss/orders
Authorization: Bearer <GSS_INBOUND_SECRET>
Content-Type: application/json
```

## 1.1. Conceitos

- **Idempotência por `gss_id`.** `gss_id` é o id do pedido no GSS. Se já existe uma order com aquele `gss_id`, o POST **atualiza** (não duplica); se é novo, **cria**. Reenviar (retry) é seguro.
- **Update é PARCIAL.** No reenvio, **só as chaves enviadas** são alteradas; o que for omitido **não muda** (um `null` explícito é que limpa o campo). Isso permite criar a order num momento e completar depois, sem apagar o que já veio.
- **`po_number` é obrigatório só na criação.** No reenvio pode ser omitido (a order é identificada pelo `gss_id`).
- **Momentos distintos → várias chamadas.** Pode-se criar a order primeiro e mandar os produtos (Factory × Category) depois, em POSTs separados com o mesmo `gss_id`.
- **FKs de biblioteca por `gss_id`.** Client, Order Type, Business Unit e Exporter vêm pelo `gss_id` **da biblioteca correspondente** (o mesmo id que o GSS já tem); o SOTWISE traduz para o id interno.
- **Leader / Requester por e-mail.** São usuários do SOTWISE — identificados por `leader_email` / `requester_email`.

## 1.2. Campos do payload

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `gss_id` | string | **sim** | Id do pedido no GSS. Chave de idempotência. |
| `po_number` | string (≤50) | **só na criação** | Número do pedido. Único no SOTWISE (colisão → `409`). |
| `schedule_requested` | date `YYYY-MM-DD` | não | Data solicitada. |
| `client_reference` | string (≤200) | não | Referência do cliente. |
| `date_po` | date `YYYY-MM-DD` | não | Data de abertura. Default = hoje (só na criação). |
| `client_gss_id` | string | não | `gss_id` do cliente (customer). |
| `order_type_gss_id` | string | não | `gss_id` do order type. |
| `business_unit_gss_id` | string | não | `gss_id` da business unit. |
| `exporter_gss_id` | string | não | `gss_id` do exporter. |
| `leader_email` | e-mail | não | E-mail do Leader (usuário SOTWISE). |
| `requester_email` | e-mail | não | E-mail do Requester (usuário SOTWISE). |
| `items` | array | não | Linhas **Factory × Category** — ver abaixo. |

### `items[]` — linhas Factory × Category

Cada item representa um produto (par fábrica × categoria) do pedido:

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `supplier_category_gss_id` | string | **sim** | `gss_id` do `supplier-category` no GSS. O SOTWISE deriva a fábrica e a categoria a partir dele. |
| `ship_requirement` | date `YYYY-MM-DD` | **sim** | Data de ship requirement da linha. |

- As linhas nascem **sem lote** (o lote é atribuído pelo usuário dentro do SOTWISE).
- **Aditivo e não destrutivo:** reenviar adiciona apenas pares (fábrica, categoria) novos; pares já existentes **não** são recriados nem sobrescritos.

## 1.3. Exemplos de body

### (A) Criar a order — momento 1

```json
{
  "gss_id": "GSS-ORDER-1001",
  "po_number": "1001",
  "schedule_requested": "2026-09-15",
  "client_reference": "REPLACEMENT",
  "client_gss_id": "9",
  "order_type_gss_id": "3",
  "business_unit_gss_id": "3",
  "exporter_gss_id": "3",
  "leader_email": "leader@exemplo.com",
  "requester_email": "requester@exemplo.com"
}
```

### (B) Adicionar as Factory × Category — momento 2

Mesmo `gss_id`, só os itens (não precisa reenviar o cabeçalho):

```json
{
  "gss_id": "GSS-ORDER-1001",
  "items": [
    { "supplier_category_gss_id": "11",  "ship_requirement": "2026-09-10" },
    { "supplier_category_gss_id": "12",  "ship_requirement": "2026-09-15" },
    { "supplier_category_gss_id": "593", "ship_requirement": "2026-09-20" }
  ]
}
```

### (C) Tudo numa chamada só

```json
{
  "gss_id": "GSS-ORDER-1002",
  "po_number": "1002",
  "schedule_requested": "2026-09-15",
  "client_reference": "Pedido completo",
  "client_gss_id": "9",
  "order_type_gss_id": "3",
  "business_unit_gss_id": "3",
  "exporter_gss_id": "3",
  "leader_email": "leader@exemplo.com",
  "requester_email": "requester@exemplo.com",
  "items": [
    { "supplier_category_gss_id": "11", "ship_requirement": "2026-09-10" },
    { "supplier_category_gss_id": "12", "ship_requirement": "2026-09-15" }
  ]
}
```

## 1.4. Respostas

Resumo:

| Status | Quando |
|---|---|
| `201` | Order **criada** |
| `200` | Order **atualizada** (reenvio de um `gss_id` já existente) |
| `400` | Payload inválido, FK/`gss_id` de biblioteca inexistente, e-mail sem usuário, `supplier_category_gss_id` inexistente, ou criação sem `po_number` |
| `401` | Token ausente/incorreto |
| `409` | `po_number` já usado por outra order |
| `500` | Erro inesperado no servidor (ex.: falha ao gravar as linhas Factory×Category) |
| `503` | `GSS_INBOUND_SECRET` não configurado no servidor — reportar ao time do SOTWISE, não é erro do payload |

Erro sempre traz `{ "error": "mensagem" }`; erros de validação de schema também trazem `issues` (formato Zod).

### `201` — order criada

```jsonc
{ "data": { "id": "3f6d1a2e-…", "po_number": "1001" }, "created": true }
```

### `200` — order atualizada

Mesmo formato do `201`, com `created: false`. Acontece sempre que o `gss_id` já existe — inclusive quando o POST só trouxe `items[]` (sem tocar em nenhum campo do cabeçalho).

```jsonc
{ "data": { "id": "3f6d1a2e-…", "po_number": "1001" }, "created": false }
```

### `400` — payload inválido (falha de schema)

Campo obrigatório faltando, data fora do formato `YYYY-MM-DD`, e-mail mal formado, etc. A mensagem em `error` é a do **primeiro** problema encontrado; `issues` traz a lista completa.

```jsonc
{
  "error": "gss_id is required.",
  "issues": [
    { "code": "too_small", "path": ["gss_id"], "message": "gss_id is required." }
  ]
}
```

### `400` — `gss_id` de biblioteca não encontrado

`order_type_gss_id`, `client_gss_id`, `business_unit_gss_id` ou `exporter_gss_id` aponta para um `gss_id` que não existe na biblioteca correspondente no SOTWISE (o registro ainda não foi puxado/criado por lá).

```jsonc
{ "error": "No clients found for gss_id '9999'." }
```

### `400` — e-mail sem usuário correspondente

`leader_email` ou `requester_email` não bate com nenhum usuário cadastrado no SOTWISE.

```jsonc
{ "error": "No SOTWISE user found for e-mail 'foo@example.com'." }
```

### `400` — `supplier_category_gss_id` inexistente (em `items[]`)

Nenhum `factory_products` (supplier-category) no SOTWISE tem esse `gss_id`. Nenhum item da chamada é gravado — a resolução é feita **antes** da inserção (fail-fast).

```jsonc
{ "error": "No factory_products found for supplier_category_gss_id '999'." }
```

### `400` — criação sem `po_number`

Só ocorre quando o `gss_id` ainda **não existe** no SOTWISE (é a primeira chamada para esse pedido) e `po_number` não veio no payload.

```jsonc
{ "error": "po_number is required to create an order." }
```

### `401` — token ausente ou incorreto

```jsonc
{ "error": "Unauthorized." }
```

### `409` — `po_number` já em uso

Colisão de unicidade: outro `gss_id` já usa esse `po_number`. Pode acontecer na criação ou num reenvio que tenta trocar o `po_number` para um valor já ocupado.

```jsonc
{ "error": "po_number '1001' is already in use." }
```

### `500` — erro inesperado

Falha não prevista (ex.: erro do banco ao gravar `order_factory_category` depois de já ter resolvido os itens, ou ao consultar a order existente). A `error` traz a mensagem crua do banco — reportar ao time do SOTWISE.

```jsonc
{ "error": "<mensagem interna>" }
```

### `503` — integração não configurada

O `GSS_INBOUND_SECRET` não está definido no ambiente do SOTWISE. Indica um problema de configuração do lado do SOTWISE, não do payload enviado.

```jsonc
{ "error": "GSS_INBOUND_SECRET not configured." }
```

---

## 1.5. Ler orders — `GET /api/gss/orders`

O caminho de volta: o GSS **lê** as orders do SOTWISE e o que virou delas (status, lote atribuído, checklist). Mesmo path e **mesmo token** do POST.

```
GET https://sotwise.vercel.app/api/gss/orders
Authorization: Bearer <GSS_INBOUND_SECRET>
```

A resposta é **sempre uma lista**, mesmo filtrando por uma order só — assim o formato não muda conforme o filtro.

### Query params (todos opcionais)

| Param | Valores | Default | Para quê |
|---|---|---|---|
| `gss_id` | id do pedido no GSS | — | Ler **uma** order específica (a chave que o GSS já usa no POST) |
| `po_number` | número da PO | — | Ler uma order pelo número |
| `status` | `in_negotiation`, `in_production`, `partially_preloading`, `pre_loading`, `partially_shipped`, `shipped`, `partially_delivered`, `delivered`, `canceled` | — | Filtrar pela fase |
| `updated_since` | ISO 8601 com fuso (`2026-09-01T00:00:00Z`) | — | Só o que mudou desde então (sincronização incremental) |
| `order` | `asc` \| `desc` (por `updated_at`) | `desc` | `asc` para varrer em ordem cronológica |
| `limit` | 1–200 | 50 | Tamanho da página |
| `offset` | ≥ 0 | 0 | Deslocamento da página |
| `include` | `items`, `checklist` (separados por vírgula) | vazio | Blocos extras — só vêm se pedidos |

Parâmetro desconhecido é ignorado; valor inválido responde **400** com `issues[]` apontando o campo.

### Sincronização incremental (o uso principal)

O GSS guarda o maior `updated_at` que já viu e pede só o que mudou:

```
GET /api/gss/orders?updated_since=2026-09-01T12:00:00Z&order=asc&limit=200
```

Pagine com `offset` até `returned < limit`. A ordenação é `updated_at` + `id` (o `id` desempata, então nenhuma order pula ou repete entre páginas).

### Resposta `200`

```jsonc
{
  "data": [
    {
      "id": "0f63d999-…",                 // UUID interno do SOTWISE
      "gss_id": "12345",                  // id do pedido no GSS (null se a order nasceu no SOTWISE)
      "po_number": "1601",
      "status": "partially_shipped",
      "asap": false,
      "schedule_requested": "2026-08-28",
      "client_reference": "Tester 28/08",
      "date_po": "2026-08-28",
      "order_type":    { "id": "1364838b-…", "name": "Sales", "gss_id": "1" },
      "client":        { "id": "1468aa94-…", "name": "AGK",   "gss_id": "1" },
      "business_unit": { "id": "8ed55e47-…", "name": "Other", "gss_id": "6" },
      "exporter":      { "id": "2770eb04-…", "name": "AGK",   "gss_id": "3" },
      "leader":    { "id": "46c4eb13-…", "name": "André Mazzuchelli" },
      "requester": { "id": "45b0bc3e-…", "name": "Amy" },
      "created_at": "2026-08-28T20:40:41.406099+00:00",
      "updated_at": "2026-08-28T20:50:36.391853+00:00"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "returned": 1, "total": 1651 }
}
```

- Cada **biblioteca** sai com `gss_id` ao lado do nome — o GSS reconcilia pela mesma chave que usa para escrever, sem conhecer os UUIDs internos. `gss_id: null` = o cadastro ainda não foi pareado com o GSS.
- **Leader/Requester** saem como `{ id, name }`. O POST os aceita por e-mail; o e-mail não volta no GET porque mora em `auth.users`, fora do alcance da API.
- `total` é a contagem do filtro **sem** paginação; `returned` é o tamanho desta página.

### `include=items` — linhas Factory × Category

```jsonc
"items": [
  {
    "id": "70df42d1-…",
    "factory":  { "id": "d81ed13a-…", "name": "Aok",      "gss_id": "523" },
    "category": { "id": "52cb8d40-…", "name": "Absorber", "gss_id": "6" },
    "ship_requirement": "2026-08-28",
    "loading_status": null,                                  // total | partial | none | null
    "batch": { "id": "1b58fb15-…", "batch_number": ".02", "status": "in_production" }
  }
]
```

O `batch` é o lote que o **usuário do SOTWISE** atribuiu depois (o POST cria a linha sem lote) — é a informação que o GSS não tem de outro jeito. `batch: null` = ainda sem lote.

### `include=checklist` — as 10 etapas da fase Order

```jsonc
"checklist": [
  { "step": "order", "enabled": true, "done": true,  "estimated_date": "2026-08-28", "completed_on": "2026-08-28" },
  { "step": "po",    "enabled": true, "done": true,  "estimated_date": "2026-08-28", "completed_on": "2026-08-28" },
  { "step": "pi",    "enabled": true, "done": false, "estimated_date": null,         "completed_on": null }
]
```

Vem na ordem canônica das telas: `order`, `po`, `pi`, `deposit_payment`, `packing_confirm`, `condition_confirm`, `place_the_order`, `etd`, `balance_payment`, `pre_loading`. As fases Pre-loading e Shipment **não** estão neste endpoint.

### Códigos

| Código | Quando |
|---|---|
| `200` | Sucesso — inclusive quando o filtro não casa nada (`data: []`, `total: 0`). Não existe 404 aqui |
| `400` | Query param inválido (status fora da lista, `include` desconhecido, `limit > 200`, data fora do ISO 8601) |
| `401` | Token ausente ou errado |
| `500` | Erro inesperado do lado do SOTWISE |
| `503` | `GSS_INBOUND_SECRET` não configurado no ambiente |

> Orders excluídas não aparecem. Custo: pedir `include` só quando precisar — cada bloco custa queries a mais, e `items` sobre 200 orders é bem mais pesado que a lista pura.

---

# Parte 2 — API de Bibliotecas (cadastros)

CRUD dos cadastros de referência (factories, clients, categories etc.).

```
GET   https://sotwise.vercel.app/api/{recurso}       → listar
POST  https://sotwise.vercel.app/api/{recurso}       → criar 1 registro
PATCH https://sotwise.vercel.app/api/{recurso}/{id}  → atualizar 1 registro
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
```

> Não há `PUT` nem `DELETE` (o soft-delete é feito pelo app/pela origem).

## 2.1. Envelope de resposta

```jsonc
// GET   → 200: { "data": [ { "id": "…", "name": "…" }, … ] }
// POST  → 201: { "data": { "id": "…", "name": "…" } }
// PATCH → 200: { "data": { "id": "…", "name": "…" } }
// erro:        { "error": "Name is required.", "issues": [ … ] }
```

## 2.2. Recursos e campos

| Recurso | Endpoint | Campos do POST |
|---|---|---|
| Agents | `/api/agents` | `name`, `country_id`, `location` (`brazil`/`china`), `email`, `email_na`, `phone_number`, `contact_ids[]` |
| Contacts | `/api/contacts` | `name`, `email`, `email_na`, `phone_number` |
| Business Units | `/api/business-units` | `name` |
| Carriers | `/api/carriers` | `name` |
| Categories | `/api/categories` | `name` (opcional `factory_ids[]`) |
| Factories | `/api/factories` | `name` |
| Cities | `/api/cities` | `name` |
| POLs | `/api/pols` | `name` |
| PODs | `/api/pods` | `name` |
| Clients | `/api/clients` | `name`, `country_id` |
| Countries | `/api/countries` | `name` |
| Exporters | `/api/exporters` | `name`, `acronym` |
| Order Types | `/api/order-types` | `name` (opcional `color`) |
| Shipment Models | `/api/shipment-models` | `name` |

`name` é obrigatório em todos (1–200 caracteres). Campos desconhecidos são **descartados em silêncio**.

## 2.3. Exemplos de body

### Só nome (`carriers`, `factories`, `categories`, `cities`, `pols`, `pods`, `countries`, `business-units`, `shipment-models`)

```json
{ "name": "Shanghai" }
```

### `clients` (precisa de `country_id` — id de `/api/countries`)

```json
{ "name": "Amacom", "country_id": "8e1f…" }
```

### `exporters`

```json
{ "name": "AGK Solution", "acronym": "AGK" }
```

### `order-types`

```json
{ "name": "Sales", "color": "#640BB7" }
```

### `contacts` (ou `email` preenchido, ou `email_na: true`)

```json
{ "name": "Chen", "email": "chen@zenchum.com", "email_na": false, "phone_number": "+86 138 0000 0000" }
```

### `agents`

```json
{
  "name": "Atlas Freight",
  "country_id": "8e1f…",
  "location": "china",
  "email": "ops@atlas.cn",
  "email_na": false,
  "phone_number": "+86 21 5555 0000",
  "contact_ids": ["b21c…", "77aa…"]
}
```

## 2.4. Códigos de status

| Status | Quando |
|---|---|
| `200` | `GET` ou `PATCH` com sucesso |
| `201` | `POST` criou — corpo traz o registro com o `id` gerado |
| `400` | Corpo inválido (falha de validação, com `issues`), FK apontando para um id inexistente (ex.: `country_id` de `clients`), ou `PATCH` sem nenhum campo a atualizar (`{ "error": "No fields to update." }`) |
| `401` | Não autenticado / token inválido — `{ "error": "Unauthorized" }` ou `{ "error": "Invalid token" }` |
| `403` | Conta do usuário bloqueada (só relevante para sessão de navegador, não para o token de serviço) |
| `404` | Recurso inexistente na URL (`{ "error": "Unknown resource 'xyz'." }`) **ou** `{id}` do `PATCH` não encontrado/já excluído (`{ "error": "Record not found." }`) |
| `409` | Violação de unicidade — nenhum campo desta API é único hoje, então na prática não dispara |
| `500` | Erro inesperado no servidor. Caso especial: em `agents`, se algum id de `contact_ids` não existir, o vínculo falha com `500` **depois** do agente já ter sido criado (sem rollback) — validar os ids com `GET /api/contacts` antes de enviar |

> Detalhe completo (query params, regras de e-mail, ordem de criação dos recursos) em [`docs/API.md`](./API.md).

---

## Observações da integração (contexto)

- **Bibliotecas:** o GSS é a **fonte** delas; o SOTWISE normalmente **puxa** (pull). A API acima permite escrita, mas o pareamento SOTWISE↔GSS é por `gss_id` (não exposto nesta API de cadastros).
- **Orders:** o `POST` (Parte 1) é a direção **push** (GSS → SOTWISE); o `GET` (§1.5) é o **pull** de volta, para o GSS ver status, lote e checklist.
- **Factory × Category:** no GSS correspondem aos registros de **supplier-category**; o `supplier_category_gss_id` de cada `item` é o id desse registro.
