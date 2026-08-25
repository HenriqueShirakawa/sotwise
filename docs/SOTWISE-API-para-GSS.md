# SOTWISE — API de Integração (para o time do GSS)

Documento de referência para integração **GSS → SOTWISE**. Cobre:

1. **Via inbound de Orders** — o GSS cria/atualiza pedidos no SOTWISE (push).
2. **API de Bibliotecas (cadastros)** — CRUD dos cadastros de referência.

- **Base URL:** `https://sotwise-pi.vercel.app`
- **Formato:** JSON em todas as requisições e respostas (`Content-Type: application/json`)
- **Transporte:** servidor → servidor (não há CORS; chamadas de navegador de outra origem são bloqueadas)

---

## 1. Autenticação

Há **dois tokens distintos**, um para cada área. Ambos vão no header `Authorization`, no formato `Bearer <token>` (o prefixo `Bearer ` com espaço é obrigatório). Os valores são combinados fora de banda — peça ao responsável pelo ambiente.

| Área | Header | Token |
|---|---|---|
| Via inbound de Orders (`/api/gss/orders`) | `Authorization: Bearer <GSS_INBOUND_SECRET>` | `GSS_INBOUND_SECRET` |
| Bibliotecas / cadastros (`/api/{recurso}`) | `Authorization: Bearer <API_TOKEN>` | `API_TOKEN` |

Sem token válido a resposta é `401` com corpo JSON (a API nunca redireciona para tela de login).

---

# Parte 1 — Via inbound de Orders

`POST /api/gss/orders` — o GSS **cria ou atualiza** uma order no SOTWISE.

```
POST https://sotwise-pi.vercel.app/api/gss/orders
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

| Status | Quando |
|---|---|
| `201` | Order **criada** — `{ "data": { "id", "po_number" }, "created": true }` |
| `200` | Order **atualizada** — `{ "data": { "id", "po_number" }, "created": false }` |
| `400` | Payload inválido, FK/`gss_id` inexistente, e-mail sem usuário, `supplier_category_gss_id` inexistente, ou criação sem `po_number` |
| `401` | Token ausente/incorreto |
| `409` | `po_number` já usado por outra order |
| `503` | `GSS_INBOUND_SECRET` não configurado no servidor |

Erro sempre traz `{ "error": "mensagem" }` (e `issues` nos erros de validação).

---

# Parte 2 — API de Bibliotecas (cadastros)

CRUD dos cadastros de referência (factories, clients, categories etc.).

```
GET   https://sotwise-pi.vercel.app/api/{recurso}       → listar
POST  https://sotwise-pi.vercel.app/api/{recurso}       → criar 1 registro
PATCH https://sotwise-pi.vercel.app/api/{recurso}/{id}  → atualizar 1 registro
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
| `200` | GET / PATCH ok |
| `201` | POST criou (corpo traz o registro com `id`) |
| `400` | Corpo inválido, FK inexistente, ou PATCH sem campos |
| `401` | Não autenticado / token inválido |
| `404` | Recurso inexistente na URL, ou `{id}` do PATCH não encontrado |
| `409` | Violação de unicidade |
| `500` | Erro inesperado |

---

## Observações da integração (contexto)

- **Bibliotecas:** o GSS é a **fonte** delas; o SOTWISE normalmente **puxa** (pull). A API acima permite escrita, mas o pareamento SOTWISE↔GSS é por `gss_id` (não exposto nesta API de cadastros).
- **Orders:** a via inbound (Parte 1) é a direção **push** (GSS → SOTWISE).
- **Factory × Category:** no GSS correspondem aos registros de **supplier-category**; o `supplier_category_gss_id` de cada `item` é o id desse registro.
