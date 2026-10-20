-- Etapa Deposit Payment: gatilho próprio pelo "Deposit date" (2026-10-20).
--
-- Card do cliente (Notion, "Deposit Payment"):
--  - o anexo NUNCA foi obrigatório nesta etapa (nada a mudar no banco);
--  - o toggle ativo/inativo CONTINUA (também é gatilho de lote, lib/deposit-production);
--  - campo novo "Deposit date": a data em que o cliente de fato depositou, preenchida
--    pelo usuário, com MOTIVO obrigatório em toda gravação (inclusive a 1ª);
--  - "Estimated date" segue manual, como hoje;
--  - "Completed on" passa a ser automático: a 1ª gravação do Deposit date conclui a
--    etapa com o DIA DA GRAVAÇÃO (mesmo critério do "Order received date").
--
-- Mesmo lugar dos outros fatos de etapa (20261020130000): a data vigente mora em
-- `orders`, e o histórico com motivo em `checklist_step_revisions`.
--
-- Só aditiva: main e dev usam o mesmo banco (a main nunca grava `deposit_date`).

alter table public.orders
  add column if not exists deposit_date date;

alter table public.checklist_step_revisions
  drop constraint if exists checklist_step_revisions_kind_check;

alter table public.checklist_step_revisions
  add constraint checklist_step_revisions_kind_check
    check (kind in ('order_received_date', 'fxc', 'pi_status', 'completed_on', 'deposit_date'));
