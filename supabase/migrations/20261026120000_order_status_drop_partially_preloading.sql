-- Status da Order sem `partially_preloading` (pedido do usuário, 26/10/2026).
--
-- O GSS passou a receber o status da Order (`PATCH /v1/orders/{id}/`, catálogo
-- `GET /orders/status/`) e lá não existe "Partially Pre-Loading". Para os dois
-- lados falarem a mesma língua, o estado sai daqui também. Nova regra do
-- rollup (lib/order-status.ts): algum lote em preloading, nem todos e nenhum
-- adiante → in_production (a Order ainda tem lote produzindo/negociando).
--
-- O Postgres não remove valor de enum: o tipo é recriado sem ele e a coluna
-- convertida. Rodar INTEIRA de uma vez (begin/commit): uma falha no meio
-- desfaz tudo.

begin;

-- 1. Orders hoje em partially_preloading → in_production (a regra nova).
update public.orders set status = 'in_production' where status = 'partially_preloading';

-- 2. Tipo novo, sem o valor (mesma ordem da esteira).
alter type public.order_status rename to order_status_old;

create type public.order_status as enum (
  'in_negotiation',
  'in_production',
  'pre_loading',
  'partially_shipped',
  'shipped',
  'partially_delivered',
  'delivered',
  'canceled'
);

alter table public.orders alter column status drop default;
alter table public.orders
  alter column status type public.order_status using status::text::public.order_status;
alter table public.orders alter column status set default 'in_negotiation';

-- 3. O rollup do banco (usado pelo confirm_shipping/delete_shipment) tem o
--    tipo na assinatura: recriado no tipo novo e sem o estado.
drop function if exists public.rollup_order_status(public.batch_status[], public.order_status_old);

create or replace function public.rollup_order_status(
  p_batch_statuses public.batch_status[],
  p_current_status public.order_status
) returns public.order_status
language plpgsql
immutable
as $$
declare
  v_active public.batch_status[];
begin
  if p_current_status = 'canceled' then
    return 'canceled';
  end if;

  select array_agg(s) into v_active from unnest(p_batch_statuses) as s where s <> 'canceled';
  if v_active is null or array_length(v_active, 1) = 0 then
    return p_current_status;
  end if;

  if v_active <@ array['delivered']::public.batch_status[] then return 'delivered'; end if;
  if 'delivered' = any(v_active) then return 'partially_delivered'; end if;
  if v_active <@ array['in_transit']::public.batch_status[] then return 'shipped'; end if;
  if 'in_transit' = any(v_active) then return 'partially_shipped'; end if;
  if v_active <@ array['preloading']::public.batch_status[] then return 'pre_loading'; end if;
  if 'in_production' = any(v_active) or 'preloading' = any(v_active) then return 'in_production'; end if;
  return 'in_negotiation';
end;
$$;

revoke all on function public.rollup_order_status(public.batch_status[], public.order_status) from public;
revoke all on function public.rollup_order_status(public.batch_status[], public.order_status) from anon;
revoke all on function public.rollup_order_status(public.batch_status[], public.order_status) from authenticated;
grant execute on function public.rollup_order_status(public.batch_status[], public.order_status) to service_role;

drop type public.order_status_old;

commit;
