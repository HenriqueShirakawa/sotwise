# Plano — zerar os 2 bancos + main no SOT-VISTA

_27/10/2026 · para aprovação · nada executado ainda_

## Objetivo

- **Zerar o transacional nos 2 bancos:** Order, Lote, Pre-loading e Shipment, e tudo que depende deles (F×C, ETD, checklists, History, revisões, anexos, e-mails e mensagens das etapas).
- **Main (produção)** passa a usar o **SOT-VISTA** (`yfeejjzjjwwnbflsztur`), com as bibliotecas e os usuários do AGK.
- **Dev** continua no **AGK**, também zerado.
- **Quem cria as orders e os lotes daqui pra frente é o GSS.** O Bubble não entra nesta etapa.

## Estado final

| | Banco | Transacional | Bibliotecas + usuários |
|---|---|---|---|
| main (sot.gssdatahub.com) | SOT-VISTA | vazio → o GSS cria | cópia do AGK |
| dev | AGK | vazio → o GSS cria | os de hoje |

## O que preciso de você

1. **PAT novo do Supabase**, da conta vistapub com leitura no AGK. Serve pra copiar usuários e senhas; o atual dá 401.
2. **Colar o SQL do wipe no SQL Editor do AGK.** Daqui eu não tenho acesso de `postgres` ao AGK, e as tabelas de e-mail bloqueiam DELETE pelo service role. No SOT-VISTA eu rodo, porque o `DST_DB_URL` funciona.
3. **Trocar as 4 variáveis do Supabase na Vercel**, só no ambiente Production do projeto main, e fazer redeploy.
4. **Site URL e Redirect URLs** no Auth do SOT-VISTA: `https://sot.gssdatahub.com` e `sot.gssdatahub.com/**`.
5. **Janela sem uso**, do passo 2 ao 6.

## Passos

1. **Preparar (sem efeito):** o SQL do wipe, com a ordem certa e a lista dos arquivos de anexo pra limpar do storage. Antes de rodar, conferir as FKs reais no banco.
2. **Zerar o AGK:** você cola o SQL no Studio, e eu limpo os anexos do bucket `order-documents`. A dev fica vazia nesse momento.
3. **Schema do SOT-VISTA em dia:** aplicar as migrations que faltam desde 24/09, o mesmo conjunto do AGK.
4. **Copiar AGK → SOT-VISTA** (`scripts/migrate-project/espelhar-via-api.sh --wipe`). Como o AGK já está zerado, vão só as bibliotecas e os usuários. Conferir as contagens origem × destino.
5. **Virar a main:** você troca as variáveis e faz redeploy. Antes, eu confiro se Preview e Production não compartilham essas variáveis, pra dev seguir no AGK.
6. **Smoke test:**
   - login (todo mundo é deslogado uma vez; a senha continua valendo);
   - owner;
   - listas vazias;
   - `/api/docs` no ar;
   - um `POST /api/orders` de teste, apagado em seguida.
7. **O GSS começa a criar orders e lotes** em produção. O cron de orders (`GSS_ORDERS_PULL_ENABLED`) fica como você decidir.

## Ordem do wipe (SQL, como `postgres`)

1. `email_threads`. Tem que ir **primeiro**: o ciclo com `checklist_step_emails` trava o resto.
2. Respostas, destinatários e eventos de e-mail → `checklist_step_emails`.
3. `checklist_step_log`, `checklist_step_revisions`, `step_attachments`.
4. `shipment_loaded_lines` → `shipments`.
5. Bookings/docs/delivered por cliente, `pre_loading_batches`, `pre_loading_clients`, `pre_loading_checklist_steps` → `pre_loadings`.
6. `client_notifications`, `etd_history` → `etd_info`, `order_factory_placed_dates`, `order_factory_category`, `order_checklist_steps` → `batches` → `orders`.
7. Sem FK, então precisam ser apagados à mão: `messages` (de order/PL/shipment), `gss_outbound`, `gss_sync_log`, `activity_logs` desses registros.

Bibliotecas, usuários, papéis e permissões não são tocados.

## O que se perde (aceito em 27/10)

Todos os orders, lotes, PLs e shipments atuais, e tudo pendurado neles: History, revisões, anexos e e-mails das etapas.

## Depois (fora deste plano)

Puxar PLs e Shipments do Bubble e ligar os checklists. Aí entra o ajuste do import, que hoje só acha a order/lote pelo `bubble_id`.
