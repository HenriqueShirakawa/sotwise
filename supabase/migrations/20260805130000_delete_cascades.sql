-- Hard delete real em Orders / Pre-loadings / Shipments.
--
-- A decisão "hard vs soft" (marcada como pendência no schema inicial) foi para
-- HARD: excluir uma Order / um Pre-loading remove o registro de vez. Só que 4 FKs
-- foram criadas inline SEM cláusula ON DELETE (viram NO ACTION / RESTRICT) e
-- travavam o cascateamento:
--
--   * pre_loading_batches.batch_id    -> apagar uma Order (ou lote) esbarrava aqui
--                                        quando o lote estava dentro de um PL.
--   * shipments.pre_loading_id        -> apagar um PL esbarrava no Shipment 1:1.
--   * order_factory_category.batch_id -> referência mutável (migra no split).
--   * batches.split_from_batch_id     -> linhagem do split (auto-referência).
--
-- Sintoma que motivou a mudança: createOrder tentava reaproveitar o número de uma
-- Order soft-deleted do topo via hard delete, o delete travava nestas FKs, e a
-- criação de Order falhava com "Could not assign an order number".
--
-- Política por FK:
--   cascade  -> o vínculo/filho é removido junto com o pai
--   set null -> a referência (mutável / linhagem) é apenas zerada; a linha sobrevive
--
-- Os nomes abaixo são os que o Postgres gera para FK inline (<tabela>_<coluna>_fkey);
-- o "drop ... if exists" torna a migration idempotente e reaplicável.

-- lote apagado -> some do PL (mas o PL e os demais lotes seguem)
alter table public.pre_loading_batches
  drop constraint if exists pre_loading_batches_batch_id_fkey;
alter table public.pre_loading_batches
  add constraint pre_loading_batches_batch_id_fkey
  foreign key (batch_id) references public.batches(id) on delete cascade;

-- PL apagado -> apaga o Shipment 1:1
alter table public.shipments
  drop constraint if exists shipments_pre_loading_id_fkey;
alter table public.shipments
  add constraint shipments_pre_loading_id_fkey
  foreign key (pre_loading_id) references public.pre_loadings(id) on delete cascade;

-- lote apagado -> a categoria×fábrica sobrevive, só perde a referência ao lote
alter table public.order_factory_category
  drop constraint if exists order_factory_category_batch_id_fkey;
alter table public.order_factory_category
  add constraint order_factory_category_batch_id_fkey
  foreign key (batch_id) references public.batches(id) on delete set null;

-- lote-pai apagado -> o lote derivado sobrevive, só perde a linhagem
alter table public.batches
  drop constraint if exists batches_split_from_batch_id_fkey;
alter table public.batches
  add constraint batches_split_from_batch_id_fkey
  foreign key (split_from_batch_id) references public.batches(id) on delete set null;
