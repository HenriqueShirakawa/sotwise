-- Anexos por Factory na etapa "Place the Order" (ver docs/regras_de_negocio.md
-- §3.7.5 / §3.7.3). A etapa reexibe as entradas order_factory_category
-- agrupadas por Factory; cada grupo pode ter documentos anexados que ficam
-- vinculados a essa combinação (checklist_step_id da etapa "Place the Order"
-- + factory_id), não à etapa como um todo.
--
-- Nullable e aditiva: anexos existentes de outras etapas continuam com
-- factory_id = null (comportamento antigo, sem fábrica associada).
alter table public.step_attachments
  add column factory_id uuid references public.factories(id);
