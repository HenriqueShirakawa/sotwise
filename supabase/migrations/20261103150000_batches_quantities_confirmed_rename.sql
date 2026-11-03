-- `loaded_quantity` → `quantities_confirmed` (2026-11-03).
--
-- O GSS criou o campo do lado dele como `quantities_confirmed`; pedido do
-- usuário: mesmo nome nos dois sistemas para não haver confusão. Só renomeia
-- (valores ficam) e troca o gatilho para o nome novo — regra igual à de
-- 20261103140000: true em In Transit/Delivered, false em
-- Negotiation/Production/Pre-loading, só quando o STATUS muda.

alter table public.batches rename column loaded_quantity to quantities_confirmed;

drop trigger if exists trg_batches_loaded_on_transit on public.batches;
drop function if exists public.batches_loaded_on_transit();

create or replace function public.batches_quantities_confirmed_by_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    if new.status in ('in_transit', 'delivered') then
      new.quantities_confirmed := true;
    elsif new.status in ('in_negotiation', 'in_production', 'preloading') then
      new.quantities_confirmed := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_batches_quantities_confirmed on public.batches;
create trigger trg_batches_quantities_confirmed
  before insert or update of status on public.batches
  for each row execute function public.batches_quantities_confirmed_by_status();
