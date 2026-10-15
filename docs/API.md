# API REST — Cadastros SOTWISE

Referência para integração externa com as bibliotecas de cadastro (agents, clients, factories etc.).

- **Base URL:** `https://sot.gssdatahub.com` — o endereço antigo `https://sotwise.vercel.app` continua atendendo o mesmo app, mas use o domínio acima.
- **Formato:** JSON em todas as requisições e respostas (`Content-Type: application/json`)
- **Verbos disponíveis:** `GET` (listar), `POST` (criar) e `PATCH` (atualizar). Não existem `PUT` (substituição total) nem `DELETE` — o soft-delete é feito pelo app/pela origem, por decisão.

Todos os recursos seguem exatamente o mesmo contrato — o que muda entre eles são apenas os campos.

---

## 1. Autenticação

Nenhum dado sai sem autenticação — sem credencial a resposta é `401` com corpo JSON (a API nunca redireciona para tela de login). A única exceção é a URL inválida: um recurso que não existe devolve `404` **antes** de checar a autenticação.

### Token de serviço (use este para integração)

```
Authorization: Bearer <API_TOKEN>
```

O token é combinado fora de banda — peça ao responsável pelo ambiente. O prefixo `Bearer ` (com espaço) é obrigatório; um header `Authorization` em outro formato é ignorado em silêncio.

Chamadas por token são identificadas como serviço: os registros criados ficam sem autor (`created_by = null`). A via de token está **ativa em produção** (verificado).

### Sessão por cookie

Uma sessão de navegador logado no app também é aceita, útil para testar direto do DevTools. Não serve para integração máquina-a-máquina.

### Respostas de autenticação

| Situação | Status | Corpo |
|---|---|---|
| Sem token e sem sessão | `401` | `{ "error": "Unauthorized" }` |
| Token informado, mas incorreto | `401` | `{ "error": "Invalid token" }` |
| Usuário com conta bloqueada | `403` | `{ "error": "Account blocked" }` |

### CORS

Não há headers `Access-Control-*`. A API é **servidor → servidor**; chamadas direto do navegador de outra origem são bloqueadas pelo browser.

---

## 2. Convenções

### Envelope de resposta

Sucesso sempre devolve os dados dentro de `data`:

```jsonc
// GET   → 200
{ "data": [ { "id": "…", "name": "…" }, … ] }

// POST  → 201
{ "data": { "id": "…", "name": "…" } }

// PATCH → 200
{ "data": { "id": "…", "name": "…" } }
```

Erro sempre devolve `error` com uma mensagem legível:

```jsonc
{ "error": "Name is required." }
```

### Códigos de status

| Status | Quando acontece |
|---|---|
| `200` | GET ou PATCH com sucesso |
| `201` | POST com sucesso — o corpo traz o registro criado, já com o `id` gerado |
| `400` | Corpo inválido (falha de validação), FK apontando para um id inexistente, ou PATCH sem nenhum campo a atualizar |
| `401` | Não autenticado / token inválido |
| `403` | Conta bloqueada |
| `404` | Recurso não existe na URL (`{ "error": "Unknown resource 'xyz'." }`) **ou** PATCH cujo `{id}` não existe / já foi excluído (`{ "error": "Record not found." }`) |
| `405` | Verbo não suportado (`PUT`, `DELETE`) — **corpo vazio**, sem JSON |
| `409` | Violação de unicidade. Nenhum campo exposto por esta API é único, então na prática não dispara |
| `500` | Erro inesperado no servidor |

Verbos auxiliares: `OPTIONS` devolve `204` com o header `Allow` das rotas — `GET, HEAD, OPTIONS, POST` na coleção (`/api/{recurso}`) e `OPTIONS, PATCH` no item (`/api/{recurso}/{id}`); `HEAD` executa o mesmo caminho do `GET` e também exige autenticação.

### Erro de validação (`400`)

Além da mensagem em `error`, vem a lista completa de problemas em `issues` (formato Zod 4), útil para depurar:

```jsonc
{
  "error": "Select a country.",
  "issues": [
    {
      "code": "invalid_format",
      "format": "uuid",
      "origin": "string",
      "path": ["country_id"],
      "message": "Select a country."
    }
  ]
}
```

---

## 3. `GET /api/{recurso}` — listar

