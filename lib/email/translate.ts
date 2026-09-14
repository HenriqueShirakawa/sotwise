import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { EmailLanguage } from "@/lib/email/checklist-step";

/**
 * Tradução do CORPO do e-mail de etapa na hora do disparo (decisão do usuário
 * em 11/09/2026): o compositor continua em inglês (template + edições à mão),
 * e quem é cliente recebe o texto no idioma do país dele — o mesmo idioma
 * que já governa o chrome do e-mail (`resolveLanguage` em
 * lib/checklist-email-actions.ts). Tradução estática por etapa foi descartada
 * antes (versão bilíngue de 09/09 saiu errada e o usuário pediu só inglês);
 * traduzir o texto FINAL cobre também o que o usuário editou.
 *
 * Mesma chave/cliente do Copilot (ANTHROPIC_API_KEY). Nunca bloqueia o envio:
 * sem chave, erro de rede ou resposta vazia → devolve o inglês + `error`, e
 * quem chama decide o que mostrar.
 */

const LANGUAGE_NAMES: Record<EmailLanguage, string> = {
  en: "English",
  "pt-BR": "Brazilian Portuguese",
  zh: "Simplified Chinese",
};

export const TRANSLATE_MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You translate business emails for an import-operations team (purchase orders, factories, shipments, payments). Translate the user's message into the requested language.

Rules:
- Keep proper names, company names, PO/PL numbers, dates, amounts, currencies, e-mail addresses, URLs and bracketed placeholders like [Customer Name] exactly as written.
- Keep industry terms the team uses in English when that is how they are commonly used in the target language (e.g. "Proforma Invoice", "PI", "PO", "Booking", "ETD", "BL").
- Preserve line breaks, blank lines and paragraph order exactly — the text is plain text from an e-mail body.
- If the message is already in the target language, return it unchanged.
- Output only the translated text. No preamble, no quotes, no notes.`;

export type TranslationResult = {
  /** Texto a enviar: traduzido, ou o original quando não deu pra traduzir. */
  text: string;
  translated: boolean;
  error: string | null;
};

/**
 * Cache em memória (processo): preview e envio acontecem em sequência com o
 * mesmo texto, então na maioria das vezes o "Confirm & send" reaproveita a
 * tradução que o usuário acabou de ver — e sai idêntica ao preview. Na Vercel
 * cada instância tem o seu; perder o cache só custa uma chamada a mais.
 */
const cache = new Map<string, string>();
const CACHE_MAX = 200;

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

export async function translateEmailBody(
  body: string,
  language: EmailLanguage
): Promise<TranslationResult> {
  const text = body.trim();
  if (language === "en" || text.length === 0) return { text: body, translated: false, error: null };

  const key = `${language}\n${text}`;
  const hit = cache.get(key);
  if (hit) return { text: hit, translated: true, error: null };

  const anthropic = getClient();
  if (!anthropic) {
    return { text: body, translated: false, error: "ANTHROPIC_API_KEY is not configured." };
  }

  try {
    const response = await anthropic.messages.create(
      {
        model: TRANSLATE_MODEL,
        max_tokens: 16_000,
        output_config: { effort: "low" },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Target language: ${LANGUAGE_NAMES[language]}\n\n<message>\n${text}\n</message>`,
          },
        ],
      },
      // Um envio de e-mail não pode ficar pendurado atrás da tradução.
      { timeout: 60_000, maxRetries: 1 }
    );
    if (response.stop_reason === "refusal") {
      return { text: body, translated: false, error: "Translation was refused by the model." };
    }
    const out = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!out) return { text: body, translated: false, error: "Empty translation." };

    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, out);
    return { text: out, translated: true, error: null };
  } catch (err) {
    const message =
      err instanceof Anthropic.APIError
        ? `Translation failed (${err.status ?? "network"}): ${err.message}`
        : err instanceof Error
          ? `Translation failed: ${err.message}`
          : "Translation failed.";
    return { text: body, translated: false, error: message };
  }
}

export function languageLabel(language: EmailLanguage): string {
  return LANGUAGE_NAMES[language];
}
