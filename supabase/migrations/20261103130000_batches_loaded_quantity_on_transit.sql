-- `loaded_quantity` = true quando o lote embarca (2026-11-03).
--
-- Regra do usuário: lote que vira In Transit ganha `loaded_quantity = true`.
-- O status do lote muda em vários lugares (Confirm Shipping, seletor da Order,
-- API, sync), então é gatilho — mesmo argumento de `trg_batches_notify_client`.
-- Delivered entra junto: é o passo seguinte, e um lote que pula direto para
-- ele também já embarcou (mesmo critério da carga inicial abaixo).
--
-- Só dispara quando o STATUS muda: o PATCH do GSS que mexe só no
-- `loaded_quantity` (ex.: volta para false) não é atropelado.

create or replace function public.batches_loaded_on_transit()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('in_transit', 'delivered')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.loaded_quantity := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_batches_loaded_on_transit on public.batches;
create trigger trg_batches_loaded_on_transit
  before insert or update of status on public.batches
  for each row execute function public.batches_loaded_on_transit();

-- Carga inicial: todo lote que já embarcou (In Transit ou Delivered).
-- Não mexe no status → não dispara `trg_batches_notify_client`.
update public.batches
   set loaded_quantity = true
 where status in ('in_transit', 'delivered')
   and not loaded_quantity;
