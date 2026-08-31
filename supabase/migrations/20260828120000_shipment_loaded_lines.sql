-- =============================================================================
-- O que cada embarque carregou, linha a linha (docs §3.7.2 / §3.9.6).
--
-- Problema que resolve: no "Confirm Shipping" a entrada Factory × Category
-- marcada Partial/None é MOVIDA para o lote-filho do split e seu
-- `order_factory_category.loading_status` volta a null — porque aquele status
-- pertence ao embarque que saiu, não ao lote de destino, que ainda vai carregar.
-- Resultado: o lote que embarcou perdia o registro do que ele carregou. O
-- "View batch" do lote `.01` mostrava a linha como se fosse do `.02` e sem
-- status, quando o fato é "no embarque do .01 essa linha foi Partial".
--
-- Aqui o fato fica gravado no embarque: uma linha por (lote embarcado × entrada),
-- com o status escolhido naquele momento. Estado atual (order_factory_category)
-- continua sendo estado atual; histórico é isto. A mesma entrada pode carregar
-- Partial no `.01`, migrar, e carregar Total no `.02` — dois registros, cada um
-- verdadeiro no seu lote.
--
-- Também é o que permite desfazer um embarque com precisão: quem voltou pro lote
-- de origem é quem está registrado aqui como não-Total (antes o `deleteShipment`
-- procurava isso pelo `loading_status`, que o próprio split já tinha zerado).
-- =============================================================================

create table public.shipment_loaded_lines (
  id                        uuid primary key default gen_random_uuid(),
  -- Apagar o Shipment (undo do embarque) apaga o registro: o fato deixou de existir.
  shipment_id               uuid not null references public.shipments(id) on delete cascade,
  -- O lote que EMBARCOU (não o de destino do split).
  batch_id                  uuid not null references public.batches(id) on delete cascade,
  order_factory_category_id uuid not null references public.order_factory_category(id) on delete cascade,
  loading_status            public.loading_status not null,
  created_at                timestamptz not null default now(),
  -- Um embarque por lote × entrada: o mesmo lote não carrega a mesma linha duas vezes.
  unique (batch_id, order_factory_category_id)
);

-- Leitura por lote: é o que o "View batch" (detalhe do pedido) e o "View parts"
-- (detalhe do embarque) fazem.
create index idx_shipment_loaded_lines_batch on public.shipment_loaded_lines (batch_id);
create index idx_shipment_loaded_lines_shipment on public.shipment_loaded_lines (shipment_id);

-- RLS deny-all, no padrão das demais tabelas: acesso só pelo service_role.
alter table public.shipment_loaded_lines enable row level security;

comment on table public.shipment_loaded_lines is
  'Snapshot do carregamento: o que cada lote embarcou (Total/Partial/None) por entrada Factory x Category, no momento do Confirm Shipping.';
