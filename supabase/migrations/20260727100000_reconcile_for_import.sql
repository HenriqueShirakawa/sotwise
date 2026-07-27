-- =============================================================================
-- Reconciliação para o import do Bubble: relaxar NOT NULLs que a origem (LIVE)
-- não preenche, conforme a discovery (scripts/migrate/_discovery.json).
--   * clients: Bubble não tem country legível → country_id fica opcional.
--   * order_types: Bubble não tem `color`; icon pode faltar → opcionais.
--   * business_units: icon pode faltar → opcional.
--   * order_factory_category: "Shipment Requirement" pode faltar → opcional.
-- (Podem voltar a NOT NULL numa fase de limpeza pós-migração.)
-- =============================================================================

alter table public.clients                alter column country_id      drop not null;
alter table public.order_types            alter column color           drop not null;
alter table public.order_types            alter column icon_path       drop not null;
alter table public.business_units         alter column icon_path       drop not null;
alter table public.order_factory_category alter column ship_requirement drop not null;
