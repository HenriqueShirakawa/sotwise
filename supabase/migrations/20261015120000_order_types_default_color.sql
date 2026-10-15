-- Order Types: `color` deixa de ser exigido de quem cadastra (2026-10-15).
--
-- Pedido do usuário: se a cor não vier (GSS, API ou tela), o tipo fica com o
-- roxo do SOTWISE — o mesmo `--primary` do app inteiro (app/globals.css).
-- O GSS nem tem cor no `/core/order-type/`, então todo tipo que vem pelo sync
-- nascia sem cor.
--
-- A cor padrão mora no banco (default da coluna) e não no código: assim vale
-- para todo caminho de gravação de uma vez — API, sync do GSS, tela e scripts.
-- Os tipos que já existem sem cor recebem o roxo aqui mesmo, e a coluna volta a
-- ser NOT NULL: com o default, ninguém precisa mandar, e nunca fica vazia.

alter table public.order_types alter column color set default '#640BB7';

update public.order_types set color = '#640BB7' where color is null;

alter table public.order_types alter column color set not null;

comment on column public.order_types.color is
  'Cor da tag (hex). Opcional na gravação: sem valor, fica o roxo do SOTWISE (#640BB7).';
