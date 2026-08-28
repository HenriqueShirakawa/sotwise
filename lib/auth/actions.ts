"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { resetPasswordEmailHtml } from "@/lib/email/reset-password";
import { CLIENT_HOME } from "@/lib/dal";

export type AuthActionState = { error?: string; success?: string };

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  redirectTo: z.string().optional(),
});

/** Login por e-mail + senha. Bloqueia usuários com status `blocked`. */
export async function signIn(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  // status `blocked` não pode logar (§3.1): encerra a sessão recém-criada.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("status, roles(name)")
    .eq("id", data.user.id)
    .single<{ status: string; roles: { name: string } | null }>();

  if (!profile || profile.status === "blocked") {
    await supabase.auth.signOut();
    return { error: "This account is blocked. Contact an administrator." };
  }

  // O externo entra no portal, não no app interno — e ignora o `redirectTo`,
  // que só aponta para rota interna (é o path que o proxy guardou ao barrar o
  // acesso). Sem isto ele cairia em /orders para ser rebatido pela DAL: chega
  // no lugar certo, mas piscando uma tela que não é dele.
  if (profile.roles?.name === "client") redirect(CLIENT_HOME);

  const target =
    parsed.data.redirectTo && parsed.data.redirectTo.startsWith("/")
      ? parsed.data.redirectTo
      : "/orders";
  redirect(target);
}

/** Sign out (botão do header). */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const resetSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

/**
 * Envia o e-mail de reset. Link expira em 24h (config do projeto).
 *
 * NÃO usa `resetPasswordForEmail`: aquele caminho entrega pelo SMTP do Supabase
 * (o "Custom SMTP" do painel é restrito a Owner/Admin da org) e monta o link a
 * partir do Site URL — que aqui aponta para `localhost:3000` e não temos acesso
 * para corrigir. Em produção isso dava e-mail que não chegava e, se chegasse,
 * link quebrado. Mesmo contorno do convite (users/actions.ts): `generateLink`
 * emite o token sem enviar nada, montamos a URL para o NOSSO /auth/callback com
 * `token_hash` e despachamos pelo Resend — sem depender de config no painel.
 *
 * Nota: por privacidade, não revelamos se o e-mail existe — retornamos sempre
 * sucesso neutro, e a falha do generateLink é engolida de propósito. (O MD pede
 * "erro para e-mail não cadastrado", o que vaza existência de conta; revisar
 * essa regra com o cliente — ver §3.12.1.)
 */
export async function requestPasswordReset(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = resetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid email." };
  }

  const origin = (await headers()).get("origin") ?? "";
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: parsed.data.email,
  });

  if (!error && data.properties) {
    // O convite grava full_name no metadata; sem ele o e-mail cai no "Olá".
    const metaName = data.user?.user_metadata?.full_name;
    const link =
      `${origin}/auth/callback` +
      `?token_hash=${encodeURIComponent(data.properties.hashed_token)}` +
      `&type=recovery&next=/update-password`;
    await sendEmail({
      to: parsed.data.email,
      subject: "Redefinir sua senha do SOTWISE",
      html: resetPasswordEmailHtml(link, typeof metaName === "string" ? metaName : undefined),
    });
  }

  return {
    success: "If that email is registered, a reset link has been sent.",
  };
}

const updatePasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

/** Define a nova senha (exige sessão de recovery vinda do link de reset). */
export async function updatePassword(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Reset link expired or invalid. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: error.message };
  }

  redirect("/orders");
}
