-- Container na etapa Booking do PL (13/11/2026, card "Filtro novo na lista de
-- PL (booking e cutoff)": "avaliar gerenciar o container — retirada do
-- container, entrega do documento, prazo de devolução carregado no porto").
--
-- Três datas OPCIONAIS na linha da etapa `booking` de
-- pre_loading_checklist_steps, ao lado de Container Cut-off / Doc Cut-off.
-- Não entram na regra de conclusão da etapa (Booking segue fechando com
-- booking number + os dois cut-offs).
alter table public.pre_loading_checklist_steps
  add column if not exists container_pickup_date date,
  add column if not exists doc_delivery_date date,
  add column if not exists container_return_date date;

comment on column public.pre_loading_checklist_steps.container_pickup_date is
  'Booking: dia da retirada do container vazio (13/11/2026).';
comment on column public.pre_loading_checklist_steps.doc_delivery_date is
  'Booking: dia da entrega dos documentos (13/11/2026).';
comment on column public.pre_loading_checklist_steps.container_return_date is
  'Booking: prazo de devolução do container carregado no porto (13/11/2026).';