Retorna os registros **não excluídos** (excluídos via soft-delete não aparecem), ordenados por `name` em ordem alfabética. Registros com `is_active: false` **aparecem** — ver [`is_active`](#is_active--marca-de-ativoinativo-desde-13102026).

### Query params

| Param | Tipo | Default | Descrição |
|---|---|---|---|
| `q` | string | — | Busca parcial por nome, sem diferenciar maiúsculas (`ILIKE %q%`). Só filtra a coluna `name` |
| `gss_id` | string | — | Igualdade exata no id do GSS (0 ou 1 registro) |
| `is_active` | `true` \| `false` | — | Filtra pela marca `is_active`. Sem o parâmetro vêm ativos **e** inativos |
| `limit` | inteiro | `1000` | Teto de 1000. `0`, vazio ou texto não numérico caem no default. **Valor negativo causa `500`** |
| `offset` | inteiro | `0` | Quantos registros pular — use junto com `limit` para paginar. Negativo é tratado como `0` |

> `q` vai direto para o `ILIKE` sem escapar `%` e `_` — os dois funcionam como curinga. Se o termo buscado puder conter esses caracteres, escape antes de enviar.

```bash
curl -s "https://sot.gssdatahub.com/api/factories?q=hi&limit=50&offset=0" \
  -H "Authorization: Bearer $API_TOKEN"
```

> **Paginação:** não há contador total na resposta. Pagine até receber menos itens que o `limit` pedido.

---

## 4. `POST /api/{recurso}` — criar

Cria **um** registro por chamada. O corpo é um objeto JSON — arrays não são aceitos.

```bash
curl -s -X POST "https://sot.gssdatahub.com/api/carriers" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Maersk"}'
```

```jsonc
// 201
{ "data": { "id": "3f6d…", "name": "Maersk", "gss_id": null, "is_active": true } }
```

Campos gerados pelo servidor: `id`, `created_at`, `updated_at`, `deleted_at`, `created_by`.

> **`gss_id` (desde 2026-10-13):** o id do registro no GSS (string ou inteiro; guardado como texto, único por biblioteca). Mande-o sempre que o registro vier do GSS — é a chave que o `POST /api/orders` usa para achar cliente, exporter, order type e business unit (`client_gss_id` etc.). Sem ele o cadastro nasce sem vínculo e a order depois falha com `No clients found for gss_id '…'`.

> **Idempotente com `gss_id`:** se já existe registro com aquele `gss_id`, o POST **atualiza** esse registro com o corpo e devolve `200` (em vez de `201`) — reenvio não duplica. Se o `gss_id` pertence a um registro excluído → `409`. **Sem `gss_id`** cada POST continua sendo uma inserção nova (repetir duplica).

> ⚠️ **Outros campos desconhecidos são descartados em silêncio, sem erro** (ex.: `bubble_id`).

---

## 4.1. `PATCH /api/{recurso}/{id}` — atualizar

Atualiza **um** registro existente, identificado pelo `id` na URL. O corpo é um objeto JSON **parcial**: só as colunas enviadas mudam; o que não vier fica como está. Devolve `200` com o registro já atualizado.

```bash
curl -s -X PATCH "https://sot.gssdatahub.com/api/carriers/3f6d…" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Maersk Line"}'
```

```jsonc
// 200
{ "data": { "id": "3f6d…", "name": "Maersk Line", "is_active": true } }
```

Regras:

- **Só campos documentados.** Os campos aceitos são os mesmos do POST daquele recurso (§6), todos opcionais, mais o `gss_id`. Campos desconhecidos (ex.: `bubble_id`) são **descartados em silêncio**, igual ao POST.
- **Vincular ao GSS:** `{ "gss_id": "118" }` sozinho é um PATCH válido (inclusive nos recursos só-nome); `null` desvincula. `gss_id` já usado por outro registro → `409`.
- **Corpo vazio → `400`** (`{ "error": "No fields to update." }`). Não há PATCH "no-op".
- **Id inexistente ou já excluído (soft-delete) → `404`** (`{ "error": "Record not found." }`). Só registros não excluídos são alcançáveis (inativos — `is_active: false` — são).
- **`{"is_active": false}` sozinho é um PATCH válido**, em qualquer recurso (inclusive os "somente nome").
- **Nada de `id`, `created_by`, `created_at`** é alterável por aqui.
- **Não é upsert.** PATCH nunca cria; se o `id` não existe, é `404`. Para criar, use o POST.

### Campo de e-mail (`contacts` e `agents`)

O par `email` / `email_na` segue a mesma regra da criação, validada **só quando um dos dois é enviado**:

- `{"email_na": true}` → marca "sem e-mail" (grava `email = null`). Enviar um `email` preenchido junto é `400`.
- `{"email": "novo@x.com"}` → grava o e-mail e marca `email_na = false` automaticamente.
- `{"email_na": false}` sozinho (sem `email`) → `400`: ou manda um e-mail, ou marca `N/A`.
- Não enviar nenhum dos dois → o e-mail atual não muda.

### Vínculos M-N (`agents.contact_ids`, `categories.factory_ids`)

A lista é sincronizada **como conjunto**: se o campo vier no corpo, os vínculos são **regravados** por completo (o que estava e não veio é removido); `[]` limpa todos. Omitir o campo **não mexe** na junção.

> ⚠️ Como no POST, a junção do `agents` é gravada numa segunda etapa: id de contato inexistente/repetido em `contact_ids` resulta em `500` **com o restante do PATCH já aplicado**. Valide os ids com `GET /api/contacts` antes.

---

## 5. Recursos

Os 14 recursos disponíveis. O slug da URL é exatamente o da coluna "Endpoint".

| Recurso | Endpoint | Campos devolvidos no GET |
|---|---|---|
| Agents | `/api/agents` | `id, name, country_id, location, email, email_na, phone_number` |
| Contacts | `/api/contacts` | `id, name, email, email_na, phone_number` |
| Business Units | `/api/business-units` | `id, name, icon_path` |
| Carriers | `/api/carriers` | `id, name` |
| Categories | `/api/categories` | `id, name` |
| Factories | `/api/factories` | `id, name` |
| Cities | `/api/cities` | `id, name, province, country` |
| POLs | `/api/pols` | `id, name` |
| PODs | `/api/pods` | `id, name` |
| Clients | `/api/clients` | `id, name, country_id` |
| Countries | `/api/countries` | `id, name, iso_code` |
| Exporters | `/api/exporters` | `id, name, acronym` |
| Order Types | `/api/order-types` | `id, name, color, icon_path` |
| Shipment Models | `/api/shipment-models` | `id, name` |

Todos devolvem também `is_active` (boolean).

### `is_active` — marca de ativo/inativo (desde 13/10/2026)

Os 14 recursos têm `is_active` (boolean, default `true`):

- **É só uma marca.** Inativo continua aparecendo no GET e nas telas do SOTWISE; nenhuma regra muda. **Não substitui a exclusão** — essa continua sendo o soft-delete do app (`deleted_at`), que a API segue escondendo.
- **POST/PATCH** aceitam `is_active` opcional em todo recurso (não precisa repetir na tabela do §6). Omitido → não muda; registro novo nasce `true`.
- **GET** filtra com `?is_active=true|false`; sem o parâmetro, vêm os dois.

Os recursos operacionais (orders, lotes, linhas Factory × Category, ETD, PL/shipment) seguem a mesma regra — ver [`SOTWISE-API-para-GSS.md`](./SOTWISE-API-para-GSS.md) §0.1 e o Swagger (`/api/docs`).

---

## 6. Campos por recurso (POST)

`name` é obrigatório em **todos** os recursos: texto de 1 a 200 caracteres, com espaços das pontas removidos automaticamente.

### Somente nome

`carriers` · `categories` · `factories` · `pols` · `pods` · `shipment-models` · `business-units`

```json
{ "name": "Shanghai" }
```

### Geografia (`countries`, `cities`) — espelho do GSS

`countries` aceita `iso_code` (ISO 3166-1 alfa-3) e `cities` aceita `province` e
`country`, os dois **em texto**: não são FK, a hierarquia de províncias do GSS
não é replicada aqui. Todos opcionais — `{ "name": "…" }` continua válido.

```json
{ "name": "China", "iso_code": "CHN" }
{ "name": "Ningbo", "province": "Zhejiang", "country": "China" }
```

⚠️ As duas bibliotecas são **espelho** do cadastro do GSS (`/core/country/` e
`/core/city/`): escrever aqui funciona, mas o sync agendado devolve o valor da
origem no pull seguinte. Ver [`INTEGRACAO_GSS.md` §9.10](INTEGRACAO_GSS.md).

Em `business-units` e `order-types` o ícone **não** é enviado por esta API (o upload de imagem acontece só pela tela do app). O registro nasce sem ícone.

### `clients`

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `name` | string | sim | 1–200 caracteres |
| `country_id` | uuid | sim | Precisa ser o `id` de um registro existente em `/api/countries` |

```json
{ "name": "Amacom", "country_id": "8e1f…" }
```

### `exporters`

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `name` | string | sim | 1–200 caracteres |
| `acronym` | string | sim | 1–50 caracteres |

```json
{ "name": "AGK Solution", "acronym": "AGK" }
```

### `order-types`

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `name` | string | sim | 1–200 caracteres |
| `color` | string | não | 1–50 caracteres |
| `icon_path` | string | não | 1–500 caracteres — caminho de um arquivo já existente no storage |

```json
{ "name": "Sales", "color": "#640BB7" }
```

### `contacts`

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `name` | string | sim | 1–200 caracteres |
| `email` | string \| null | condicional | E-mail válido, até 200 caracteres |
| `email_na` | boolean | sim | `true` marca explicitamente que o contato não tem e-mail |
| `phone_number` | string | sim | Texto livre, 1–50 caracteres (a base tem formatos BR e CN) |

**Regra do e-mail:** ou `email` vem preenchido, ou `email_na` é `true`. Enviar `email: null` com `email_na: false` resulta em `400`.

```json
{ "name": "Chen", "email": "chen@zenchum.com", "email_na": false, "phone_number": "+86 138 0000 0000" }
```

```json
{ "name": "Portaria", "email": null, "email_na": true, "phone_number": "+55 11 90000-0000" }
```

### `agents`

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `name` | string | sim | 1–200 caracteres |
| `country_id` | uuid | sim | `id` existente em `/api/countries` |
| `location` | enum | sim | `"brazil"` ou `"china"` — nada além disso é aceito |
| `email` | string \| null | condicional | Mesma regra de e-mail dos contatos |
| `email_na` | boolean | sim | |
| `phone_number` | string | sim | 1–50 caracteres |
| `contact_ids` | uuid[] | sim | Lista de `id` de `/api/contacts`. Pode ser `[]`, mas o campo precisa estar presente |

⚠️ **`contact_ids` é gravado depois do agente, em uma segunda etapa sem rollback.** Se algum id da lista não existir — ou vier repetido — a resposta é `500` (não `400` nem `409`), **mas o agente já foi criado**, sem os vínculos. Repetir a chamada cria um agente duplicado. Valide os ids com `GET /api/contacts` antes de enviar; se receber `500`, verifique se o agente existe antes de tentar de novo.

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

---

## 7. Ordem de criação

Alguns recursos dependem do `id` de outros. Crie nesta ordem:

```
1. countries          (não depende de nada)
2. contacts           (não depende de nada)
3. clients            → precisa de country_id
   agents             → precisa de country_id e, opcionalmente, contact_ids
```

Os demais (`carriers`, `categories`, `factories`, `cities`, `pols`, `pods`, `exporters`, `order-types`, `shipment-models`, `business-units`) são independentes e podem ser criados em qualquer momento.

Para descobrir um `country_id`, busque pelo nome:

```bash
curl -s "https://sot.gssdatahub.com/api/countries?q=china" \
  -H "Authorization: Bearer $API_TOKEN"
```

---

## 8. Exemplo completo

Criar um agente na China, do zero:

```bash
BASE="https://sot.gssdatahub.com"
AUTH="Authorization: Bearer $API_TOKEN"
JSON="Content-Type: application/json"

# 1. país (pega o id de um já existente)
COUNTRY=$(curl -s "$BASE/api/countries?q=china" -H "$AUTH" | jq -r '.data[0].id')

# 2. contato que será vinculado ao agente
CONTACT=$(curl -s -X POST "$BASE/api/contacts" -H "$AUTH" -H "$JSON" \
  -d '{"name":"Wei","email":"wei@example.com","email_na":false,"phone_number":"+86 21 5555 0000"}' \
  | jq -r '.data.id')

# 3. agente
curl -s -X POST "$BASE/api/agents" -H "$AUTH" -H "$JSON" -d "{
  \"name\": \"Atlas Freight\",
  \"country_id\": \"$COUNTRY\",
  \"location\": \"china\",
  \"email\": \"ops@atlas.cn\",
  \"email_na\": false,
  \"phone_number\": \"+86 21 5555 0001\",
  \"contact_ids\": [\"$CONTACT\"]
}"
```
