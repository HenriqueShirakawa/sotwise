"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionResult } from "@/domain/registration/schema";
import type { EmailLanguage } from "@/lib/email/checklist-step";

const PATH = "/registration/country-languages";

const inputSchema = z.object({
  countryId: z.uuid("Invalid country."),
  language: z.enum(["pt-BR", "en", "zh"]).nullable(),
});

/**
 * Fallback de idioma por país para o e-mail de checklist (Fase 2.1, RN02) —
 * antes só editável via SQL/Studio (ver migration
 * 20260909120000_checklist_email_language_status.sql). `language: null` limpa
 * o default do país; sem linha aqui, `resolveLanguage`
 * (lib/checklist-email-actions.ts) cai no default global 'en'.
 */
export async function setCountryLanguageDefault(
  countryId: string,
  language: EmailLanguage | null
): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = inputSchema.safeParse({ countryId, language });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();

  if (parsed.data.language === null) {
    const { error } = await admin
      .from("country_language_defaults")
      .delete()
      .eq("country_id", parsed.data.countryId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin
      .from("country_language_defaults")
      .upsert(
        { country_id: parsed.data.countryId, language: parsed.data.language } as never,
        { onConflict: "country_id" }
      );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}
