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

/**
 * Category — nome + fábricas vinculadas (junção M-N `category_factories`).
 * A combinação Factory × Category é o nível atômico de controle do sistema
 * (§3.5.2): pedidos, lotes e checklists penduram nela.
 *
 * `factory_ids` é OPCIONAL aqui de propósito. Este schema também valida o
 * `POST /api/categories`, que hoje aceita `{ name }` puro — exigir o vínculo
 * quebraria o contrato de quem já chama a API (o middleware do GSS). A regra de
 * negócio "≥ 1 fábrica" mora no `categoryFormSchema` abaixo, que é o caminho
 * pelo qual um humano cria categoria.
 */
export const categorySchema = z.object({
  name: nameSchema,
  factory_ids: z.array(z.uuid()).optional(),
});
export type CategoryInput = z.infer<typeof categorySchema>;

/** O que a tela manda: aqui o vínculo é obrigatório (regra de UI do §3.5.2). */
export const categoryFormSchema = z.object({
  name: nameSchema,
  factory_ids: z.array(z.uuid()).min(1, "Link at least one factory."),
});
export type CategoryFormInput = z.infer<typeof categoryFormSchema>;

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

/* -------------------------------------------------------------------------- */
/* Schemas de ATUALIZAÇÃO (PATCH /api/{recurso}/{id})                          */
/*                                                                            */
/* Espelham os schemas de criação, mas com todo campo OPCIONAL: um PATCH toca */
/* só o que envia. A allowlist de campos é a mesma — nada de `gss_id`,        */
/* `created_by`, `id`. O par e-mail/`email_na` segue a mesma regra da criação */
/* (§3.5.3), só que validada apenas quando um dos dois é enviado.             */
/* -------------------------------------------------------------------------- */

/** Campos de e-mail opcionais para PATCH (nullable: `null` == "sem e-mail"). */
const emailUpdateFields = {
  email: z.email("Invalid e-mail address.").max(200).nullable().optional(),
  email_na: z.boolean().optional(),
};

/**
 * Refino do par e-mail num PATCH — só dispara quando `email` ou `email_na` vem
 * no corpo. Semântica: `email_na:true` marca "sem e-mail" (e não pode vir com um
 * e-mail junto); caso contrário, um e-mail preenchido é obrigatório. Omitir os
 * dois mantém o valor atual.
 */
const emailUpdateRefine = (
  data: { email?: string | null; email_na?: boolean },
  ctx: z.RefinementCtx
) => {
  if (data.email === undefined && data.email_na === undefined) return;
  if (data.email_na === true) {
    if (data.email) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: 'Marked "N/A" but an e-mail was provided.',
      });
    }
    return;
  }
  if (!data.email) {
    ctx.addIssue({ code: "custom", path: ["email"], message: emailOrNaMessage.message });
  }
};

/** Recursos name-only — o único campo editável é `name`, então é obrigatório. */
export const nameUpdateSchema = z.object({ name: nameSchema });
export type NameUpdateInput = z.infer<typeof nameUpdateSchema>;

export const clientUpdateSchema = z.object({
  name: nameSchema.optional(),
  country_id: z.uuid("Select a country.").optional(),
});
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export const exporterUpdateSchema = z.object({
  name: nameSchema.optional(),
  acronym: z
    .string()
    .trim()
    .min(1, "Acronym is required.")
    .max(50, "Acronym is too long.")
    .optional(),
});
export type ExporterUpdateInput = z.infer<typeof exporterUpdateSchema>;

export const orderTypeUpdateSchema = z.object({
  name: nameSchema.optional(),
  color: z.string().trim().min(1).max(50).optional(),
  icon_path: z.string().trim().min(1).max(500).optional(),
});
export type OrderTypeUpdateInput = z.infer<typeof orderTypeUpdateSchema>;

export const contactUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    ...emailUpdateFields,
    phone_number: phoneSchema.optional(),
  })
  .superRefine(emailUpdateRefine);
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

export const agentUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    country_id: z.uuid("Select a country.").optional(),
    location: z.enum(["brazil", "china"], { message: "Select a location." }).optional(),
    ...emailUpdateFields,
    phone_number: phoneSchema.optional(),
    contact_ids: z.array(z.uuid()).optional(),
  })
  .superRefine(emailUpdateRefine);
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;

export const categoryUpdateSchema = z.object({
  name: nameSchema.optional(),
  factory_ids: z.array(z.uuid()).optional(),
});
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };
