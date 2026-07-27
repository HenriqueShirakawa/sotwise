import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Sotwise" };

const ERROR_MESSAGES: Record<string, string> = {
  blocked: "This account is blocked. Contact an administrator.",
  auth: "Authentication failed. Please sign in again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  const { error, redirect } = await searchParams;
  return (
    <LoginForm
      redirectTo={redirect}
      initialError={error ? ERROR_MESSAGES[error] : undefined}
    />
  );
}
