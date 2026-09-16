-- =============================================================================
-- `country_language_defaults` foi criada em 20260909120000 sem
-- ENABLE ROW LEVEL SECURITY — ficou de fora do deny-all aplicado ao resto do
-- schema public (ver 20260727095000_enable_rls_deny_all.sql). Sinalizada pelo
-- Supabase Security Advisor (rls_disabled_in_public) em 13/09/2026: com RLS
-- desligado, a chave anon lê/escreve/apaga a tabela direto via REST, sem
-- passar pela DAL.
--
-- Efeito: mesmo padrão do resto do schema (deny-all, sem policies). Ninguém
-- acessa via chave anon/authenticated. Acesso continua só via service_role —
-- a única escrita é `setCountryLanguageDefault` (Server Action que já usa
-- createAdminClient) — nenhuma mudança de comportamento no app.
-- =============================================================================

alter table public.country_language_defaults enable row level security;
