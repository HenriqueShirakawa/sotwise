import type { ChecklistStep, EmailLanguage } from "@/types/database";

/**
 * Corpo padrão sugerido ao abrir o compositor de e-mail de uma etapa — só um
 * ponto de partida editável (nunca enviado sem revisão, ver `StepEmailSection`).
 * Mapa exaustivo por idioma (`Record`, não `Partial`) — as 24 etapas do
 * checklist têm texto próprio em cada um dos 3 idiomas suportados
 * (`EmailLanguage`), redigido a partir do significado de cada uma em
 * `docs/regras_de_negocio.md` §3.7.5.
 *
 * Textos estáticos, não tradução automática — decisão do usuário em 14/09/2026
 * (`5615a4f`): a tradução dinâmica via Claude dependia de crédito de API, que
 * não é garantido. `[Customer Name]`/`[Your Name]` permanecem em inglês mesmo
 * nos outros idiomas — são tokens que `buildDefaultStepBody` substitui por
 * igualdade de string exata, não texto a traduzir.
 */
const EN_TEMPLATES: Record<ChecklistStep, string> = {
  order: `Dear [Customer Name],

We are writing to confirm that your order has been received and successfully registered in our system.

Our team will now begin processing the next steps, and we will keep you updated as the order progresses.

Please let us know if you have any questions.

Best regards,
[Your Name]`,

  po: `Dear [Customer Name],

Please find attached the Purchase Order (PO) corresponding to your order.

Kindly review the items, quantities and factory allocations listed, and let us know if everything is correct or if any adjustment is needed.

Once confirmed, we will proceed with the next steps of the process.

Best regards,
[Your Name]`,

  pi: `Dear [Customer Name],

Please find attached the Proforma Invoice for your confirmed order.

Kindly review all the information and, if everything is correct, please sign and return the Proforma Invoice to us as confirmation of the order.

To proceed with the order and start production, we also kindly ask you to arrange the foreign exchange closing for the advance payment according to the payment terms stated in the Proforma Invoice.

Once we receive the signed Proforma Invoice and confirmation of the exchange closing/payment of the advance, we will proceed with the order and release it for production.

Please let us know if you have any questions or if any information needs to be adjusted.

Thank you for your cooperation.

Best regards,
[Your Name]`,

  deposit_payment: `Dear [Customer Name],

We confirm that the deposit payment for your order has been received.

With the advance payment settled, we will proceed accordingly with production.

Please let us know if you have any questions.

Best regards,
[Your Name]`,

  packing_confirm: `Dear [Customer Name],

We would like to confirm the packing details for your order.

Please review the information provided and let us know if everything is in accordance with your requirements, or if any adjustment is needed.

Best regards,
[Your Name]`,

  condition_confirm: `Dear [Customer Name],

We would like to confirm the condition of the goods for your order.

Please review the details provided and let us know if everything is satisfactory, or if any adjustment is required before we proceed.

Best regards,
[Your Name]`,

  place_the_order: `Dear [Customer Name],

This is to confirm that your order has been placed with the factory and released for production.

We will keep you informed as production progresses.

Please let us know if you have any questions.

Best regards,
[Your Name]`,

  etd: `Dear [Customer Name],

Please find below the Estimated Time of Departure (ETD) information for your order.

Let us know if you have any questions regarding the schedule.

Best regards,
[Your Name]`,

  balance_payment: `Dear [Customer Name],

This is to confirm receipt of the balance payment for your order.

With the payment settled in full, we will proceed with the next steps toward shipment.

Please let us know if you have any questions.

Best regards,
[Your Name]`,

  pre_loading: `Dear [Customer Name],

Your order is now ready to proceed to the pre-loading stage.

We will keep you informed as the consolidation and loading arrangements move forward.

Please let us know if you have any questions.

Best regards,
[Your Name]`,

  consolidation_point: `Dear [Customer Name],

Please find below the consolidation point confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  city: `Dear [Customer Name],

Please find below the city confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  port_of_loading: `Dear [Customer Name],

Please find below the Port of Loading confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  shipping_docs: `Dear [Customer Name],

Please find attached the shipping documents for your order.

Kindly review them and let us know if everything is correct, or if any adjustment is needed.

Best regards,
[Your Name]`,

  agents: `Dear [Customer Name],

Please find below the agents assigned to your shipment in Brazil and China, along with their respective contacts.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  booking: `Dear [Customer Name],

We confirm that the booking for your shipment has been completed.

Please find below the booking details.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  loading_date: `Dear [Customer Name],

Please find below the loading date confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  shipping_date: `Dear [Customer Name],

We are pleased to confirm that your shipment has departed.

Please find below the shipping date details.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  bl: `Dear [Customer Name],

Please find attached the Bill of Lading (BL) for your shipment.

Kindly review it and let us know if everything is correct, or if any adjustment is needed.

Best regards,
[Your Name]`,

  original_docs: `Dear [Customer Name],

Please find attached the original shipping documents for your order.

Kindly review them and let us know if you have any questions.

Best regards,
[Your Name]`,

  inspection_report: `Dear [Customer Name],

Please find attached the inspection report for your order.

Kindly review it and let us know if everything is in order, or if any adjustment is needed.

Best regards,
[Your Name]`,

  eta_brazil: `Dear [Customer Name],

Please find below the Estimated Time of Arrival (ETA) in Brazil for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  ata_brazil: `Dear [Customer Name],

We are pleased to confirm that your shipment has arrived in Brazil.

Please find below the arrival details.

Let us know if you have any questions.

Best regards,
[Your Name]`,

  delivered: `Dear [Customer Name],

We are pleased to confirm that your order has been delivered.

Thank you for your business — please let us know if you have any questions or need any further assistance.

Best regards,
[Your Name]`,
};

