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

export type ActionResult = { ok: true } | { ok: false; error: string };
