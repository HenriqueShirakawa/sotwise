-- Log de toda chamada que o SOTWISE faz à API do GSS (2026-10-19).
--
-- Pedido do usuário: os envios ao GSS rodam DEPOIS da resposta (`after()`), então
-- um erro (ex.: PL 1470 recusado por POD inexistente) só aparecia no log da
-- Vercel e passava despercebido. Agora cada chamada de `gssRequest`
-- (lib/gss/client.ts) vira uma linha aqui, e a tela /access/gss/calls lista.
--
-- Só o service role escreve/lê (RLS ligada, sem policy): a tela é server-side,
-- owner-only. Corpo da resposta truncado no código (2.000 caracteres).

create table if not exists public.gss_call_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  method        text not null,
  path          text not null,
  -- HTTP do GSS; 0 = nem chegou lá (rede, credencial, timeout)
  status        integer not null,
  -- classificação do gssRequest: ok | retryable | permanent | blocked
  kind          text not null,
  duration_ms   integer,
  request_body  jsonb,
  response_body text,
  error         text,
  -- quem chamou: pl-shipment | batch-status | etd-factory | script...
  source        text,
  -- referência legível do registro: "PL 1470", "1705.01"...
  ref           text,
  -- app (Vercel) ou script (máquina local)
  origin        text not null default 'app'
);

create index if not exists gss_call_log_created_at_idx on public.gss_call_log (created_at desc);
create index if not exists gss_call_log_errors_idx on public.gss_call_log (created_at desc) where kind <> 'ok';

alter table public.gss_call_log enable row level security;

comment on table public.gss_call_log is
  'Toda chamada do SOTWISE à API do GSS (gssRequest). Tela: /access/gss/calls.';
