"use client";

import { useActionState, useState } from "react";
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Mail,
  ArrowLeft,
  Loader2,
} from "lucide-react";

import {
  signIn,
  requestPasswordReset,
  type AuthActionState,
} from "@/lib/auth/actions";
import { SotwiseLogo } from "@/components/brand/sotwise-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function LoginForm({
  redirectTo,
  initialError,
}: {
  redirectTo?: string;
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(signIn, { error: initialError });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !pending;

  return (
    <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl shadow-slate-200/60 sm:p-10">
      <div className="flex flex-col items-center text-center">
        <SotwiseLogo />
        <h1 className="mt-6 text-2xl font-semibold text-slate-900">
          Log in to your account
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Access your export platform
        </p>
      </div>

      <form action={formAction} className="mt-8 grid gap-4">
        {redirectTo ? (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        ) : null}

        <div className="relative">
          <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="E-mail"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-lg pl-9"
          />
        </div>

        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-lg px-9"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setRecoverOpen(true)}
            className="text-sm font-medium text-primary hover:underline"
          >
            Forgot your password?
          </button>
        </div>

        {state?.error ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={!canSubmit}
          className="h-11 w-full rounded-lg text-base font-semibold"
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Log in
        </Button>
      </form>

      <PartnerLogos />

      <RecoverPasswordDialog open={recoverOpen} onOpenChange={setRecoverOpen} />
    </div>
  );
}

function RecoverPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(requestPasswordReset, {});
  const [email, setEmail] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <SotwiseLogo className="mb-2" />
          <DialogTitle className="text-xl">Recover password</DialogTitle>
          <DialogDescription>
            Enter your email to receive instructions.
          </DialogDescription>
        </DialogHeader>

        {state?.success ? (
          <p className="py-2 text-center text-sm text-slate-500" role="status">
            {state.success}
          </p>
        ) : (
          <form action={formAction} className="grid gap-4">
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-lg pl-9"
              />
            </div>

            {state?.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={!email.trim() || pending}
              className="h-11 w-full rounded-lg font-semibold"
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Send instructions
            </Button>
          </form>
        )}

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mx-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="size-4" />
          Back to login
        </button>
      </DialogContent>
    </Dialog>
  );
}

/** Logos dos parceiros (auto-hospedados em /public). */
function PartnerLogos() {
  return (
    <div className="mt-8 flex items-center justify-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-agk.png"
        alt="AGK Solution"
        className="h-7 w-auto object-contain"
      />
      <span className="h-6 w-px bg-slate-200" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-renchum.png"
        alt="Renchum"
        className="h-7 w-auto object-contain"
      />
    </div>
  );
}
