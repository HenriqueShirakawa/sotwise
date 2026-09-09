import "server-only";

import { formatDateNumeric } from "@/lib/format";

export type StepEmailFacts = {
  estimatedDate: string | null;
  completedOn: string | null;
  responsible: string | null;
  signedBy: string | null;
};

export type EmailLanguage = "pt-BR" | "en" | "zh";

/**
 * Só o CHROME fixo do e-mail troca de idioma (rótulos, botão, rodapé) —
 * `subject`/`body` são texto livre digitado pelo usuário, sem tradução
 * automática (não tem como traduzir texto livre com segurança). Fase 2.1 —
 * User Story 1: idioma vem de `clients.language`/`country_language_defaults`,
 * resolvido em `lib/checklist-email-actions.ts`.
 */
const DICT: Record<
  EmailLanguage,
  {
    htmlLang: string;
    estimatedDate: string;
    responsible: string;
    completedOn: string;
    signedBy: string;
    goTo: string;
    sentVia: (name: string) => string;
    replyHint: string;
  }
> = {
  "pt-BR": {
    htmlLang: "pt-BR",
    estimatedDate: "Data estimada",
    responsible: "Responsável",
    completedOn: "Concluído em",
    signedBy: "Assinado por",
    goTo: "Acessar",
    sentVia: (name) => `Enviado por ${name} via SOTWISE.`,
    replyHint: "Responda este e-mail para enviar uma mensagem ao time.",
  },
  en: {
    htmlLang: "en",
    estimatedDate: "Estimated date",
    responsible: "Responsible",
    completedOn: "Completed on",
    signedBy: "Signed by",
    goTo: "Go to",
    sentVia: (name) => `Sent by ${name} via SOTWISE.`,
    replyHint: "Reply to this email to send a message to the team.",
  },
  zh: {
    htmlLang: "zh",
    estimatedDate: "预计日期",
    responsible: "负责人",
    completedOn: "完成日期",
    signedBy: "签署人",
    goTo: "前往",
    sentVia: (name) => `由 ${name} 通过 SOTWISE 发送。`,
    replyHint: "回复此邮件即可给团队发送消息。",
  },
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
  /** Idioma do cliente do pedido/PL, resolvido antes de chamar isto. Default
   *  'en' — nunca deve faltar, mas o fallback evita template quebrado. */
  language?: EmailLanguage;
}): string {
  const { subject, senderName, body, facts, actionUrl, logoUrl, language = "en" } = params;
  const t = DICT[language];
  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");

  const factRows: { label: string; value: string }[] = [];
  if (facts?.estimatedDate) factRows.push({ label: t.estimatedDate, value: formatDateNumeric(facts.estimatedDate) });
  if (facts?.responsible) factRows.push({ label: t.responsible, value: facts.responsible });
  if (facts?.completedOn) factRows.push({ label: t.completedOn, value: formatDateNumeric(facts.completedOn) });
  if (facts?.signedBy) factRows.push({ label: t.signedBy, value: facts.signedBy });

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
              ${t.goTo}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
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
                <p style="margin:0 0 4px;font-size:13px;color:#8b8698;">
                  ${escapeHtml(t.sentVia(senderName))}
                </p>
                <p style="margin:0;font-size:13px;color:#8b8698;">
                  ${escapeHtml(t.replyHint)}
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
