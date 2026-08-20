-- =============================================================================
-- Realtime da lista de Shipments: quando um embarque é criado (Confirm
-- Shipping), tem etapa salva ou é excluído, o servidor (service_role) publica
-- um "ping" de broadcast no tópico 'sotwise:shipments'. Quem estiver com a
-- lista Shipments aberta atualiza na hora — o registro novo aparece sem F5,
-- mesmo com a tela parada.
--
-- Canal PRIVADO: só usuário autenticado recebe (RLS abaixo, única forma de
-- autorizar canal no Realtime). Só SELECT (receber); publicar é do servidor.
-- Mesmo modelo do realtime das mensagens e das orders.
-- =============================================================================

drop policy if exists "authenticated can receive shipment pings" on realtime.messages;

create policy "authenticated can receive shipment pings"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) = 'sotwise:shipments'
  and realtime.messages.extension = 'broadcast'
);
