-- Shipping Date / ETA Brazil / ATA Brazil / Delivered com data própria (2026-10-21).
--
-- Planilha "checklistregras" (Rapha 19/10 + time de tec), no mesmo molde do
-- "Order received date" (20261020130000): cada uma dessas etapas ganha um campo
-- com a data do FATO (embarque, chegada prevista, atracação, entrega ao cliente),
-- preenchido pelo usuário. A 1ª gravação conclui a etapa (Completed on = o dia da
-- gravação, travado); trocar depois exige motivo e vai pro History da etapa.
--
-- Até aqui o Completed on dessas quatro etapas ERA a data do fato — então as já
-- concluídas herdam ele como `event_date` (nada muda no que o GSS e as listas
-- mostram).
--
-- Só aditiva: main e dev usam o mesmo banco.

alter table public.pre_loading_checklist_steps
  add column if not exists event_date date;

update public.pre_loading_checklist_steps
   set event_date = completed_on
 where step in ('shipping_date', 'eta_brazil', 'ata_brazil', 'delivered')
   and event_date is null
   and completed_on is not null;
