-- =============================================================================
-- WeChat (Service Account, 服务号) — fase 1: SÓ EQUIPES (BR + China), ida e volta.
--
-- Decisões de 04/11/2026 (docs §6.15):
--  * WeChat normal, sem WeCom: a equipe SEGUE a conta oficial da empresa;
--  * só o módulo de mensagens: quem é marcado no "Forward to" recebe no WeChat;
--  * a resposta vira mensagem na thread do registro, MAS só se começar com o
--    número ("1676 ...", "PL 1473 ...", "SH 1473 ..."). Sem número, o SOT
--    devolve a instrução e não grava nada;
--  * clientes e fornecedores ficam de fora nesta fase.
--
-- Aditiva: nada existente muda de comportamento enquanto ninguém tiver
-- `wechat_openid` preenchido.
-- =============================================================================

-- OpenID da pessoa NESTA Service Account (opaco, ninguém digita): gravado pelo
-- callback quando ela escaneia o QR de vínculo gerado em Users → Edit.
-- Único: um WeChat responde por UM usuário do SOT, senão a resposta que chega
-- não teria dono certo.
alter table public.profiles add column wechat_openid text;

create unique index profiles_wechat_openid_key
  on public.profiles (wechat_openid)
  where wechat_openid is not null;

-- Rastro de tudo que vai e volta, no molde do gss_call_log. Serve de auditoria
-- ("chegou no celular dele?") e de trava de duplicidade: o WeChat reenvia o
-- mesmo callback até 3x se não responder a tempo, com o mesmo MsgId.
create table public.wechat_message_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  direction      text not null check (direction in ('out', 'in')),
  -- out: sent | failed
  -- in:  processing | accepted | rejected | failed | ignored
  status         text not null,
  -- out: custom (texto completo, janela de 48h) | template (aviso fora da janela)
  channel        text check (channel in ('custom', 'template')),
  wechat_openid  text,
  profile_id     uuid references public.profiles(id) on delete set null,
  message_id     uuid references public.messages(id) on delete set null,
  -- out: msgid devolvido pela API; in: MsgId do callback (chave de dedup).
  wechat_msgid   text,
  body           text,
  error          text
);

create unique index wechat_message_log_in_msgid_key
  on public.wechat_message_log (wechat_msgid)
  where direction = 'in' and wechat_msgid is not null;

create index idx_wechat_message_log_created on public.wechat_message_log (created_at desc);
create index idx_wechat_message_log_message on public.wechat_message_log (message_id);

-- RLS deny-all, no padrão do schema: acesso só pelo service_role.
alter table public.wechat_message_log enable row level security;
