-- Etapas Order / PO / PI do checklist com gatilho próprio + revisões (2026-10-20).
--
-- Planilha "checklistregras" (respostas do Rapha 19/10 + execução do time):
--  - Order: novo campo "Order received date" (data do pedido final do cliente).
--    Gravá-lo conclui a etapa (Completed on = o dia da gravação). Cada troca
--    posterior exige motivo e vira revisão — a 1ª data nunca se perde.
--  - PO: conclui quando as Factory × Category chegam do GSS. Cada leva que muda
--    o conjunto fica registrada (lista recebida + o que mudou).
--  - PI: o GSS manda o status da PI (texto livre) + data. O 1º conclui a etapa;
--    os seguintes viram revisões.
--
-- `checklist_step_revisions` é diferente de `checklist_step_log` (20261020120000):
-- o log é "quem mexeu em qual campo" na tela; aqui ficam as revisões do FATO da
-- etapa — com motivo, e vindas também do GSS.
--
-- Só aditiva: main e dev usam o mesmo banco.

alter table public.orders
  add column if not exists order_received_date date,
  add column if not exists pi_status text,
  add column if not exists pi_status_date date;

create table if not exists public.checklist_step_revisions (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  step_id       uuid not null references public.order_checklist_steps(id) on delete cascade,
  -- order_received_date | fxc (leva de Factory × Category) | pi_status | completed_on (correção manual)
  kind          text not null,
  previous_date date,
  new_date      date,
  -- fxc: {items:[{ofc_id, factory, category}], added:[...], removed:[...]}; pi_status: {status, previous_status}
  payload       jsonb not null default '{}'::jsonb,
  reason        text,
  source        text not null default 'manual',
  changed_by    uuid references public.profiles(id) on delete set null,
  changed_at    timestamptz not null default now(),
  constraint checklist_step_revisions_kind_check
    check (kind in ('order_received_date', 'fxc', 'pi_status', 'completed_on')),
  constraint checklist_step_revisions_source_check
    check (source in ('manual', 'gss'))
);

create index if not exists idx_checklist_step_revisions_step
  on public.checklist_step_revisions (step_id, changed_at);

create index if not exists idx_checklist_step_revisions_order
  on public.checklist_step_revisions (order_id, kind, changed_at);

-- Só o service role lê/escreve (RLS ligada, sem policy) — a tela usa server action.
alter table public.checklist_step_revisions enable row level security;
