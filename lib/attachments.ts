/**
 * Constantes e tipos do upload de anexo compartilhados entre servidor e client.
 * Sem imports: este módulo entra tanto no bundle do browser quanto nas actions.
 *
 * O arquivo NÃO passa pelo servidor. A Vercel corta o corpo de qualquer
 * Serverless Function em 4,5MB (`FUNCTION_PAYLOAD_TOO_LARGE`, 413), então uma
 * Server Action recebendo o `File` nunca subiria os 20MB prometidos — mesmo com
 * `bodySizeLimit` alto no next.config (que só vale local). O fluxo é em 3
 * passos: a action emite um ticket (URL assinada de upload), o browser sobe o
 * arquivo direto no Supabase Storage, e outra action registra a linha em
 * `step_attachments` (ver docs/regras_de_negocio.md, "Upload de anexo").
 */

export const DOCUMENTS_BUCKET = "order-documents";

/** Tem que bater com o `file_size_limit` do bucket (20 MiB = 20971520). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const FILE_TOO_LARGE = "File is larger than 20MB.";

export type UploadTicket =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

export type UploadResult = { ok: true } | { ok: false; error: string };

/** Nome seguro pra compor o caminho no bucket (o `file_name` original fica na tabela). */
export function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}
