-- =============================================================================
-- Realtime da lista de Pre-loading: quando um PL é criado/editado/excluído, tem
-- etapa salva, ou vira embarque (Confirm Shipping, que tira o PL da lista), o
-- servidor (service_role) publica um "ping" de broadcast no tópico
-- 'sotwise:preloading'. Quem estiver com a lista aberta atualiza na hora.
--
-- Canal PRIVADO: só usuário autenticado recebe (RLS abaixo). Só SELECT; publicar
-- é do servidor. Mesmo modelo do realtime das mensagens/orders/shipments.
-- =============================================================================

drop policy if exists "authenticated can receive preloading pings" on realtime.messages;

create policy "authenticated can receive preloading pings"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) = 'sotwise:preloading'
  and realtime.messages.extension = 'broadcast'
);
