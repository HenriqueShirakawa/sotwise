-- Rollup do status da Order (planilha "StatusSOT" do cliente): faltavam os dois
-- estados da fase de pré-carga. Sem eles, uma Order com lotes em 'preloading'
-- ficava presa em In Production / In Negotiation.
--
--   partially_preloading -> ao menos 1 lote em preloading e outros fora dela
--   pre_loading          -> todos os lotes em preloading
--
-- ADD VALUE posiciona o rótulo na ordem do enum, que é a ordem da esteira —
-- comparações (< >) e `order by status` seguem essa sequência.
--
-- ⚠️ Rodar isolado: o Postgres não deixa usar um valor de enum recém-criado na
-- mesma transação em que ele foi adicionado. O recálculo dos status das Orders
-- existentes vem depois, em passo separado.
alter type public.order_status add value if not exists 'partially_preloading' after 'in_production';
alter type public.order_status add value if not exists 'pre_loading'          after 'partially_preloading';
