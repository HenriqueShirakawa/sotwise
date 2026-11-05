# Relay do WeChat (Service Account)

O SOT roda na Vercel, que **não tem IP de saída fixo**. Já a Service Account do
WeChat (服务号) só entrega o `access_token` a IPs cadastrados na **IP白名单**
(开发 → 基本配置). Este relay resolve isso: fica num servidor com IP fixo, e o
SOT faz todas as chamadas à API do WeChat por ele.

O **测试号** (conta de teste do WeChat) não tem lista de IP. Para testar com ele,
não precisa de relay: deixe `WECHAT_RELAY_URL` vazia.

O código está em `server.mjs`, usa Node 18+ e não tem dependências.

## Rotas

| Rota | Quem chama | Para quê |
|---|---|---|
| `POST /proxy` | SOT (`lib/wechat/client.ts`) | Repassa a chamada para `api.weixin.qq.com`. Exige `Authorization: Bearer RELAY_SECRET` e só aceita caminhos `/cgi-bin/...` |
| `GET/POST /callback` | WeChat | Repassa o callback sem alterar nada para `SOT_CALLBACK_URL`. **Só use** se os servidores do WeChat não conseguirem chamar o domínio do SOT |
| `GET /health` | monitoramento | `{"ok":true}` |

## Subir

1. Contrate uma VPS com IP fixo. Hong Kong ou Singapura funcionam bem para BR e China.
2. Instale o Node 18+ e copie o `server.mjs`.
3. Gere um segredo com `openssl rand -hex 32` e rode:

   ```bash
   RELAY_SECRET=<segredo> PORT=8080 node server.mjs
   ```

   Em produção, rode via systemd ou pm2, com HTTPS na frente (Caddy ou nginx).
4. Na Service Account, cadastre o IP da VPS em **开发 → 基本配置 → IP白名单**.
5. Na Vercel, configure `WECHAT_RELAY_URL=https://<relay>` e `WECHAT_RELAY_SECRET=<segredo>`.

## Callback

O padrão é cadastrar `https://<domínio do SOT>/api/wechat/callback` em
**开发 → 基本配置 → 服务器配置** (URL). Os servidores do WeChat chamam o SOT
direto.

Se essa chamada não chegar (bloqueio de rede entre a China e o domínio), use o
relay como ponte:

1. Configure no relay `SOT_CALLBACK_URL=https://<domínio do SOT>/api/wechat/callback`.
2. Cadastre `https://<relay>/callback` como URL no WeChat.

A assinatura e a decifragem continuam sendo feitas no SOT. O relay apenas repassa
o callback e nunca vê o Token nem a chave AES.
