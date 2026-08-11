"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
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
 * Cria o usuário no Auth e o profile 1:1 (§3.1). **Sem senha e sem e-mail**:
 * o convite depende do Site URL do Supabase, que ainda aponta para localhost
 * (pendência do owner do projeto). `email_confirm: true` evita disparar o
 * e-mail de confirmação quebrado; o usuário só consegue entrar quando o fluxo
 * de convite/reset for liberado. Não existe exclusão de usuário — só status.
 */
export async function createUserRecord(input: UserCreateInput): Promise<ActionResult> {
  await requireFeature("users", "create");

  const parsed = userCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });
  if (error || !data.user) {
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
