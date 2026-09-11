import {
  DOCUMENTS_BUCKET,
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  type UploadResult,
  type UploadTicket,
} from "@/lib/attachments";
import { createClient } from "@/lib/supabase/client";

/**
 * Fluxo de upload direto browser → Supabase Storage (ver lib/attachments.ts).
 * `issue` e `register` são as Server Actions do módulo (Order/Pre-loading/
 * Shipment); só metadados passam por elas, nunca o arquivo.
 */
export async function uploadDirect(
  file: File,
  issue: (fileName: string, fileSize: number) => Promise<UploadTicket>,
  register: (path: string) => Promise<UploadResult>
): Promise<UploadResult> {
  if (file.size === 0) return { ok: false, error: "No file selected." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: FILE_TOO_LARGE };

  const ticket = await issue(file.name, file.size);
  if (!ticket.ok) return ticket;

  // A URL assinada dispensa RLS: o token autoriza exatamente esse path.
  const { error } = await createClient()
    .storage.from(DOCUMENTS_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, file, {
      contentType: file.type || undefined,
    });
  if (error) return { ok: false, error: error.message };

  return register(ticket.path);
}
