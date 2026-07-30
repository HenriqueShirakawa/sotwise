-- Anexos nas etapas do checklist de Pre-loading (docs/regras_de_negocio.md
-- §3.9.5: toda etapa tem "Attached documents"). Até aqui `step_attachments`
-- só apontava para `order_checklist_steps`; agora a mesma tabela serve às duas
-- origens, com exatamente UMA delas preenchida por linha.
--
-- Aditiva: as linhas existentes continuam com checklist_step_id preenchido e
-- pre_loading_step_id nulo.
alter table public.step_attachments
  add column pre_loading_step_id uuid
    references public.pre_loading_checklist_steps(id) on delete cascade;

alter table public.step_attachments
  alter column checklist_step_id drop not null;

alter table public.step_attachments
  add constraint step_attachments_one_owner check (
    (checklist_step_id is not null and pre_loading_step_id is null)
    or (checklist_step_id is null and pre_loading_step_id is not null)
  );

create index if not exists idx_step_attachments_pre_loading_step
  on public.step_attachments(pre_loading_step_id)
  where pre_loading_step_id is not null;
