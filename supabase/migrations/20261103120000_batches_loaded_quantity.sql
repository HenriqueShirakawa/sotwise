-- `loaded_quantity` no lote (2026-11-03).
--
-- Pedido do usuário: campo booleano novo em `batches`, gravado pela API de
-- lotes (POST/PATCH /api/batches — o GSS é quem manda). Mesmo modelo do
-- `is_active`: é uma marca, não mexe em status nem passa pela trava de lote
-- editável.
--
-- Aditiva: `not null default false` preenche os lotes existentes como false.

alter table public.batches
  add column if not exists loaded_quantity boolean not null default false;
