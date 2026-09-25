-- =============================================================================
-- Realtime da tela ETD Factories: quando um ETD é salvo, uma entrada
-- Factory×Category é criada/movida/removida ou um lote muda de status, o
-- servidor (service_role) publica um "ping" de broadcast no tópico
-- 'sotwise:etd'. Quem estiver com a tela aberta atualiza na hora, sem F5 —
-- mesmo comportamento que o TO-DO já tinha.
--
-- Canal PRIVADO: só usuário autenticado recebe (RLS abaixo). Só SELECT; publicar
-- é do servidor. Mesmo modelo do realtime das mensagens/orders/shipments/PL.
-- =============================================================================

drop policy if exists "authenticated can receive etd pings" on realtime.messages;

create policy "authenticated can receive etd pings"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) = 'sotwise:etd'
  and realtime.messages.extension = 'broadcast'
);
