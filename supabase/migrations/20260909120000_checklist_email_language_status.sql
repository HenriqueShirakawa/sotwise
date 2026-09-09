-- =============================================================================
-- E-mail por etapa do checklist — idioma automático + status persistido +
-- trava de imutabilidade de verdade no histórico (docs/regras_de_negocio.md
-- §checklist emails).
--
-- Três peças independentes, agrupadas num único arquivo por serem da mesma
-- entrega (Fase 2.1 — User Stories 1/2/3):
--
-- 1) `clients.language` — resolvido preferencialmente do GSS (customer). Nulo
--    até o próximo sync popular, ou para clientes cadastrados só localmente.
-- 2) `country_language_defaults` — fallback quando o cliente não tem idioma
--    próprio: deriva do país (`clients.country_id`). Seedado só com os países
--    que hoje têm volume (Brasil/China); qualquer país fora daqui cai no
--    default global 'en', resolvido em código — nunca bloqueia o envio.
-- 3) `checklist_step_emails.status`/`language` — status computado no momento
--    do envio (success/partial/failed), e o idioma efetivamente usado no
--    template, ambos congelados na linha (mesmo espírito do `recipients`
--    já congelado). REVOKE de update/delete torna a imutabilidade uma garantia
--    de banco, não só convenção de código: hoje só INSERT/SELECT acontecem
--    (`lib/checklist-email-actions.ts`), então a revoke não quebra nada.
-- =============================================================================

alter table public.clients
  add column language text
    check (language in ('pt-BR', 'en', 'zh'));

comment on column public.clients.language is
  'Idioma do cliente para o e-mail de checklist (Fase 2.1). Sincronizado do GSS quando disponível; nulo cai no fallback por país (country_language_defaults) e depois no default global en.';

create table public.country_language_defaults (
  country_id uuid primary key references public.countries(id),
  language   text not null check (language in ('pt-BR', 'en', 'zh'))
);

comment on table public.country_language_defaults is
  'Fallback de idioma por país para o e-mail de checklist, usado só quando clients.language está vazio. Editável via SQL/Studio — sem tela de admin nesta rodada (Fase 2.1).';

insert into public.country_language_defaults (country_id, language)
select id, 'pt-BR' from public.countries where lower(name) = 'brazil' and deleted_at is null
union all
select id, 'zh' from public.countries where lower(name) = 'china' and deleted_at is null;

alter table public.checklist_step_emails
  add column status   text check (status in ('success', 'partial', 'failed')),
  add column language text check (language in ('pt-BR', 'en', 'zh'));

comment on column public.checklist_step_emails.status is
  'Resultado do envio, computado uma vez no momento do disparo (success = todos os destinatários ok, partial = alguns falharam, failed = todos falharam). Sem default: sempre gravado pela action, nunca recalculado a partir de recipients.';

comment on column public.checklist_step_emails.language is
  'Idioma efetivamente usado no template naquele envio (chrome do e-mail) — congelado, não é uma referência ao clients.language atual.';

revoke update, delete on public.checklist_step_emails from anon, authenticated, service_role;
