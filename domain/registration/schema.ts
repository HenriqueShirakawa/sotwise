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

/** Cadastros name-only ainda sem tela dedicada — usados pela API REST. */
export const categorySchema = z.object({ name: nameSchema });
export type CategoryInput = z.infer<typeof categorySchema>;

export const citySchema = z.object({ name: nameSchema });
export type CityInput = z.infer<typeof citySchema>;

/** `acronym` é NOT NULL na base (ver init_schema.sql). */
export const exporterSchema = z.object({
  name: nameSchema,
  acronym: z
    .string()
    .trim()
    .min(1, "Acronym is required.")
    .max(50, "Acronym is too long."),
});
export type ExporterInput = z.infer<typeof exporterSchema>;

/** `color`/`icon_path` viraram nullable na migração de reconcile → opcionais aqui.
 * O upload real do ícone (Storage) não passa por JSON — só o path, se vier. */
export const orderTypeSchema = z.object({
  name: nameSchema,
  color: z.string().trim().min(1).max(50).optional(),
  icon_path: z.string().trim().min(1).max(500).optional(),
});
export type OrderTypeInput = z.infer<typeof orderTypeSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };
