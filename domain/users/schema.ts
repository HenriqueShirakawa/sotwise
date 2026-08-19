import { z } from "zod";

/** Option set Company (§3.1) — mesmos valores do enum `company_type`. */
export const COMPANY_VALUES = ["BR", "China"] as const;

const fullNameSchema = z
  .string()
  .trim()
  .min(1, "Full name is required.")
  .max(200, "Full name is too long.");

/** Date of birth é opcional; o input manda "" quando vazio. */
const dateOfBirthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.")
  .nullable();

/**
 * Cliente dono do usuário externo. Nullable aqui de propósito: o formulário só
 * mostra o campo quando o papel escolhido é `client`, e este schema não conhece
 * o NOME do papel (recebe só o `role_id`). A regra "papel client exige cliente,
 * papel interno exige null" é resolvida no servidor, em `assertClientScope`,
 * que consulta `roles` — não dá para confiar no que o browser mandou.
 */
const clientIdSchema = z.uuid("Select a client.").nullable();

const baseUserFields = {
  full_name: fullNameSchema,
  date_of_birth: dateOfBirthSchema,
  role_id: z.uuid("Select a profile."),
  company: z.enum(COMPANY_VALUES, { message: "Select a company." }),
  client_id: clientIdSchema,
};

/** Criação (tela Users, §3.1): o admin informa tudo, inclusive o e-mail. */
export const userCreateSchema = z.object({
  ...baseUserFields,
  email: z.email("Invalid e-mail address."),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;

/** Edição: e-mail NÃO é editável (vive em auth.users). `hidden` só some das listagens. */
export const userUpdateSchema = z.object({
  ...baseUserFields,
  hidden: z.boolean(),
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

/**
 * "My profile" (§3.1): o próprio usuário edita só o que é dele. Role, company e
 * e-mail ficam de fora de propósito — quem muda papel/empresa é o admin pela
 * tela Users, senão qualquer um se promoveria a admin por aqui.
 */
export const profileSelfUpdateSchema = z.object({
  full_name: fullNameSchema,
  date_of_birth: dateOfBirthSchema,
});

export type ProfileSelfUpdateInput = z.infer<typeof profileSelfUpdateSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };
