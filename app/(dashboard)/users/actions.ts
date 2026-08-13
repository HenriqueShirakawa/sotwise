"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { requireFeature } from "@/lib/dal";
import { inviteEmailHtml } from "@/lib/email/invite";
import { sendEmail } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  userCreateSchema,
  userUpdateSchema,
  type ActionResult,
  type UserCreateInput,
  type UserUpdateInput,
} from "@/domain/users/schema";

const PATH = "/users";

/**
 * Cria o usuário no Auth e o profile 1:1 (§3.1). O usuário nasce sem senha e a
 * define por um link de convite, que cai em /auth/callback → /update-password.
 * Não existe exclusão — só status.
 *
 * O e-mail NÃO passa pelo SMTP do Supabase (o "Custom SMTP" do painel é restrito
 * a Owner/Admin da org). Em vez disso: `generateLink` emite o link sem enviar
 * nada, e o app despacha o e-mail pela API do Resend (lib/email). O link aponta
 * para {origin}/auth/callback?token_hash=...&type=invite — token_hash chega ao
 * servidor (o fragmento `#access_token` do fluxo padrão nunca chegaria).
 *
 * Ainda depende de config no painel do Supabase (Auth → URL Configuration): o
 * domínio de produção precisa estar em Site URL / Redirect URLs. Ver §3.1.
 */
export async function createUserRecord(input: UserCreateInput): Promise<ActionResult> {
  await requireFeature("users", "create");

  const parsed = userCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const origin = (await headers()).get("origin") ?? "";
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: parsed.data.email,
    options: { data: { full_name: parsed.data.full_name } },
  });
  if (error || !data.user || !data.properties) {
    return { ok: false, error: error?.message ?? "Could not create the user." };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: parsed.data.full_name,
    date_of_birth: parsed.data.date_of_birth,
    role_id: parsed.data.role_id,
    company: parsed.data.company,
    status: "active",
  });
  if (profileError) {
    // Sem profile o usuário do Auth fica órfão (a DAL o expulsaria) — desfaz.
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: profileError.message };
  }

  // Monta o link para o nosso callback (verifyOtp por token_hash) e envia o
  // convite pelo Resend. Se o envio falhar, o usuário não consegue definir a
  // senha — desfaz tudo para o admin poder reenviar sem sujeira.
  const link =
    `${origin}/auth/callback` +
    `?token_hash=${encodeURIComponent(data.properties.hashed_token)}` +
    `&type=invite&next=/update-password`;
  const sent = await sendEmail({
    to: parsed.data.email,
    subject: "Seu convite para o SOTWISE",
    html: inviteEmailHtml(link, parsed.data.full_name),
  });
  if (!sent.ok) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, error: `Não foi possível enviar o convite: ${sent.error}` };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Edita o profile. E-mail fica de fora: é do `auth.users` e não é editável (§3.1). */
export async function updateUserRecord(
  id: string,
  input: UserUpdateInput
): Promise<ActionResult> {
  await requireFeature("users", "edit");

  const parsed = userUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      date_of_birth: parsed.data.date_of_birth,
      role_id: parsed.data.role_id,
      company: parsed.data.company,
      hidden: parsed.data.hidden,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Bloqueia/desbloqueia. O efeito é imediato: a DAL checa `status` a cada
 * request e manda o bloqueado para /auth/signout (§3.1).
 */
export async function setUserStatus(
  id: string,
  status: "active" | "blocked"
): Promise<ActionResult> {
  const session = await requireFeature("users", "edit");

  if (id === session.userId && status === "blocked") {
    return { ok: false, error: "You cannot block your own account." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
