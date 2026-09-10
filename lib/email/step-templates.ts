import type { ChecklistStep } from "@/types/database";

/**
 * Corpo padrão sugerido ao abrir o compositor de e-mail de uma etapa — só um
 * ponto de partida editável (nunca enviado sem revisão, ver `StepEmailSection`).
 * Mapa exaustivo (`Record`, não `Partial`) — as 24 etapas do checklist têm
 * texto próprio, redigido a partir do significado de cada uma em
 * `docs/regras_de_negocio.md` §3.7.5. Só em inglês — a versão bilíngue
 * (inglês + tradução automática) foi removida a pedido do usuário (tinha erro
 * na tradução).
 */
const TEMPLATES: Record<ChecklistStep, string> = {
  order: `Dear [Customer Name],

We are writing to confirm that your order has been received and successfully registered in our system.

Our team will now begin processing the next steps, and we will keep you updated as the order progresses.

Please let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  po: `Dear [Customer Name],

Please find attached the Purchase Order (PO) corresponding to your order.

Kindly review the items, quantities and factory allocations listed, and let us know if everything is correct or if any adjustment is needed.

Once confirmed, we will proceed with the next steps of the process.

Best regards,
[Your Name]
[Company Name]`,

  pi: `Dear [Customer Name],

Please find attached the Proforma Invoice for your confirmed order.

Kindly review all the information and, if everything is correct, please sign and return the Proforma Invoice to us as confirmation of the order.

To proceed with the order and start production, we also kindly ask you to arrange the foreign exchange closing for the advance payment according to the payment terms stated in the Proforma Invoice.

Once we receive the signed Proforma Invoice and confirmation of the exchange closing/payment of the advance, we will proceed with the order and release it for production.

Please let us know if you have any questions or if any information needs to be adjusted.

Thank you for your cooperation.

Best regards,
[Your Name]
[Company Name]`,

  deposit_payment: `Dear [Customer Name],

We confirm that the deposit payment for your order has been received.

With the advance payment settled, we will proceed accordingly with production.

Please let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  packing_confirm: `Dear [Customer Name],

We would like to confirm the packing details for your order.

Please review the information provided and let us know if everything is in accordance with your requirements, or if any adjustment is needed.

Best regards,
[Your Name]
[Company Name]`,

  condition_confirm: `Dear [Customer Name],

We would like to confirm the condition of the goods for your order.

Please review the details provided and let us know if everything is satisfactory, or if any adjustment is required before we proceed.

Best regards,
[Your Name]
[Company Name]`,

  place_the_order: `Dear [Customer Name],

This is to confirm that your order has been placed with the factory and released for production.

We will keep you informed as production progresses.

Please let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  etd: `Dear [Customer Name],

Please find below the Estimated Time of Departure (ETD) information for your order.

Let us know if you have any questions regarding the schedule.

Best regards,
[Your Name]
[Company Name]`,

  balance_payment: `Dear [Customer Name],

This is to confirm receipt of the balance payment for your order.

With the payment settled in full, we will proceed with the next steps toward shipment.

Please let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  pre_loading: `Dear [Customer Name],

Your order is now ready to proceed to the pre-loading stage.

We will keep you informed as the consolidation and loading arrangements move forward.

Please let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  consolidation_point: `Dear [Customer Name],

Please find below the consolidation point confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  city: `Dear [Customer Name],

Please find below the city confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  port_of_loading: `Dear [Customer Name],

Please find below the Port of Loading confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  shipping_docs: `Dear [Customer Name],

Please find attached the shipping documents for your order.

Kindly review them and let us know if everything is correct, or if any adjustment is needed.

Best regards,
[Your Name]
[Company Name]`,

  agents: `Dear [Customer Name],

Please find below the agents assigned to your shipment in Brazil and China, along with their respective contacts.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  booking: `Dear [Customer Name],

We confirm that the booking for your shipment has been completed.

Please find below the booking details.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  loading_date: `Dear [Customer Name],

Please find below the loading date confirmed for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  shipping_date: `Dear [Customer Name],

We are pleased to confirm that your shipment has departed.

Please find below the shipping date details.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  bl: `Dear [Customer Name],

Please find attached the Bill of Lading (BL) for your shipment.

Kindly review it and let us know if everything is correct, or if any adjustment is needed.

Best regards,
[Your Name]
[Company Name]`,

  original_docs: `Dear [Customer Name],

Please find attached the original shipping documents for your order.

Kindly review them and let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  inspection_report: `Dear [Customer Name],

Please find attached the inspection report for your order.

Kindly review it and let us know if everything is in order, or if any adjustment is needed.

Best regards,
[Your Name]
[Company Name]`,

  eta_brazil: `Dear [Customer Name],

Please find below the Estimated Time of Arrival (ETA) in Brazil for your shipment.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  ata_brazil: `Dear [Customer Name],

We are pleased to confirm that your shipment has arrived in Brazil.

Please find below the arrival details.

Let us know if you have any questions.

Best regards,
[Your Name]
[Company Name]`,

  delivered: `Dear [Customer Name],

We are pleased to confirm that your order has been delivered.

Thank you for your business — please let us know if you have any questions or need any further assistance.

Best regards,
[Your Name]
[Company Name]`,
};

/**
 * `[Customer Name]`/`[Your Name]` viram o nome de verdade quando resolvidos
 * (ver `loadStepEmailDefaults`); sem resolver, fica o colchete original,
 * editável à mão. `[Company Name]` também vira o cliente — pedido explícito
 * do usuário, não é a empresa de quem envia. Corpo continua 100% editável
 * depois de aberto.
 */
export function buildDefaultStepBody(
  step: ChecklistStep,
  vars: { customerName?: string | null; senderName?: string | null }
): string {
  let body = TEMPLATES[step];
  if (vars.customerName) {
    body = body.replace("[Customer Name]", vars.customerName).replace("[Company Name]", vars.customerName);
  }
  if (vars.senderName) body = body.replace("[Your Name]", vars.senderName);
  return body;
}
