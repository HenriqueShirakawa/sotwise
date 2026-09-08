import "server-only";

/**
 * HTML do e-mail manual disparado a partir de uma etapa do checklist. Mesma
 * casca visual do convite (`lib/email/invite.ts`) — cabeçalho roxo do design
 * system, corpo simples — mas sem CTA: aqui não há link de ação, só a
 * mensagem que o usuário interno escreveu.
 */
export function checklistStepEmailHtml(params: {
  subject: string; // já traz o contexto (ex: "PO - 1000 — Booking"), digitado/editado pelo usuário
  senderName: string;
  body: string; // texto simples digitado pelo usuário; quebras de linha viram <br>
}): string {
  const { subject, senderName, body } = params;
  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");
  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2f8;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
            <tr>
              <td style="background:#640BB7;padding:24px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">SOTWISE</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#640BB7;text-transform:uppercase;letter-spacing:0.4px;">
                  ${escapeHtml(subject)}
                </p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#1a1523;">
                  ${bodyHtml}
                </p>
                <p style="margin:0;font-size:13px;color:#8b8698;">
                  Enviado por ${escapeHtml(senderName)} via SOTWISE.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