/** ⚠️ Rascunho meu (Claude), escrito em 15/09/2026 a pedido do usuário —
 *  revisar antes de confiar plenamente, mesmo em português (a v1 bilíngue
 *  anterior, removida em 10/09, tinha erros de tradução). */
const PT_BR_TEMPLATES: Record<ChecklistStep, string> = {
  order: `Prezado(a) [Customer Name],

Escrevemos para confirmar que seu pedido foi recebido e registrado com sucesso em nosso sistema.

Nossa equipe iniciará agora o processamento das próximas etapas, e manteremos você informado(a) conforme o pedido avançar.

Por favor, nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  po: `Prezado(a) [Customer Name],

Segue em anexo o Purchase Order (PO) referente ao seu pedido.

Pedimos a gentileza de revisar os itens, quantidades e fábricas alocadas listados, e nos informar se está tudo correto ou se algum ajuste é necessário.

Após a confirmação, seguiremos com as próximas etapas do processo.

Atenciosamente,
[Your Name]`,

  pi: `Prezado(a) [Customer Name],

Segue em anexo a Proforma Invoice referente ao seu pedido confirmado.

Pedimos a gentileza de revisar todas as informações e, caso esteja tudo correto, assinar e nos devolver a Proforma Invoice como confirmação do pedido.

Para darmos seguimento ao pedido e iniciarmos a produção, solicitamos também que providencie o fechamento de câmbio referente ao pagamento antecipado, conforme as condições de pagamento indicadas na Proforma Invoice.

Assim que recebermos a Proforma Invoice assinada e a confirmação do fechamento de câmbio/pagamento do adiantamento, daremos seguimento ao pedido e o liberaremos para produção.

Por favor, nos avise caso tenha alguma dúvida ou se alguma informação precisar ser ajustada.

Agradecemos pela colaboração.

Atenciosamente,
[Your Name]`,

  deposit_payment: `Prezado(a) [Customer Name],

Confirmamos o recebimento do pagamento do sinal (deposit) referente ao seu pedido.

Com o pagamento antecipado quitado, daremos seguimento à produção.

Por favor, nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  packing_confirm: `Prezado(a) [Customer Name],

Gostaríamos de confirmar os detalhes de embalagem (packing) do seu pedido.

Pedimos a gentileza de revisar as informações fornecidas e nos informar se está tudo de acordo com suas exigências, ou se algum ajuste é necessário.

Atenciosamente,
[Your Name]`,

  condition_confirm: `Prezado(a) [Customer Name],

Gostaríamos de confirmar a condição das mercadorias do seu pedido.

Pedimos a gentileza de revisar os detalhes fornecidos e nos informar se está tudo satisfatório, ou se algum ajuste é necessário antes de prosseguirmos.

Atenciosamente,
[Your Name]`,

  place_the_order: `Prezado(a) [Customer Name],

Confirmamos que seu pedido foi colocado junto à fábrica e liberado para produção.

Manteremos você informado(a) conforme a produção avançar.

Por favor, nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  etd: `Prezado(a) [Customer Name],

Seguem abaixo as informações de Estimated Time of Departure (ETD) do seu pedido.

Nos avise caso tenha alguma dúvida sobre o cronograma.

Atenciosamente,
[Your Name]`,

  balance_payment: `Prezado(a) [Customer Name],

Confirmamos o recebimento do pagamento do saldo (balance) referente ao seu pedido.

Com o pagamento quitado integralmente, seguiremos com as próximas etapas rumo ao embarque.

Por favor, nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  pre_loading: `Prezado(a) [Customer Name],

Seu pedido está pronto para seguir à etapa de pré-embarque (pre-loading).

Manteremos você informado(a) conforme a consolidação e os preparativos de carregamento avançarem.

Por favor, nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  consolidation_point: `Prezado(a) [Customer Name],

Segue abaixo o ponto de consolidação (consolidation point) confirmado para o seu embarque.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  city: `Prezado(a) [Customer Name],

Segue abaixo a cidade confirmada para o seu embarque.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  port_of_loading: `Prezado(a) [Customer Name],

Segue abaixo o Port of Loading confirmado para o seu embarque.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  shipping_docs: `Prezado(a) [Customer Name],

Seguem em anexo os documentos de embarque (shipping documents) do seu pedido.

Pedimos a gentileza de revisá-los e nos informar se está tudo correto, ou se algum ajuste é necessário.

Atenciosamente,
[Your Name]`,

  agents: `Prezado(a) [Customer Name],

Seguem abaixo os agentes designados para o seu embarque no Brasil e na China, com os respectivos contatos.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  booking: `Prezado(a) [Customer Name],

Confirmamos que o booking do seu embarque foi concluído.

Seguem abaixo os detalhes do booking.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  loading_date: `Prezado(a) [Customer Name],

Segue abaixo a data de carregamento (loading date) confirmada para o seu embarque.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  shipping_date: `Prezado(a) [Customer Name],

Temos o prazer de confirmar que o seu embarque partiu.

Seguem abaixo os detalhes da data de embarque (shipping date).

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  bl: `Prezado(a) [Customer Name],

Segue em anexo o Bill of Lading (BL) do seu embarque.

Pedimos a gentileza de revisá-lo e nos informar se está tudo correto, ou se algum ajuste é necessário.

Atenciosamente,
[Your Name]`,

  original_docs: `Prezado(a) [Customer Name],

Seguem em anexo os documentos originais de embarque do seu pedido.

Pedimos a gentileza de revisá-los e nos informar caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  inspection_report: `Prezado(a) [Customer Name],

Segue em anexo o relatório de inspeção (inspection report) do seu pedido.

Pedimos a gentileza de revisá-lo e nos informar se está tudo em ordem, ou se algum ajuste é necessário.

Atenciosamente,
[Your Name]`,

  eta_brazil: `Prezado(a) [Customer Name],

Seguem abaixo as informações de Estimated Time of Arrival (ETA) no Brasil para o seu embarque.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  ata_brazil: `Prezado(a) [Customer Name],

Temos o prazer de confirmar que o seu embarque chegou ao Brasil.

Seguem abaixo os detalhes da chegada.

Nos avise caso tenha alguma dúvida.

Atenciosamente,
[Your Name]`,

  delivered: `Prezado(a) [Customer Name],

Temos o prazer de confirmar que o seu pedido foi entregue.

Agradecemos pela parceria — por favor, nos avise caso tenha alguma dúvida ou precise de qualquer assistência adicional.

Atenciosamente,
[Your Name]`,
};

