# Postman — Orders GSS ↔ SOTWISE

Coleção para testar os dois sentidos de **`/api/gss/orders`**: o **`POST`**, por onde o GSS agenda (schedule) orders no SOTWISE, e o **`GET`**, por onde o GSS lê de volta o status, o lote atribuído e o checklist.

## Arquivos

- `SOTWISE-GSS-Schedule-Orders.postman_collection.json` — a coleção com os cenários de teste
- `SOTWISE-GSS.postman_environment.json` — variáveis de ambiente (base URL + segredo)

## Como usar

1. No Postman: **Import** → arraste os dois arquivos.
2. Selecione o environment **"SOTWISE — GSS (prod)"** no canto superior direito.
3. Preencha a variável **`gss_inbound_secret`** com o valor de `GSS_INBOUND_SECRET` (o mesmo configurado na Vercel). É o segredo dedicado da integração — **não** é o `API_TOKEN` dos cadastros de `docs/API.md`.
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

Referência do endpoint: `app/api/gss/orders/route.ts` · schema do POST: `domain/orders/gss-schema.ts` · leitura do GET: `domain/orders/gss-read.ts`.
