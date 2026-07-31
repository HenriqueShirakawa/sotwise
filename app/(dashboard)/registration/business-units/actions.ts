"use server";

import { revalidatePath } from "next/cache";

import { verifySession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessUnitSchema, type ActionResult } from "@/domain/registration/schema";
import { isExternalIcon } from "@/domain/registration/business-unit-icon";

const PATH = "/registration/business-units";
const BUCKET = "business-units";
/** Limites da doc §3.5.9: .png/.jpeg/.svg, até 5MB, 1 imagem. */
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const MAX_ICON_BYTES = 5 * 1024 * 1024;

type Upload = { path: string } | { error: string } | null;

/** Sobe o ícone e devolve o path; `null` = nenhum arquivo enviado. */
async function uploadIcon(
  admin: ReturnType<typeof createAdminClient>,
  formData: FormData
): Promise<Upload> {
  const file = formData.get("icon");
  if (!(file instanceof File) || file.size === 0) return null;

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { error: "Image must be a PNG, JPEG or SVG file." };
  }
  if (file.size > MAX_ICON_BYTES) {
    return { error: "Image is larger than 5MB." };
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${Date.now()}-${safeName}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (error) return { error: error.message };

  return { path };
}

export async function createBusinessUnit(formData: FormData): Promise<ActionResult> {
  const session = await verifySession();

  const parsed = businessUnitSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const upload = await uploadIcon(admin, formData);
  if (upload && "error" in upload) return { ok: false, error: upload.error };
  if (!upload) return { ok: false, error: "An image is required." };

  const { error } = await admin
    .from("business_units")
    .insert({ name: parsed.data.name, icon_path: upload.path, created_by: session.userId });
  if (error) {
    await admin.storage.from(BUCKET).remove([upload.path]);
    return { ok: false, error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateBusinessUnit(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await verifySession();

  const parsed = businessUnitSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const upload = await uploadIcon(admin, formData);
  if (upload && "error" in upload) return { ok: false, error: upload.error };

  const { data: current } = await admin
    .from("business_units")
    .select("icon_path")
    .eq("id", id)
    .single();

  const { error } = await admin
    .from("business_units")
    .update({
      name: parsed.data.name,
      ...(upload ? { icon_path: upload.path } : {}),
    })
    .eq("id", id);
  if (error) {
    if (upload) await admin.storage.from(BUCKET).remove([upload.path]);
    return { ok: false, error: error.message };
  }

  // Troca de imagem: o arquivo antigo no bucket não serve mais a ninguém
  // (ícone legado do Bubble não mora aqui — não há o que apagar).
  if (upload && current?.icon_path && !isExternalIcon(current.icon_path)) {
    await admin.storage.from(BUCKET).remove([current.icon_path]);
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Soft delete — o arquivo fica no bucket, junto com o registro escondido. */
export async function deleteBusinessUnit(id: string): Promise<ActionResult> {
  await verifySession();

  const admin = createAdminClient();
  const { error } = await admin
    .from("business_units")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