/** ⚠️ Rascunho meu (Claude), escrito em 15/09/2026 — NÃO revisado por falante
 *  nativo de chinês. Pedir revisão antes de confiar plenamente em produção
 *  (mesma cautela da v1 em português, que tinha erros e foi removida). */
const ZH_TEMPLATES: Record<ChecklistStep, string> = {
  order: `尊敬的 [Customer Name]：

我们写信确认，您的订单已收到，并已成功登记至我们的系统。

我们的团队现在将开始处理后续步骤，并会在订单进展过程中及时向您更新。

如有任何疑问，请随时告知我们。

顺祝商祺，
[Your Name]`,

  po: `尊敬的 [Customer Name]：

随函附上与您订单相对应的采购订单（PO）。

请您审核其中列明的品项、数量及工厂分配情况，并告知我们是否一切无误，或是否需要调整。

确认后，我们将继续推进后续流程。

顺祝商祺，
[Your Name]`,

  pi: `尊敬的 [Customer Name]：

随函附上您已确认订单的形式发票（Proforma Invoice）。

请审核全部信息，如确认无误，请在形式发票上签字并回传给我们，作为订单确认。

为推进订单并启动生产，也请您按照形式发票中注明的付款条件，安排预付款的外汇购付汇。

在收到已签署的形式发票及外汇购付汇/预付款确认后，我们将继续推进订单并安排投产。

如有任何疑问，或有信息需要调整，请告知我们。

感谢您的配合。

顺祝商祺，
[Your Name]`,

  deposit_payment: `尊敬的 [Customer Name]：

我们确认已收到您订单的定金付款。

预付款结清后，我们将据此推进生产。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  packing_confirm: `尊敬的 [Customer Name]：

我们希望确认您订单的装箱细节。

请审核所提供的信息，并告知我们是否符合您的要求，或是否需要调整。

顺祝商祺，
[Your Name]`,

  condition_confirm: `尊敬的 [Customer Name]：

我们希望确认您订单货物的状况。

请审核所提供的详情，并告知我们是否一切满意，或在我们继续推进前是否需要任何调整。

顺祝商祺，
[Your Name]`,

  place_the_order: `尊敬的 [Customer Name]：

现确认您的订单已下达至工厂，并已放行投产。

我们将在生产推进过程中持续向您通报。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  etd: `尊敬的 [Customer Name]：

以下为您订单的预计离港时间（ETD）信息。

如对时间安排有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  balance_payment: `尊敬的 [Customer Name]：

现确认已收到您订单的尾款付款。

款项全部结清后，我们将继续推进发运相关的后续步骤。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  pre_loading: `尊敬的 [Customer Name]：

您的订单现已准备好进入装运前（pre-loading）阶段。

我们将在并柜及装货安排推进过程中持续向您通报。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  consolidation_point: `尊敬的 [Customer Name]：

以下为您本次发运确认的集货点（consolidation point）。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  city: `尊敬的 [Customer Name]：

以下为您本次发运确认的城市。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  port_of_loading: `尊敬的 [Customer Name]：

以下为您本次发运确认的装货港（Port of Loading）。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  shipping_docs: `尊敬的 [Customer Name]：

随函附上您订单的装运单据。

请审核相关单据，并告知我们是否一切无误，或是否需要调整。

顺祝商祺，
[Your Name]`,

  agents: `尊敬的 [Customer Name]：

以下为负责您本次发运的巴西及中国代理，及其相应联系方式。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  booking: `尊敬的 [Customer Name]：

我们确认您本次发运的订舱（booking）已完成。

以下为订舱详情。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  loading_date: `尊敬的 [Customer Name]：

以下为您本次发运确认的装货日期。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  shipping_date: `尊敬的 [Customer Name]：

我们很高兴地确认，您的货物已发运。

以下为发运日期详情。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  bl: `尊敬的 [Customer Name]：

随函附上您本次发运的提单（Bill of Lading, BL）。

请审核该提单，并告知我们是否一切无误，或是否需要调整。

顺祝商祺，
[Your Name]`,

  original_docs: `尊敬的 [Customer Name]：

随函附上您订单的正本装运单据。

请审核相关单据，如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  inspection_report: `尊敬的 [Customer Name]：

随函附上您订单的验货报告（inspection report）。

请审核该报告，并告知我们是否一切正常，或是否需要调整。

顺祝商祺，
[Your Name]`,

  eta_brazil: `尊敬的 [Customer Name]：

以下为您本次发运抵达巴西的预计到港时间（ETA）信息。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  ata_brazil: `尊敬的 [Customer Name]：

我们很高兴地确认，您的货物已抵达巴西。

以下为到港详情。

如有任何疑问，请告知我们。

顺祝商祺，
[Your Name]`,

  delivered: `尊敬的 [Customer Name]：

我们很高兴地确认，您的订单已完成交付。

感谢您的支持与信任——如有任何疑问，或需要进一步协助，请随时告知我们。

顺祝商祺，
[Your Name]`,
};

