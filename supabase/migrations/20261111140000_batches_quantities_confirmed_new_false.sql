-- quantities_confirmed (2026-11-11, pedido do usuário): "os restantes dos lotes
-- que não têm shipment devem ter false, e os próximos que criarem já sejam
-- FALSE".
--
--  - Lote NOVO nasce sempre false, mesmo que venha `true` na criação ou já num
--    status de embarque — quem confirma é o GSS, depois, com PATCH.
--  - Voltar a uma fase antes do embarque (In Negotiation / In Production /
--    Pre-Loading) segue zerando (regra de 03/11).
--  - Ir para In Transit / Delivered NÃO marca mais true sozinho: o Confirm
--    Loading só embarca lote já confirmado, e lote embarcado não volta a false
--    (trava na API, domain/batches/api-write.ts). Assim lote sem Shipment que o
--    GSS move de status fica false.
--
-- Dados acertados no mesmo dia, sem acionar o GSS: lotes sem Shipment → false
-- (produção 47, dev 38); com Shipment → true (só o 1322.03 estava false).

create or replace function public.batches_quantities_confirmed_by_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.quantities_confirmed := false;
  elsif old.status is distinct from new.status
        and new.status in ('in_negotiation', 'in_production', 'preloading') then
    new.quantities_confirmed := false;
  end if;
  return new;
end;
$$;
