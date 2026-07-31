import { z } from "zod";

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(200, "Name is too long.");

/** Criação em lote de cadastros name-only (Factories, Carriers, etc.). */
export const bulkNamesSchema = z.object({
  names: z.array(nameSchema).min(1, "Add at least one name."),
});

export const clientSchema = z.object({
  name: nameSchema,
  country_id: z.string().uuid("Select a country."),
});

export type ClientInput = z.infer<typeof clientSchema>;

/** Telefone: texto livre (formatos BR/CN convivem na base migrada do Bubble). */
const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required.")
  .max(50, "Phone number is too long.");

/** E-mail opcional com a marca explícita "N/A" da doc (§3.5.3 / §3.5.4):
 * ou tem e-mail válido, ou `email_na` está marcado. */
const emailFields = {
  email: z.email("Invalid e-mail address.").max(200).nullable(),
  email_na: z.boolean(),
};

const requireEmailOrNa = (data: { email: string | null; email_na: boolean }) =>
  data.email_na || !!data.email;
const emailOrNaMessage = {
  message: 'E-mail is required — or mark it as "N/A".',
  path: ["email"],
};

export const contactSchema = z
  .object({
    name: nameSchema,
    ...emailFields,
    phone_number: phoneSchema,
  })
  .refine(requireEmailOrNa, emailOrNaMessage);

export type ContactInput = z.infer<typeof contactSchema>;

export const agentSchema = z
  .object({
    name: nameSchema,
    country_id: z.uuid("Select a country."),
    /** Option set do "local" — base do filtro Agent Brazil/China no Pre-loading. */
    location: z.enum(["brazil", "china"], { message: "Select a location." }),
    ...emailFields,
    phone_number: phoneSchema,
    contact_ids: z.array(z.uuid()),
  })
  .refine(requireEmailOrNa, emailOrNaMessage);

export type AgentInput = z.infer<typeof agentSchema>;

/** A imagem em si não passa por aqui (chega como File no FormData) — ver actions. */
export const businessUnitSchema = z.object({
  name: nameSchema,
});

export type BusinessUnitInput = z.infer<typeof businessUnitSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };
