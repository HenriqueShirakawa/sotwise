-- =============================================================================
-- Troca os índices únicos PARCIAIS de bubble_id por UNIQUE CONSTRAINTS
-- (não-parciais). Motivo: `ON CONFLICT (bubble_id)` do supabase-js/PostgREST
-- não infere índice parcial. Unique constraint permite múltiplos NULL (padrão
-- Postgres) e habilita o upsert idempotente por bubble_id.
-- =============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'profiles','countries','pols','pods','cities','factories','categories',
    'contacts','agents','carriers','clients','exporters','business_units',
    'order_types','shipment_models','orders','batches','order_factory_category',
    'etd_info','etd_history','order_checklist_steps','step_attachments',
    'pre_loadings','pre_loading_checklist_steps','shipments'
  ];
begin
  foreach t in array tables loop
    execute format('drop index if exists public.idx_%s_bubble_id', t);
    -- nomes de índice antigos que fogem do padrão idx_<table>_bubble_id:
    null;
    execute format(
      'alter table public.%I add constraint %I unique (bubble_id)',
      t, t || '_bubble_id_key'
    );
  end loop;
  -- índices com nome fora do padrão (criados na migration 2):
  drop index if exists public.idx_ofc_bubble_id;
  drop index if exists public.idx_ocs_bubble_id;
  drop index if exists public.idx_plcs_bubble_id;
end $$;
