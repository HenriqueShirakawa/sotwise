-- Preferências de UI por usuário — hoje guarda a visibilidade de colunas de
-- cada lista (Orders, ETD Factories, Pre-loading). Formato: um objeto por lista,
-- listKey → VisibilityState do TanStack Table, ex.:
--   { "orders": { "status": false }, "pre-loading": { "pol": false } }
-- Uma coluna não listada (ou `true`) = visível; `false` = escondida.
alter table public.profiles
  add column if not exists ui_preferences jsonb not null default '{}'::jsonb;
