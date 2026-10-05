-- gss_id em LOTES, PLs e SHIPMENTS (2026-10-05).
--
-- O GSS passou a ter lote (OrderBatch) e shipment próprios, com id inteiro.
-- Decisões do usuário (05/10):
--   * o LOTE nasce no GSS e chega aqui pelo webhook deles (POST /api/batches com
--     `gss_id`) — mais uma carga inicial dos lotes que já existem lá;
--   * o Shipment do GSS (1 por PL, nasce no Create PL) guarda o id nas DUAS
--     tabelas: `pre_loadings` (existe desde a criação do PL) e `shipments`
--     (só existe depois do Confirm Shipping — herda do PL, ver trigger abaixo).
--
-- Mesmo padrão de `orders.gss_id` (20260824120000): text + unique. Aditiva:
-- colunas novas nulas, nada é reescrito.

alter table public.batches add column if not exists gss_id text;
alter table public.batches drop constraint if exists batches_gss_id_key;
alter table public.batches add constraint batches_gss_id_key unique (gss_id);

alter table public.pre_loadings add column if not exists gss_id text;
alter table public.pre_loadings drop constraint if exists pre_loadings_gss_id_key;
alter table public.pre_loadings add constraint pre_loadings_gss_id_key unique (gss_id);

alter table public.shipments add column if not exists gss_id text;
alter table public.shipments drop constraint if exists shipments_gss_id_key;
alter table public.shipments add constraint shipments_gss_id_key unique (gss_id);

-- shipments.gss_id espelha o do PL: o registro do GSS é UM só (PL + embarque).
-- (1) o shipment nasce (Confirm Shipping) já com o gss_id do PL;
create or replace function public.shipments_inherit_gss_id()
returns trigger
language plpgsql
as $$
begin
  if new.gss_id is null then
    select gss_id into new.gss_id from public.pre_loadings where id = new.pre_loading_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shipments_inherit_gss_id on public.shipments;
create trigger trg_shipments_inherit_gss_id
  before insert on public.shipments
  for each row execute function public.shipments_inherit_gss_id();

-- (2) o PL ganhou/trocou gss_id depois → leva para o shipment dele.
create or replace function public.pre_loadings_propagate_gss_id()
returns trigger
language plpgsql
as $$
begin
  update public.shipments
     set gss_id = new.gss_id
   where pre_loading_id = new.id
     and gss_id is distinct from new.gss_id;
  return new;
end;
$$;

drop trigger if exists trg_pre_loadings_propagate_gss_id on public.pre_loadings;
create trigger trg_pre_loadings_propagate_gss_id
  after update of gss_id on public.pre_loadings
  for each row
  when (old.gss_id is distinct from new.gss_id)
  execute function public.pre_loadings_propagate_gss_id();
