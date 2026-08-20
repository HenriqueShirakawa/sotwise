-- =============================================================================
-- Realtime do status das Orders: quando o rollup dos lotes muda o status de uma
-- Order, o servidor (service_role) publica um "ping" de broadcast no tópico
-- 'sotwise:orders'. Quem estiver com a lista Orders aberta atualiza na hora —
-- o Status PO reflete sem F5, mesmo com a tela parada.
--
-- Canal PRIVADO: só usuário autenticado recebe. A autorização é esta RLS na
-- tabela realtime.messages (única forma de autorizar canal no Realtime). Só
-- damos SELECT (receber); publicar é exclusividade do servidor (service_role,
-- que não passa por esta política). Mesmo modelo do realtime das mensagens.
-- =============================================================================

drop policy if exists "authenticated can receive order pings" on realtime.messages;

create policy "authenticated can receive order pings"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) = 'sotwise:orders'
  and realtime.messages.extension = 'broadcast'
);
