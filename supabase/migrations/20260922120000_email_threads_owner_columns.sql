-- =============================================================================
-- PL/Shipment ganham thread própria, independente de qualquer Order (decisão
-- do usuário, 2026-09-22) — substitui o modelo "Fan-out por Order" de
-- 2026-09-16 (docs/regras_de_negocio.md, seção "Fan-out por Order").
--
-- Até aqui, `email_threads` era estritamente de uma Order (`order_id`,
-- `unique(order_id, kind)`). Quando um envio partia de uma etapa de
-- Pre-loading/Shipment (que consolida N Orders, possivelmente de N clientes
-- diferentes), o sistema "emprestava" a thread de CADA Order consolidada —
-- não existia "a thread do PRÓPRIO PL". Esta fase inverte isso: Order
-- continua com sua(s) própria(s) thread(s) (só p/ e-mails da PRÓPRIA etapa
-- da Order); Pre-loading/Shipment ganha thread(s) PRÓPRIA(S), nunca mais
-- emprestada de nenhuma Order consolidada.
--
-- Pedido do usuário (verbatim): "ORDERS são emails apenas dos checklists de
-- emails [da Order]. Quando estivermos em PL vamos mandar por PL... seria
-- meio que ter 4 threads agora: 2 orders, 2 PL/ship, duas internas e duas
-- externas de cada."
--
-- Isolamento por cliente: um PL pode consolidar lotes de VÁRIOS clientes
-- (ex.: pl-1212 com lotes da Amacom E da AGK) — a correspondência EXTERNAL
-- do PL precisa ser 1 thread POR CLIENTE distinto (nunca a mesma conversa
-- pra 2 empresas — vazamento de visibilidade). A correspondência INTERNAL
-- continua 1 thread só por PL (destinatário interno não é client-scoped).
--
-- Owner é agora POLIMÓRFICO (`owner_type` + `owner_id`), mesmo padrão já
-- usado em `messages`/`message_entity` (migration 20260731180000) — sem FK
-- de verdade (Postgres não modela FK pra "uma de duas tabelas"), então
-- perde o `on delete cascade` que `order_id` tinha: deletar uma Order ou um
-- Pre-loading não limpa mais as `email_threads` órfãs sozinho (mesma
-- limitação já aceita em `messages`; Orders/Pre-loadings são soft-deleted
-- na prática — `deleted_at` — então o impacto real é baixo).
--
-- FASE A (este arquivo): só ADITIVO — novas colunas nullable, backfill,
-- constraints, os 2 índices únicos parciais. NÃO remove `order_id` ainda —
-- fica redundante mas inerte, código antigo continua funcionando até o
-- deploy do código novo. FASE B (migration seguinte, só depois do deploy
-- confirmado) remove `order_id` de vez.
-- =============================================================================

alter table public.email_threads
  add column owner_type text,
  add column owner_id   uuid,
  add column client_id  uuid references public.clients(id);

-- Backfill: as linhas de produção existentes são todas de Order (o modelo só
-- suportava isso até aqui) — client_id fica null (thread de Order nunca é
-- dividida por cliente; a Order já tem 1 cliente só, orders.client_id).
update public.email_threads
set owner_type = 'order',
    owner_id   = order_id,
    client_id  = null
where owner_type is null;

alter table public.email_threads
  alter column owner_type set not null,
  alter column owner_id set not null;

alter table public.email_threads
  add constraint email_threads_owner_type_check
    check (owner_type in ('order', 'pre_loading')),
  add constraint email_threads_client_scope_check
    check (client_id is null or (owner_type = 'pre_loading' and kind = 'external'));

-- Gotcha do Postgres: uma UNIQUE comum trata cada NULL como DISTINTO dos
-- outros — um `unique(owner_type, owner_id, kind, client_id)` ingênuo NÃO
-- barraria 2 linhas "internal" (ambas client_id null) pro mesmo owner,
-- porque NULL nunca "bate" com outro NULL numa constraint comum. Por isso
-- são 2 ÍNDICES ÚNICOS PARCIAIS, cada um só enxergando um lado do NULL:

-- (a) no máximo 1 linha SEM cliente por (owner_type, owner_id, kind) — cobre
--     toda thread de Order (internal/external), toda thread "internal" de
--     Pre-loading, e a thread "external" de Pre-loading pro balde de Orders
--     sem client_id (dado incompleto).
create unique index email_threads_owner_kind_no_client_key
  on public.email_threads (owner_type, owner_id, kind)
  where client_id is null;

-- (b) no máximo 1 linha POR CLIENTE DISTINTO por (owner_type, owner_id, kind)
--     — só se aplica de fato a Pre-loading + external (o único caso onde
--     client_id não é null, garantido pelo check acima).
create unique index email_threads_owner_kind_client_key
  on public.email_threads (owner_type, owner_id, kind, client_id)
  where client_id is not null;

comment on table public.email_threads is
  'Conversa contínua de e-mail por DONO (owner_type/owner_id: Order, ou Pre-loading/Shipment) — ver os 2 índices únicos parciais para a regra de unicidade (client_id null vs. não-null). anchor_* aponta pro primeiro e-mail da conversa, alvo de todo In-Reply-To futuro. `order_id` ainda presente nesta fase (Fase A, aditiva) — removida na migration seguinte.';

comment on column public.email_threads.owner_type is
  '''order'' (thread da própria Order, só p/ e-mails da etapa da Order) ou ''pre_loading'' (thread do próprio Pre-loading/Shipment — compartilham o mesmo checklist, ver StepOwner em lib/checklist-email-actions.ts).';

comment on column public.email_threads.owner_id is
  'orders.id quando owner_type=''order''; pre_loadings.id quando owner_type=''pre_loading''. Sem FK real (owner polimórfico, mesmo padrão de messages.entity_id) — deletar o dono não limpa a thread sozinho.';

comment on column public.email_threads.client_id is
  'Só não-nulo quando owner_type=''pre_loading'' e kind=''external'' (check email_threads_client_scope_check) — 1 thread external por cliente DISTINTO consolidado no PL, nunca funde 2 clientes na mesma conversa. Null nesse mesmo caso = balde das Orders do PL sem client_id (dado incompleto).';
