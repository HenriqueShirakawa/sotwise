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
const RESEND_RECEIVING_ENDPOINT = "https://api.resend.com/emails/receiving";
const DEFAULT_FROM = "SOTWISE <onboarding@resend.dev>";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  /** Endereço pra onde as respostas do destinatário voltam — usado pela
   *  resposta do cliente ao e-mail de etapa do checklist (ver
   *  lib/checklist-email-actions.ts + app/api/webhooks/resend/route.ts). */
  replyTo?: string;
};

type SendEmailResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail({ to, subject, html, replyTo }: SendEmailArgs): Promise<SendEmailResult> {
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
      body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
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

  const body: { id?: string } = await res.json().catch(() => ({}));
  return { ok: true, id: body.id ?? "" };
}

type ReceivedEmail = { html: string | null; text: string | null; headers: Record<string, string> };
type FetchReceivedEmailResult = { ok: true; email: ReceivedEmail } | { ok: false; error: string };

/**
 * Busca o conteúdo completo (corpo + headers) de um e-mail recebido no
 * domínio de recebimento do Resend. O webhook `email.received` só traz
 * metadados (from/to/subject/message_id) — o corpo exige esta segunda
 * chamada, pelo `email_id` do payload do webhook.
 */
export async function fetchReceivedEmail(emailId: string): Promise<FetchReceivedEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY não configurada (ver .env.example)." };
  }

  let res: Response;
  try {
    res = await fetch(`${RESEND_RECEIVING_ENDPOINT}/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (cause) {
    return { ok: false, error: `Falha de rede ao contatar o Resend: ${String(cause)}` };
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((body: { message?: string }) => body?.message)
      .catch(() => null);
    return { ok: false, error: `Resend ${res.status}: ${detail ?? "erro desconhecido"}` };
  }

  const data: { html?: string | null; text?: string | null; headers?: Record<string, string> } = await res
    .json()
    .catch(() => ({}));
  return {
    ok: true,
    email: { html: data.html ?? null, text: data.text ?? null, headers: data.headers ?? {} },
  };
}
