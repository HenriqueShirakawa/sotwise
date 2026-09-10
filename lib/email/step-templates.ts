import type { ChecklistStep } from "@/types/database";

type Lang = "pt-BR" | "en" | "zh";

/**
 * Corpo padrão sugerido ao abrir o compositor de e-mail de uma etapa — só um
 * ponto de partida editável (nunca enviado sem revisão, ver `StepEmailSection`).
 * Hoje só "pi" (Proforma Invoice) tem texto padrão; as demais etapas caem no
 * corpo vazio de sempre. Sempre em inglês + no idioma do cliente (resolvido
 * do mesmo jeito que o chrome do e-mail, ver `resolveStepEmailLanguage`) —
 * pedido explícito do usuário: o cliente não deve depender só do inglês.
 */
const TEMPLATES: Partial<Record<ChecklistStep, Record<Lang, string>>> = {
  pi: {
    en: `Dear [Customer Name],

Please find attached the Proforma Invoice for your confirmed order.

Kindly review all the information and, if everything is correct, please sign and return the Proforma Invoice to us as confirmation of the order.

To proceed with the order and start production, we also kindly ask you to arrange the foreign exchange closing for the advance payment according to the payment terms stated in the Proforma Invoice.

Once we receive the signed Proforma Invoice and confirmation of the exchange closing/payment of the advance, we will proceed with the order and release it for production.

Please let us know if you have any questions or if any information needs to be adjusted.

Thank you for your cooperation.

Best regards,
[Your Name]
[Company Name]`,
    "pt-BR": `Prezado(a) [Nome do Cliente],

Segue em anexo a Proforma Invoice referente ao seu pedido confirmado.

Por gentileza, revise todas as informações e, caso esteja tudo correto, assine e nos devolva a Proforma Invoice como confirmação do pedido.

Para darmos andamento ao pedido e iniciarmos a produção, solicitamos também que providencie o fechamento de câmbio referente ao pagamento antecipado, conforme as condições de pagamento indicadas na Proforma Invoice.

Assim que recebermos a Proforma Invoice assinada e a confirmação do fechamento de câmbio/pagamento do adiantamento, daremos seguimento ao pedido e o liberaremos para produção.

Qualquer dúvida ou necessidade de ajuste em alguma informação, estamos à disposição.

Agradecemos a colaboração.

Atenciosamente,
[Seu nome]
[Nome da empresa]`,
    zh: `尊敬的[客户姓名]:

随函附上贵司已确认订单的形式发票(Proforma Invoice),请查收。

请核对发票中的所有信息,如确认无误,烦请签署形式发票并回传给我们,以确认订单。

为推进订单并安排生产,亦烦请贵司按照形式发票所载的付款条件,办理预付款所需的外汇结汇手续。

在收到签署后的形式发票以及结汇/预付款确认后,我们将正式推进订单并安排投入生产。

如有任何疑问,或发票信息需要调整之处,请随时告知我们。

感谢贵司的配合。

此致
敬礼

[您的姓名]
[公司名称]`,
  },
};

/** Se a etapa tem texto padrão — evita round-trip de idioma pras outras 23. */
export function stepHasTemplate(step: ChecklistStep): boolean {
  return Boolean(TEMPLATES[step]);
}

/**
 * Inglês sempre presente; idioma do cliente entra embaixo, com um separador
 * simples, quando resolve pra algo diferente de 'en' (ver
 * `resolveStepEmailLanguage`). Corpo continua 100% editável depois de aberto.
 */
export function buildDefaultStepBody(step: ChecklistStep, language: Lang): string {
  const template = TEMPLATES[step];
  if (!template) return "";
  if (language === "en") return template.en;
  return `${template.en}\n\n——————————\n\n${template[language]}`;
}
