-- Etapa nova "Shipment Plan" no Pre-loading (2026-11-11, card da call de
-- 10/11/2026, item 7): a 1ª etapa do PL, antes do Consolidation Point. Só tem
-- o "Set date" (igual à etapa Order): a data fica em
-- `pre_loading_checklist_steps.event_date` (mesmo campo de Shipping Date / ETA /
-- ATA / Delivered); a 1ª gravação conclui, trocar depois exige motivo.
--
-- Só aditiva: um valor novo no enum. PLs que já existem ganham a etapa quando
-- alguém gravar a data (a tela mostra a etapa vazia até lá).

alter type public.checklist_step add value if not exists 'shipment_plan' before 'consolidation_point';
