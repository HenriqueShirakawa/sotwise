-- Log de alterações das etapas do checklist (2026-10-20).
--
-- Pedido do usuário: toda etapa do checklist (Order #1–10 e Pre-loading/
-- Shipment #11–24) passa a ter um LOG de cada alteração feita por um usuário —
-- quem, quando e o quê. Só o que o usuário faz na tela entra (a integração com
-- o GSS e scripts não); a auto-conclusão do PL e o Confirm Shipping entram
-- porque são consequência direta de um clique dele.
--
-- Mesmo padrão de dono duplo de `step_attachments`/`checklist_step_emails`:
-- exatamente UMA de checklist_step_id (Order) / pre_loading_step_id (PL e
-- Shipment — o mesmo checklist único, exibido em duas telas).
--
-- `changes` guarda só o diff: {"estimated_date": {"from": "2026-10-01", "to": "2026-10-05"}}
-- (ids crus para responsável/agentes/portos — o nome é resolvido na leitura).
-- Anexos: {"file_name": "BL.pdf"}.
--
-- Só o service role escreve/lê (RLS ligada, sem policy) — a tela lê por server action.

create table if not exists public.checklist_step_log (
  id                  uuid primary key default gen_random_uuid(),
  checklist_step_id   uuid references public.order_checklist_steps(id) on delete cascade,
  pre_loading_step_id uuid references public.pre_loading_checklist_steps(id) on delete cascade,
  step                public.checklist_step not null,
  -- update | auto_complete | confirm_shipping | attachment_added | attachment_removed
  action              text not null,
  changes             jsonb not null default '{}'::jsonb,
  actor_id            uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  constraint checklist_step_log_one_owner check (
    (checklist_step_id is not null and pre_loading_step_id is null)
    or (checklist_step_id is null and pre_loading_step_id is not null)
  ),
  constraint checklist_step_log_action_check check (
    action in ('update', 'auto_complete', 'confirm_shipping', 'attachment_added', 'attachment_removed')
  )
);

create index if not exists idx_checklist_step_log_order_step
  on public.checklist_step_log (checklist_step_id, created_at desc)
  where checklist_step_id is not null;

create index if not exists idx_checklist_step_log_pl_step
  on public.checklist_step_log (pre_loading_step_id, created_at desc)
  where pre_loading_step_id is not null;

alter table public.checklist_step_log enable row level security;
