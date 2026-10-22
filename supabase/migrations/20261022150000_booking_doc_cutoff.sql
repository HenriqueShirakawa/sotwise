-- Booking com dois cut-offs (2026-10-22, card "Ajustes Data e Logs Etapas"):
--
--  - `cutoff_date` (já existia) passa a ser o **Container Cut-off**;
--  - `doc_cutoff_date` (novo) é o **Doc Cut-off**;
--  - os dois viram OBRIGATÓRIOS: a etapa Booking só fecha com Estimated date,
--    Responsible, Booking number (por cliente no PL com 2+ clientes), Container
--    Cut-off e Doc Cut-off.
--
-- Só aditiva: main e dev usam o mesmo banco.

alter table public.pre_loading_checklist_steps
  add column if not exists doc_cutoff_date date;

comment on column public.pre_loading_checklist_steps.cutoff_date is
  'Container Cut-off da etapa Booking (só na linha step = booking). Obrigatório para concluir a etapa (22/10/2026).';
comment on column public.pre_loading_checklist_steps.doc_cutoff_date is
  'Doc Cut-off da etapa Booking (só na linha step = booking). Obrigatório para concluir a etapa (22/10/2026).';
