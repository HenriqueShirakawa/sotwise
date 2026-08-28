import "server-only";

/**
 * HTML do e-mail de redefinição de senha. Mesma casca do convite (inline
 * styles, paleta roxa do design system), promessa diferente: aqui o usuário
 * já tem conta e pediu o link.
 *
 * O CTA aponta para o NOSSO callback com `token_hash`, não para o link do
 * Supabase — ver lib/auth/actions.ts.
 */
export function resetPasswordEmailHtml(link: string, fullName?: string): string {
  const greeting = fullName ? `Olá, ${escapeHtml(fullName)}` : "Olá";
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
                <p style="margin:0 0 16px;font-size:16px;color:#1a1523;">${greeting},</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4458;">
                  Recebemos um pedido para redefinir a senha da sua conta no SOTWISE.
                  Clique no botão abaixo para escolher uma nova senha.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px;background:#640BB7;">
                      <a href="${link}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Redefinir minha senha
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#8b8698;">
                  Se o botão não funcionar, copie e cole este endereço no navegador:<br />
                  <a href="${link}" style="color:#640BB7;word-break:break-all;">${link}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #eceaf1;">
                <p style="margin:0;font-size:12px;color:#a8a4b3;">
                  Se você não pediu a redefinição, ignore este e-mail — sua senha
                  atual continua valendo.
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
