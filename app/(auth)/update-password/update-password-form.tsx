"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { updatePassword, type AuthActionState } from "@/lib/auth/actions";
import { passwordStrength } from "@/lib/password";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STRENGTH_STYLES = {
  weak: { label: "Weak", bars: 1, color: "bg-destructive" },
  good: { label: "Good", bars: 2, color: "bg-amber-500" },
  strong: { label: "Strong", bars: 3, color: "bg-emerald-500" },
} as const;

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(updatePassword, {});
  const [password, setPassword] = useState("");

  const strength = password ? STRENGTH_STYLES[passwordStrength(password)] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>Minimum 8 characters.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {strength ? (
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full",
                        i < strength.bars ? strength.color : "bg-muted"
                      )}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {strength.label}
                </span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          {state?.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? <Loader2 className="animate-spin" /> : null}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
