import type { Metadata } from "next";
import { Ship } from "lucide-react";

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
    <div className="flex min-h-full flex-1">
      {/* Hero — lateral esquerda */}
      <div className="relative hidden w-1/2 shrink-0 overflow-hidden lg:block">
        <img
          src="/login-bg.svg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-900/20 to-transparent" />
        <div className="relative z-10 flex h-full flex-col justify-end p-12 text-white xl:p-16">
          <h1 className="text-5xl font-bold tracking-tight xl:text-6xl">
            Welcome to Sotwise
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-white/85">
            Your complete platform for export management and international
            logistics. Connect to the future of global trade.
          </p>
          <div className="mt-10 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Ship className="size-5" />
            </div>
            <div>
              <p className="font-semibold">Smart logistics</p>
              <p className="text-sm text-white/75">
                Optimize your export operations
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Card — lateral direita */}
      <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-white to-slate-50 p-6">
        <LoginForm
          redirectTo={redirect}
          initialError={error ? ERROR_MESSAGES[error] : undefined}
        />
      </div>
    </div>
  );
}
