-- `is_active` em todas as tabelas expostas no Swagger (2026-10-13).
--
-- Pedido do usuário: o GSS (e quem mais consumir a API) precisa marcar um
-- registro como inativo. Decisões (13/10):
--   * coluna NOVA e própria (não derivada do `deleted_at`);
--   * é SÓ uma marca: nada some das telas nem da API por estar inativo — a
--     exclusão continua sendo o `deleted_at` (soft) ou o DELETE (hard) de hoje.
--
-- Aditiva: `not null default true` preenche as linhas existentes como ativas.
-- Exceção: o que já está soft-deleted nasce `false` (é o único estado em que a
-- marca tem resposta óbvia).

do $$
declare
  t text;
begin
  foreach t in array array[
    -- bibliotecas (/api/{recurso})
    'agents', 'contacts', 'business_units', 'carriers', 'categories', 'factories',
    'cities', 'pols', 'pods', 'clients', 'countries', 'exporters', 'order_types',
    'shipment_models',
    -- operacionais
    'orders', 'batches', 'order_factory_category', 'etd_info', 'pre_loadings', 'shipments'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists is_active boolean not null default true',
      t
    );
  end loop;
end $$;

-- PL e shipment são UM recurso na API (/api/shipments): a marca é a do PL e o
-- shipment espelha — mesmo padrão do gss_id (20261005120000).
-- (1) o shipment nasce (Confirm Shipping) com a marca do PL;
create or replace function public.shipments_inherit_is_active()
returns trigger
language plpgsql
as $$
begin
  select is_active into new.is_active from public.pre_loadings where id = new.pre_loading_id;
  new.is_active := coalesce(new.is_active, true);
  return new;
end;
$$;

drop trigger if exists trg_shipments_inherit_is_active on public.shipments;
create trigger trg_shipments_inherit_is_active
  before insert on public.shipments
  for each row execute function public.shipments_inherit_is_active();

-- (2) a marca do PL mudou → leva para o shipment dele.
create or replace function public.pre_loadings_propagate_is_active()
returns trigger
language plpgsql
as $$
begin
  update public.shipments
     set is_active = new.is_active
   where pre_loading_id = new.id
     and is_active is distinct from new.is_active;
  return new;
end;
$$;

drop trigger if exists trg_pre_loadings_propagate_is_active on public.pre_loadings;
create trigger trg_pre_loadings_propagate_is_active
  after update of is_active on public.pre_loadings
  for each row
  when (old.is_active is distinct from new.is_active)
  execute function public.pre_loadings_propagate_is_active();

-- Backfill: soft-deleted = inativo (só nas tabelas que têm deleted_at).
do $$
declare
  t text;
begin
  foreach t in array array[
    'agents', 'contacts', 'business_units', 'carriers', 'categories', 'factories',
    'cities', 'pols', 'pods', 'clients', 'countries', 'exporters', 'order_types',
    'shipment_models', 'orders', 'pre_loadings', 'shipments'
  ]
  loop
    execute format(
      'update public.%I set is_active = false where deleted_at is not null and is_active',
      t
    );
  end loop;
end $$;
