import "server-only";

import type { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  DOCUMENTS_BUCKET,
  FILE_TOO_LARGE,
  MAX_FILE_BYTES,
  safeFileName,
  type UploadTicket,
} from "@/lib/attachments";
import type { Database } from "@/types/database";

type AdminClient = ReturnType<typeof createSupabaseClient<Database>>;

/**
 * Emite a URL assinada de upload pra um arquivo dentro de `dir` (prefixo do
 * bucket, ex. `<orderId>/<stepId>`). A validação de tamanho aqui é a única que
 * roda no servidor — o Storage ainda barra pelo `file_size_limit` do bucket.
 * O token vale 2h e só serve pra esse `path` exato.
 */
export async function issueUploadTicket(
  admin: AdminClient,
  dir: string,
  fileName: string,
  fileSize: number
): Promise<UploadTicket> {
  if (!fileName || fileSize <= 0) return { ok: false, error: "No file selected." };
  if (fileSize > MAX_FILE_BYTES) return { ok: false, error: FILE_TOO_LARGE };

  const path = `${dir}/${Date.now()}-${safeFileName(fileName)}`;
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: error?.message ?? "Could not start the upload." };

  return { ok: true, path: data.path, token: data.token };
}

/**
 * Confere que o `path` que o browser mandou registrar foi mesmo emitido pra
 * esse `dir` — sem isto um client mal-intencionado registraria qualquer objeto
 * do bucket como anexo desta etapa.
 */
export function isPathInDir(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/");
}
