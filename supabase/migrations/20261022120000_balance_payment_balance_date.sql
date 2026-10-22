-- Etapa Balance Payment igual ao Deposit Payment (2026-10-22, decisão do usuário).
--
--  - campo novo "Balance date": a data em que o cliente pagou o saldo, preenchida
--    pelo usuário, com MOTIVO obrigatório em toda gravação (inclusive a 1ª);
--  - "Completed on" automático: cada gravação do Balance date regrava o Completed
--    on com o DIA DA GRAVAÇÃO (imutável — ninguém edita à mão);
--  - toggle ativo/inativo e anexo opcional continuam como estavam.
--
-- Mesmo lugar do Deposit date (20261020140000): a data vigente mora em `orders`,
-- o histórico com motivo em `checklist_step_revisions`.
--
-- Só aditiva: main e dev usam o mesmo banco.

alter table public.orders
  add column if not exists balance_date date;

alter table public.checklist_step_revisions
  drop constraint if exists checklist_step_revisions_kind_check;

alter table public.checklist_step_revisions
  add constraint checklist_step_revisions_kind_check
    check (kind in ('order_received_date', 'fxc', 'pi_status', 'completed_on', 'deposit_date', 'balance_date'));
