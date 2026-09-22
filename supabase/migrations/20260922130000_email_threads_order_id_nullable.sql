-- =============================================================================
-- Correção da Fase A (20260922120000_email_threads_owner_columns.sql): ela
-- deixou `email_threads.order_id` com o `not null` original (20260910120000),
-- mas o código novo cria threads só por `owner_type`/`owner_id` — thread de
-- Pre-loading/Shipment não tem Order nenhuma, e thread de Order nova também
-- não preenche mais `order_id`. Resultado: todo insert falhava com
-- "null value in column order_id ... violates not-null constraint".
--
-- `order_id` fica inerte até a Fase B (drop da coluna). O `unique(order_id,
-- kind)` antigo não atrapalha: NULL nunca colide com NULL numa UNIQUE comum,
-- e a unicidade de verdade agora é dos 2 índices parciais da Fase A.
-- =============================================================================

alter table public.email_threads
  alter column order_id drop not null;