const TEMPLATES: Record<EmailLanguage, Record<ChecklistStep, string>> = {
  en: EN_TEMPLATES,
  "pt-BR": PT_BR_TEMPLATES,
  zh: ZH_TEMPLATES,
};

/**
 * `[Customer Name]`/`[Your Name]` viram o nome de verdade quando resolvidos
 * (ver `loadStepEmailDefaults`); sem resolver, fica o colchete original,
 * editável à mão. Corpo continua 100% editável depois de aberto.
 *
 * `language` (default `'en'`) escolhe QUAL corpo — desde 15/09/2026, só quem
 * chama isto é o COMPOSITOR (`StepEmailSection.openCompose`, com o idioma
 * resolvido do cliente): a caixa já nasce no idioma certo, e dali pra frente
 * é WYSIWYG — o que estiver escrito é o que sai pro cliente E pra equipe
 * interna (`renderStepEmailHtmls` em `lib/checklist-email-actions.ts` usa
 * `input.body` direto, sem chamar isto de novo nem sobrescrever o que foi
 * editado).
 *
 * Assinatura termina só em `[Your Name]` (removido `[Company Name]` em
 * 17/09/2026, pedido do usuário: a linha com o nome do cliente no fechamento
 * — "Atenciosamente, Fulano, Cliente X" — foi removida de propósito; agora
 * termina só "Atenciosamente, Fulano"). `[Customer Name]` continua só na
 * saudação de abertura ("Prezado(a) [Customer Name],").
 */
export function buildDefaultStepBody(
  step: ChecklistStep,
  vars: { customerName?: string | null; senderName?: string | null },
  language: EmailLanguage = "en"
): string {
  let body = TEMPLATES[language][step];
  if (vars.customerName) body = body.replace("[Customer Name]", vars.customerName);
  if (vars.senderName) body = body.replace("[Your Name]", vars.senderName);
  return body;
}
