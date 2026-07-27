import type { Metadata } from "next";

import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Set new password · Sotwise" };

export default function UpdatePasswordPage() {
  return <UpdatePasswordForm />;
}
