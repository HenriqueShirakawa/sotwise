-- =============================================================================
-- Realtime das mensagens: aviso instantâneo de mensagem nova.
--
-- O app grava a mensagem pelo service_role (RLS deny-all, como todo o resto) e,
-- logo depois, publica um "ping" no tópico de broadcast do Realtime. O ping NÃO
-- leva o corpo da mensagem — só os ids necessários para o cliente decidir se
-- recarrega (registro, autor, destinatários). Quem estiver com a tela aberta
-- atualiza na hora; o polling continua como rede de segurança se o WebSocket
-- cair.
--
-- O canal é PRIVADO: só usuário autenticado entra. Quem autoriza a entrada é a
-- RLS abaixo, na tabela realtime.messages (a única forma de autorizar canal no
-- Realtime). Só damos SELECT (receber) — publicar é exclusividade do servidor,
-- que usa a service_role e não passa por esta política.
-- =============================================================================

drop policy if exists "authenticated can receive message pings" on realtime.messages;

create policy "authenticated can receive message pings"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) = 'sotwise:messages'
  and realtime.messages.extension = 'broadcast'
);
