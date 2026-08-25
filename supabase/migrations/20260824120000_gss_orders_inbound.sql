-- ===========================================================================
-- Via de entrada GSS → SOTWISE para ORDERS (push) + rede de segurança do
-- checklist.
--
-- Contexto: até aqui a integração GSS era só PULL (o SOTWISE puxa bibliotecas).
-- Agora o GSS passa a CRIAR orders mandando um POST em /api/gss/orders. Duas
-- mudanças de banco sustentam isso:
--
--   1. `orders.gss_id` — id ORIGINAL do pedido no GSS, único. É a chave natural
--      que torna o POST idempotente (reenvio/retry do GSS faz upsert, não
--      duplica). Segue o mesmo padrão do `gss_id` das bibliotecas
--      (20260803120000_add_gss_id_to_libraries.sql).
--
--   2. Trigger `AFTER INSERT ON orders` que semeia as 10 etapas da fase Order em
--      `order_checklist_steps`. Antes, essa cascata vivia SÓ no código da action
--      `createOrder` (app/(dashboard)/orders/actions.ts) — qualquer insert que
--      não passasse por lá (o novo endpoint, SQL manual) nascia sem checklist e
--      a tela de detalhe abria com "No checklist steps for this order.".
--      Movendo a regra para o banco, TODO caminho de criação ganha o checklist.
--      A action deixa de semear em código (as 3 linhas foram removidas de lá).
-- ===========================================================================

-- 1) Chave natural do GSS na order ---------------------------------------------
alter table public.orders add column gss_id text;
alter table public.orders add constraint orders_gss_id_key unique (gss_id);

comment on column public.orders.gss_id is
  'Id original do pedido no GSS. Único. Chave natural para upsert idempotente na via inbound (/api/gss/orders). NULL para orders criadas dentro do SOTWISE.';

-- 2) Cascata order -> checklist como rede de segurança ------------------------
-- As 10 etapas são a fase Order de lib/checklist.ts (ORDER_STEPS). `on conflict
-- do nothing` deixa o trigger idempotente: se algum caminho já tiver semeado a
-- etapa, o trigger não quebra.
create or replace function public.seed_order_checklist()
returns trigger
language plpgsql
as $$
begin
  insert into public.order_checklist_steps (order_id, step)
  values
    (new.id, 'order'),
    (new.id, 'po'),
    (new.id, 'pi'),
    (new.id, 'deposit_payment'),
    (new.id, 'packing_confirm'),
    (new.id, 'condition_confirm'),
    (new.id, 'place_the_order'),
    (new.id, 'etd'),
    (new.id, 'balance_payment'),
    (new.id, 'pre_loading')
  on conflict (order_id, step) do nothing;
  return new;
end;
$$;

create trigger trg_orders_seed_checklist
  after insert on public.orders
  for each row execute function public.seed_order_checklist();
