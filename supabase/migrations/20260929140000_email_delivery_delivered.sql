-- =============================================================================
-- Status de entrega POR DESTINATÁRIO nos e-mails por etapa (29/09/2026).
--
-- Até aqui o e-mail de etapa ia numa mensagem só para todos os destinatários,
-- e o Resend dava UM status para ela inteira ("delivered" se alguém recebeu):
-- o bounce de um destinatário sumia (QA 29/09 — Order #1675, domínio
-- inexistente junto com um endereço bom, nenhum alerta; o webhook nunca
-- recebeu `email.bounced`). Agora cada destinatário é um envio próprio
-- (`recipients[].provider_id` = id do e-mail no Resend) e a tela pergunta o
-- status de cada um (GET /emails/:id) até virar entregue ou devolvido.
--
-- Esta tabela passa a guardar também o "delivered" — é o que encerra a
-- consulta daquele destinatário. Segue insert-only (update/delete revogados).
-- Sem esta migration o app funciona igual, só consulta o Resend de novo a cada
-- vez que a tela abre (o "delivered" não fica gravado).
-- =============================================================================

-- Troca o check de `event` (criado sem nome na 20260925140000): acha pelo
-- conteúdo em vez de supor o nome gerado pelo Postgres.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.email_delivery_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%event%'
  loop
    execute format('alter table public.email_delivery_events drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.email_delivery_events
  add constraint email_delivery_events_event_check
  check (event in ('delivered', 'bounced', 'failed', 'suppressed', 'complained'));
