/**
 * Rótulo do autor de uma mudança vinda do GSS (09/11/2026): o GSS manda quem
 * fez (`changed_by` na API de etapas) e a revisão guarda em `payload.gss_user`.
 * "Nome (GSS)", "email (GSS)" ou só "GSS" quando não veio ninguém.
 * Puro — usado no client (popup de revisões) e no server (History da etapa).
 */
export function gssActorLabel(payload: unknown): string {
  const who = gssUserName(payload);
  return who ? `${who} (GSS)` : "GSS";
}

/** Nome (ou e-mail) do usuário do GSS gravado na revisão; null se não veio. */
export function gssUserName(payload: unknown): string | null {
  const user =
    payload && typeof payload === "object"
      ? ((payload as { gss_user?: unknown }).gss_user as
          | { name?: string | null; email?: string | null }
          | undefined)
      : undefined;
  return user?.name?.trim() || user?.email?.trim() || null;
}
