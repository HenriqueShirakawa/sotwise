# Postman — Orders GSS ↔ SOTWISE

Coleção para testar os dois sentidos de **`/api/orders`**: o **`POST`**, por onde o GSS agenda (schedule) orders no SOTWISE, e o **`GET`**, por onde o GSS lê de volta o status, o lote atribuído e o checklist.

## Arquivos

- `SOTWISE-GSS-Schedule-Orders.postman_collection.json` — a coleção com os cenários de teste
- `SOTWISE-GSS.postman_environment.json` — variáveis de ambiente (base URL + token)

## Como usar

1. No Postman: **Import** → arraste os dois arquivos.
2. Selecione o environment **"SOTWISE — GSS (prod)"** no canto superior direito.
3. Preencha a variável **`api_token`** com o valor de `API_TOKEN` (o mesmo configurado na Vercel) — é o **mesmo token** usado pelos cadastros de `docs/API.md`, a API inteira compartilha um único mecanismo de auth.
4. Rode requisição a requisição, ou use o **Collection Runner** para rodar tudo em sequência.

## O que cada requisição testa

| # | Cenário | Esperado |
|---|---|---|
| 1 | Agendar order (criar) | `201`, `created: true` |
| 2 | Reenviar mesmo `gss_id` (idempotência) | `200`, `created: false`, mesmo `id` |
| 3 | `po_number` repetido | `409` |
| 4 | Sem autenticação | `401` |
| 5 | Payload sem `po_number` | `400` + `issues` |
| 6 | `schedule_requested` fora do formato | `400` (precisa ser `YYYY-MM-DD`) |
| 7 | `*_gss_id` de biblioteca inexistente | `400` |
| 8 | Agendar com as 4 FKs de biblioteca (template) | `201` — só se preencher os gss_ids reais |
| 9 | Listar orders (`GET`, página de 5) | `200` + `pagination` |
| 10 | Ler a order criada por `gss_id` com `include=items,checklist` | `200`, 1 item, checklist com 10 etapas |
| 11 | Varredura incremental por `updated_since` + `order=asc` | `200` em ordem cronológica |
| 12 | Query param inválido (`status=nao_existe`) | `400` + `issues` |

A cada execução da coleção é gerado um `gss_id`/`po_number` único (via pre-request script), então rodadas repetidas não colidem entre si.

## Campos do payload

Obrigatórios: `gss_id`, `po_number`. Opcionais: `schedule_requested` (data do agendamento, `YYYY-MM-DD`), `client_reference`, `date_po`, as FKs de biblioteca por gss_id (`order_type_gss_id`, `client_gss_id`, `business_unit_gss_id`, `exporter_gss_id`), o **Leader/Requester por e-mail** (`leader_email`, `requester_email` — casam com o usuário do SOTWISE pelo e-mail; e-mail que não existe → `400`) e **`items[]`** — as linhas Factory×Category (`{ supplier_category_gss_id, ship_requirement }`; deriva fábrica+categoria de `factory_products`, lote fica NULL pro usuário atribuir; reenvio só adiciona pares novos, não sobrescreve lote).

> A requisição 8 só passa com gss_ids reais de biblioteca do GSS nas variáveis do environment. Sem eles, deixe-a desabilitada no Runner (ela se auto-pula no teste).

## Efeitos colaterais

Cada order criada **grava no banco de produção** e dispara o trigger `trg_orders_seed_checklist` (semeia as 10 etapas do checklist). Os registros de teste usam o prefixo `GSS-TEST-` no `gss_id`/`po_number` para serem fáceis de identificar e limpar depois.

## Query params do GET

`gss_id`, `po_number`, `status`, `updated_since` (ISO 8601 com fuso), `order` (`asc`|`desc` por `updated_at`, default `desc`), `limit` (1–200, default 50), `offset`, `include` (`items`, `checklist`). Todos opcionais; a resposta é **sempre uma lista** — filtrar por `gss_id` devolve 0 ou 1 item, não muda a forma. Detalhe em [`docs/SOTWISE-API-para-GSS.md`](../SOTWISE-API-para-GSS.md) §1.5.

> O `GET` é read-only: dá para rodar as requisições 9–12 contra produção à vontade, sem gravar nada.

Referência do endpoint: `app/api/orders/route.ts` · schema do POST: `domain/orders/gss-schema.ts` · leitura do GET: `domain/orders/gss-read.ts`.

---

# Checklist da Order pelo GSS — `SOTWISE-GSS-Checklist-Order.postman_collection.json`

Testa o endpoint por onde o **GSS atualiza as etapas do checklist da Order** (22/10/2026): `GET`/`PATCH /api/orders/{id}/steps/{step}`, com `{step}` = `order` | `pi` | `po`. Mesmo environment **"SOTWISE — GSS (prod)"** (`base_url` + `api_token`).

