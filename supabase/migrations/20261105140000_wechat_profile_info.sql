-- =============================================================================
-- WeChat: nome e foto de quem vinculou (05/11/2026, docs §6.15).
--
-- O WeChat não entrega nome/foto no vínculo por QR. Eles chegam pela
-- "autorização de página" (网页授权, snsapi_userinfo): depois de vincular, o
-- robô manda um link; a pessoa abre no WeChat, toca em permitir e o SOT grava
-- aqui. Telefone e e-mail o WeChat nunca libera.
--
-- Aditiva. Somem junto com o vínculo (Unlink / vincular em outro usuário).
-- =============================================================================

alter table public.profiles add column wechat_nickname text;
alter table public.profiles add column wechat_avatar_url text;
