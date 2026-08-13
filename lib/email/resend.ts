import "server-only";

/**
 * Envio de e-mail transacional pela API REST do Resend (sem SDK/dependência).
 *
 * Contorna o SMTP do Supabase: em vez de deixar o Auth entregar o e-mail (o que
 * exige o "Custom SMTP" ligado no painel, restrito a Owner/Admin da org), o app
 * gera o link com a Admin API e envia o e-mail por aqui. Ver actions do módulo
 * de usuários e docs/regras_de_negocio.md §3.1.
 *
 * Env (server-only, nunca com prefixo NEXT_PUBLIC_):
 *  - RESEND_API_KEY  chave `re_...` do Resend (Sending access basta).
 *  - EMAIL_FROM      remetente; default usa o domínio de teste do Resend, que
 *                    só entrega para o e-mail dono da conta. Em produção,
 *                    aponte para um remetente de domínio verificado.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "SOTWISE <onboarding@resend.dev>";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
};

type SendEmailResult = { ok: true } | { ok: false; error: string };

export async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY não configurada (ver .env.example)." };
  }
  const from = process.env.EMAIL_FROM || DEFAULT_FROM;

  let res: Response;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
  } catch (cause) {
    return { ok: false, error: `Falha de rede ao contatar o Resend: ${String(cause)}` };
  }

  if (!res.ok) {
    // O Resend devolve { message } em JSON; caímos para texto cru se não for JSON.
    const detail = await res
      .json()
      .then((body: { message?: string }) => body?.message)
      .catch(() => null);
    return { ok: false, error: `Resend ${res.status}: ${detail ?? "erro desconhecido"}` };
  }

  return { ok: true };
}
