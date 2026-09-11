-- =============================================================================
-- Fase 2 do threading de e-mail por Order (ver migration 20260910120000 e
-- docs/regras_de_negocio.md): o Reply-To passa a ser da THREAD
-- (reply+<email_threads.id>@...), não mais de cada linha. Quando a resposta
-- chega, o webhook precisa descobrir a qual envio (etapa) ela pertence — pelo
-- `In-Reply-To` do e-mail recebido contra o `message_id` gravado em cada
-- linha. Quando esse cabeçalho não bate com nada (forward, cliente de e-mail
-- que o descarta, e-mail adulterado), cai na linha mais recente da thread —
-- e esta coluna registra que foi um chute, pra tela nunca fingir certeza.
--
-- Coluna nullable e aditiva: linhas anteriores (token da própria linha, sem
-- ambiguidade) ficam null. A tabela é insert-only (revoke na migration
-- 20260909130000); ALTER TABLE não passa por esse revoke.
-- =============================================================================

alter table public.checklist_step_email_replies
  add column attribution text
    check (attribution in ('message_id', 'fallback', 'direct'));

comment on column public.checklist_step_email_replies.attribution is
  'Como o webhook ligou a resposta ao envio: message_id (In-Reply-To casou — certeza), fallback (sem cabeçalho utilizável — linha mais recente da thread, incerto), direct (token antigo da própria linha). Nulo em respostas de antes da Fase 2.';
