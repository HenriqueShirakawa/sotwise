-- =============================================================================
-- Fase 2.1 — notificação ao cliente: CAPTURA dos avanços de lote (outbox).
--
-- Por que trigger e não código: a escrita de `batches.status` acontece em CINCO
-- lugares (orders/[id], pre-loading, pre-loading/[id], shipments/[id] x2) e não
-- existe choke point em código. Um `sendEmail` em cada um deles é uma promessa
-- que a próxima tela quebra em silêncio. O trigger pega todos — inclusive um
-- UPDATE feito na mão pelo SQL Editor.
--
-- Por que outbox e não envio dentro do trigger: o Postgres não deve falar com a
-- internet no meio de uma transação. Aqui só se REGISTRA o evento; o envio é do
-- app (`domain/client/notifications.ts`), que pode falhar, tentar de novo e
-- deixar rastro sem nunca travar a operação do usuário.
--
-- Regras de produto travadas em 2026-08-18 (docs §8):
--   - notifica de `in_production` pra frente; `in_negotiation` não notifica;
--   - um e-mail por transição de `batch_status` (sem digest);
--   - destinatário = usuários de papel `client` ligados ao cliente do pedido.
-- =============================================================================

create table public.client_notifications (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.batches(id) on delete cascade,
  order_id     uuid not null references public.orders(id)  on delete cascade,
  client_id    uuid not null references public.clients(id),
  from_status  public.batch_status,           -- null quando o lote nasce já notificável
  to_status    public.batch_status not null,
  created_at   timestamptz not null default now(),
  -- Preenchido pelo despachante. `sent_at is null` = pendente; é o que a fila lê.
  sent_at      timestamptz,
  attempts     integer not null default 0,
  last_error   text,
  -- Para quem foi, congelado no momento do envio. Serve de auditoria e é a
  -- matéria-prima do histórico de comunicação (2.2) — sem isto, "quem recebeu
  -- o quê" viraria uma reconstrução a partir do estado atual, que muda.
  recipients   text[] not null default '{}'
);

-- A fila só olha para os pendentes: índice parcial, que não cresce com o
-- histórico já enviado.
create index idx_client_notifications_pending
  on public.client_notifications (created_at)
  where sent_at is null;

create index idx_client_notifications_order on public.client_notifications (order_id);

-- RLS deny-all, no padrão das demais tabelas: acesso só pelo service_role.
alter table public.client_notifications enable row level security;

-- ---------- captura ----------
/**
 * Enfileira o avanço de um lote.
 *
 * Silencioso de propósito em três casos, que NÃO são erro:
 *   - status que não avança (in_negotiation) ou cancelamento — ver a lista
 *     abaixo, que é exatamente o vocabulário aprovado para o cliente;
 *   - pedido sem cliente (`orders.client_id` é nullable);
 *   - pedido apagado (soft delete) — não se notifica sobre o que sumiu da tela.
 *
 * `canceled` fica FORA: a lista de vocabulário travada com o negócio tem quatro
 * estados, e nenhum deles é cancelamento. Avisar um cliente de cancelamento por
 * e-mail automático é decisão de negócio que ninguém tomou — adicionar depois é
 * uma linha; desfazer um e-mail enviado, não.
 */
create or replace function public.enqueue_client_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status not in ('in_production', 'preloading', 'in_transit', 'delivered') then
    return new;
  end if;

  select o.client_id into v_client_id
  from public.orders o
  where o.id = new.order_id
    and o.deleted_at is null;

  if v_client_id is null then
    return new;
  end if;

  insert into public.client_notifications (batch_id, order_id, client_id, from_status, to_status)
  values (new.id, new.order_id, v_client_id, old.status, new.status);

  return new;
end;
$$;

create trigger trg_batches_notify_client
  after update of status on public.batches
  for each row execute function public.enqueue_client_notification();

comment on table public.client_notifications is
  'Outbox dos avanços de lote a comunicar ao cliente. Escrita por trigger, drenada pelo app.';
