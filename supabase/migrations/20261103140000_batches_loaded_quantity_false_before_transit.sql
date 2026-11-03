-- `loaded_quantity` = false nos status antes do embarque (2026-11-03).
--
-- Regra do usuário, complemento da 20261103130000: lote que vai para
-- In Negotiation, In Production ou Pre-loading fica com `loaded_quantity =
-- false` (ex.: embarque desfeito, lote volta para Pre-loading). In Transit e
-- Delivered seguem marcando true. Canceled não mexe na marca.
--
-- Continua só agindo quando o STATUS muda: o PATCH do GSS que mexe só no
-- `loaded_quantity` é respeitado.

create or replace function public.batches_loaded_on_transit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    if new.status in ('in_transit', 'delivered') then
      new.loaded_quantity := true;
    elsif new.status in ('in_negotiation', 'in_production', 'preloading') then
      new.loaded_quantity := false;
    end if;
  end if;
  return new;
end;
$$;

-- Acerto dos dados: lote antes do embarque marcado como true volta para false.
update public.batches
   set loaded_quantity = false
 where status in ('in_negotiation', 'in_production', 'preloading')
   and loaded_quantity;
