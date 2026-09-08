import "server-only";

import { formatDateNumeric } from "@/lib/format";

export type StepEmailFacts = {
  estimatedDate: string | null;
  completedOn: string | null;
  responsible: string | null;
  signedBy: string | null;
};

/**
 * HTML do e-mail manual disparado a partir de uma etapa do checklist. Mesma
 * casca visual do convite (`lib/email/invite.ts`) — cabeçalho roxo do design
 * system, corpo simples.
 *
 * `facts`/`actionUrl` só chegam preenchidos para destinatário INTERNO (não
 * `client`) — quem recebeu o e-mail decide o que é exibido, não o remetente:
 * um cliente nunca deve ver Responsible/Completed on/Signed by nem o botão
 * "Go to", mesmo que o usuário interno tenha esses dados na tela.
 */
export function checklistStepEmailHtml(params: {
  subject: string; // já traz o contexto (ex: "PO - 1000 — Booking"), digitado/editado pelo usuário
  senderName: string;
  body: string; // texto simples digitado pelo usuário; quebras de linha viram <br>
  facts?: StepEmailFacts | null;
  actionUrl?: string | null;
  /** URL absoluta pro `public/logo-sotwise.svg` (precisa de origin — e-mail
   *  não resolve caminho relativo). Sem isto, cai pro texto "SOTWISE" antigo. */
  logoUrl?: string | null;
}): string {
  const { subject, senderName, body, facts, actionUrl, logoUrl } = params;
  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");

  const factRows: { label: string; value: string }[] = [];
  if (facts?.estimatedDate) factRows.push({ label: "Estimated date", value: formatDateNumeric(facts.estimatedDate) });
  if (facts?.responsible) factRows.push({ label: "Responsible", value: facts.responsible });
  if (facts?.completedOn) factRows.push({ label: "Completed on", value: formatDateNumeric(facts.completedOn) });
  if (facts?.signedBy) factRows.push({ label: "Signed by", value: facts.signedBy });

  const factsHtml = factRows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-top:1px solid #eceaf1;border-bottom:1px solid #eceaf1;">
        ${factRows
          .map(
            (r) => `<tr>
              <td style="padding:8px 0;font-size:13px;color:#8b8698;">${escapeHtml(r.label)}</td>
              <td style="padding:8px 0;font-size:13px;color:#1a1523;text-align:right;">${escapeHtml(r.value)}</td>
            </tr>`
          )
          .join("")}
      </table>`
    : "";

  const buttonHtml = actionUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
        <tr>
          <td style="border-radius:8px;background:#640BB7;">
            <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:10px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
              Go to
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2f8;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
            <tr>
              <td style="background:#ffffff;padding:24px 32px;border-bottom:1px solid #eceaf1;">
                ${
                  logoUrl
                    ? `<img src="${escapeHtml(logoUrl)}" alt="SOTWISE" width="62" height="32" style="display:block;height:32px;width:auto;border:0;" />`
                    : `<span style="color:#640BB7;font-size:20px;font-weight:700;letter-spacing:0.5px;">SOTWISE</span>`
                }
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
                ${factsHtml}
                ${buttonHtml}
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
