# SOT: Mini Program do fornecedor (WeChat 小程序)

Fase 2 da integração WeChat (16/11/2026, `docs/regras_de_negocio.md` §6.17). O
contato da **fábrica** usa o Mini Program para:
- informar a ETD (Initial Date);
- avisar atraso (Current Date + motivo);
- confirmar Ready parts.

Ele não é usuário do SOT: a identidade vem do WeChat (`wx.login` → `/api/mp/login`).

## Rodar (dev)

1. Abrir esta pasta no 微信开发者工具 (WeChat DevTools).
2. Em `project.config.json`, trocar `appid` pelo AppID do 测试号 do Mini Program.
3. No SOT (Vercel, dev), definir `WECHAT_MP_APP_ID` e `WECHAT_MP_APP_SECRET`. Para o QR do convite abrir a versão de dev, definir também `WECHAT_MP_ENV_VERSION=develop`.
4. No DevTools, em 详情 → 本地设置, marcar "不校验合法域名" até o domínio ser cadastrado.
5. O `config.js` já aponta para `https://dev.sot.gssdatahub.com`.

## Fluxo

1. A equipe gera o convite no SOT: Registration → Factories → ícone WeChat → **Invite a contact**. Sai um código de 8 caracteres + QR, de uso único, válido por 7 dias.
2. O fornecedor abre o Mini Program e digita o código e o nome (ou escaneia o QR).
3. Ele vê as linhas abertas da fábrica, primeiro as que ainda não têm Initial Date, e responde.

Páginas: `pages/lines` (lista + respostas) e `pages/bind` (vínculo).
Backend: `app/api/mp/*` e `lib/wechat-mp/*`. As regras de ETD são as do `patchEtd`
(`domain/etd-factories/api-write.ts`).
