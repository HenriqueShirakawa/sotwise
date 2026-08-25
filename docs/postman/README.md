# Postman — Teste de Schedule de Orders (GSS inbound)

Coleção para testar a via **`POST /api/gss/orders`**, por onde o GSS agenda (schedule) orders no SOTWISE.

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

A cada execução da coleção é gerado um `gss_id`/`po_number` único (via pre-request script), então rodadas repetidas não colidem entre si.

## Campos do payload

Obrigatórios: `gss_id`, `po_number`. Opcionais: `schedule_requested` (data do agendamento, `YYYY-MM-DD`), `client_reference`, `date_po`, as FKs de biblioteca por gss_id (`order_type_gss_id`, `client_gss_id`, `business_unit_gss_id`, `exporter_gss_id`) e o **Leader/Requester por e-mail** (`leader_email`, `requester_email` — casam com o usuário do SOTWISE pelo e-mail; e-mail que não existe → `400`).

> A requisição 8 só passa com gss_ids reais de biblioteca do GSS nas variáveis do environment. Sem eles, deixe-a desabilitada no Runner (ela se auto-pula no teste).

## Efeitos colaterais

Cada order criada **grava no banco de produção** e dispara o trigger `trg_orders_seed_checklist` (semeia as 10 etapas do checklist). Os registros de teste usam o prefixo `GSS-TEST-` no `gss_id`/`po_number` para serem fáceis de identificar e limpar depois.

Referência do endpoint: `app/api/gss/orders/route.ts` · schema: `domain/orders/gss-schema.ts`.
