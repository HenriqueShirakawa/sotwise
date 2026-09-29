-- =============================================================================
-- Duas colunas novas, ambas opcionais e aditivas (pedido da equipe AGK, 29/09):
--
-- 1. orders.operational_responsible_id — "Operational Responsible": o usuário
--    que opera o pedido do lado da China. Vai na lista de Orders, no Create/Edit
--    order e no cabeçalho do pedido, ao lado de Leader/Requester/Exporter. Não é
--    obrigatório e não vem do cadastro do cliente (por ora é escolha manual).
--
-- 2. pre_loading_checklist_steps.cutoff_date — "Cut-off" da etapa Booking: data
--    livre, opcional, que não entra na regra de conclusão da etapa (continua
--    exigindo só o booking number). Só é preenchida na linha step = 'booking';
--    a lista de Pre-Loading exibe, ordena e filtra por ela.
--
-- Nada existe no Bubble para essas duas informações — nascem vazias, sem backfill.
-- =============================================================================

alter table public.orders
  add column if not exists operational_responsible_id uuid references public.profiles(id);

comment on column public.orders.operational_responsible_id is
  'Operational Responsible (lado China). Opcional, escolhido no Create/Edit order.';

alter table public.pre_loading_checklist_steps
  add column if not exists cutoff_date date;

comment on column public.pre_loading_checklist_steps.cutoff_date is
  'Cut-off da etapa Booking (só na linha step = booking). Opcional; não conta para concluir a etapa.';
