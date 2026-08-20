import type { Metadata } from "next";

import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Set new password" };

export default function UpdatePasswordPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
