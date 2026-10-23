-- History das etapas com origem GSS (2026-10-23).
--
-- Pedido do usuário: quando a etapa REABRE sem um usuário por trás — o GSS
-- mandou o dado pela API, ou o rollup de status dos lotes reabriu a etapa
-- Pre-Loading da Order —, o History grava assim mesmo, marcado como GSS.
-- Antes só entrava o que um usuário fazia (actor_id obrigatório).
--
-- `source`: 'user' (padrão — tudo que já existe) | 'gss' (sem autor).
-- `actor_id` passa a aceitar null, só para as linhas 'gss'.

alter table public.checklist_step_log
  add column if not exists source text not null default 'user';

alter table public.checklist_step_log
  drop constraint if exists checklist_step_log_source_check;
alter table public.checklist_step_log
  add constraint checklist_step_log_source_check check (
    (source = 'user' and actor_id is not null) or (source = 'gss' and actor_id is null)
  );

alter table public.checklist_step_log
  alter column actor_id drop not null;
