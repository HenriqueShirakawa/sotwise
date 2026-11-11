-- Etapa PO com "Set date" manual (2026-11-11, card "Pontos discutidos na call de
-- 10/11/2026", item 2).
--
--  - campo novo "PO received date", gravado pelo usuário, igual ao "Order
--    received date": a 1ª gravação é livre, trocar depois exige motivo;
--  - a etapa PO deixa de fechar sozinha quando chegam as Factory × Category do
--    GSS: fecha com F×C ativas E o PO received date preenchido (Completed on =
--    o dia em que as duas condições passaram a valer / da última gravação);
--  - as levas de F×C continuam sendo registradas (kind 'fxc').
--
-- Mesmo lugar do Order received date: a data vigente mora em `orders`, o
-- histórico com motivo em `checklist_step_revisions`.
--
-- Só aditiva.

alter table public.orders
  add column if not exists po_received_date date;

alter table public.checklist_step_revisions
  drop constraint if exists checklist_step_revisions_kind_check;

alter table public.checklist_step_revisions
  add constraint checklist_step_revisions_kind_check
    check (kind in ('order_received_date', 'fxc', 'pi_status', 'completed_on', 'deposit_date', 'balance_date', 'po_received_date'));