Rode a collection **inteira, na ordem** (Runner): o passo 0 cria uma order descartável (`GSS-TEST-STEPS-…`) e o passo 12 a apaga — nenhuma order real é tocada.

| # | Cenário | Esperado |
|---|---|---|
| 0 | Cria a order de teste (`POST /api/orders`) | `201` |
| 1 | `GET .../steps/order` — etapa aberta | `200`, `completed_on: null`, sem revisões |
| 2 | `PATCH order` — 1º `order_received_date` | `200`, etapa concluída, 1 registro (original) |
| 3 | `PATCH order` — troca com `reason` | `200`, 2 registros, motivo gravado, original preservado |
| 4 | `PATCH order` — mesmo valor | `200`, nada novo |
| 5 | `PATCH order` com campo de outra etapa (`pi_status`) | `400` dizendo qual campo |
| 6 | `PATCH order` — data futura | `400` |
| 7 | `PATCH pi` — `pi_status: true` + `pi_status_date` | `200`, `completed_on` = data do status |
| 7b | `PATCH pi` — `pi_status` em texto | `400` (precisa ser `true`/`false`) |
| 8 | `PATCH po` — `items[]` | `200`, 1 linha de F×C, leva registrada |
| 9 | `PATCH po` — produto inexistente | `400` |
| 10 | Etapa desconhecida | `404` |
| 11 | Sem token | `401` |
| 12 | Apaga a order de teste | `200` |

O passo 8 usa `supplier_category_gss_id_1` do environment (se vazio, o default da collection, `11`). Datas vão em **Unix (segundos)** — geradas nos pre-request scripts.

Rodada em 22/10/2026 pelo Postman CLI (servidor local, mesmo código da produção): **13 requests, 29 asserções, 0 falhas** (antes do `pi_status` boolean).

```bash
postman collection run docs/postman/SOTWISE-GSS-Checklist-Order.postman_collection.json -e docs/postman/SOTWISE-GSS.postman_environment.json --env-var "api_token=<API_TOKEN>"
```

Referência: `app/api/orders/[id]/steps/[step]/route.ts` · regras: `domain/orders/steps-api.ts` · Swagger: `{{base_url}}/api/docs` → Orders → `getOrderStep` / `patchOrderStep`.

---

# Collection completa — `SOTWISE-x-GSS-Swagger.postman_collection.json`

**Todas** as chamadas dos dois Swaggers numa collection só, gerada por script (não editar à mão):

```bash
npx tsx scripts/postman/build-swagger-collection.ts
```

O script baixa ao vivo o `/v1/openapi.json` do GSS (precisa das envs `GSS_*` do `.env.local`) e lê o nosso `domain/api/openapi.ts`. Rode de novo sempre que algum dos dois specs mudar.

| Folder | Fonte | Base | Auth |
|---|---|---|---|
| `1. GSS` | Swagger do GSS (140 operações) | `{{gss_base}}` = `https://api.gssdatahub.com/v1` | CF Access (`gss_cf_client_id`/`gss_cf_client_secret`) + `Bearer {{gss_access}}` |
| `2. SOTWISE` | `/api/openapi.json` (69 operações em 22/10/2026; uma request por exemplo nomeado) | `{{base_url}}` | `Bearer {{api_token}}` |

**Token do GSS é automático:** o pre-request do folder GSS renova `gss_access` (refresh → login com `gss_username`/`gss_password`) quando falta ou está para expirar. Basta preencher as 4 variáveis `gss_cf_client_id`, `gss_cf_client_secret`, `gss_username`, `gss_password` no environment (valores = `GSS_CF_ACCESS_CLIENT_ID`, `GSS_CF_ACCESS_CLIENT_SECRET`, `GSS_USERNAME`, `GSS_PASSWORD`).

**Corpos:** exemplo do spec quando existe; senão só os obrigatórios. PATCH vem `{}` de propósito (Send sem querer não zera nada). A aba **Docs** de cada request lista todos os campos do body e as respostas. Query params vêm desmarcados; path vars (`:id`, `:pl_number`) vêm vazias.

> ⚠️ As duas bases apontam para **produção**. Rotas do GSS terminam com `/` — sem a barra o Django devolve 301 e o Postman refaz como GET (volta a lista com 200 e parece que deu certo).

**Rotas fora do Swagger do GSS** (`orders` → `⚠️ lote — fora do Swagger (16/10)`): o servidor do GSS aceita `PATCH /orders/{order_id}/batch/{batch_number}/` (achado por `OPTIONS`), mas o `/openapi.json` deles não documenta. O script injeta 3 requests (ler o lote; PATCH do `status` por `code` e por `id`), já apontando para a Order de teste 1705, lote 1. Em 16/10 o usuário técnico recebia **403** — falta o GSS liberar a permissão de alterar lote.
