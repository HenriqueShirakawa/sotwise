export type PasswordStrength = "weak" | "good" | "strong";

/**
 * Medidor de força — INFORMATIVO, não bloqueia (§3.12.1). O único requisito
 * duro é mínimo de 8 caracteres, validado no submit.
 */
export function passwordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return "weak";
  if (score <= 3) return "good";
  return "strong";
}
