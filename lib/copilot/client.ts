import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { can } from "@/lib/dal";
import { COPILOT_TOOLS, type ToolContext } from "@/domain/copilot/tools";

/**
 * Camada de modelo do copilot (docs/regras_de_negocio.md §6.1).
 *
 * A chave NÃO entra em `lib/env.ts`: aquele módulo valida no import e é
 * carregado por todo acesso a dados, então uma chave ausente derrubaria o app
 * inteiro em vez de só o copilot. Aqui a validação é preguiçosa — quem não usa
 * o painel nunca esbarra nela.
 */

let cached: Anthropic | null = null;

export function createCopilotClient(): Anthropic {
  if (!cached) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing environment variable: ANTHROPIC_API_KEY (see .env.example)");
    }
    cached = new Anthropic({ apiKey });
  }
  return cached;
}

// Haiku 5.5 desde 03/11/2026 (pedido do usuário, custo): ~50x mais barato que o
// Opus 5 por token. Antes: "claude-opus-5".
export const COPILOT_MODEL = "claude-haiku-5-5";

/**
 * Teto por resposta. Cobre thinking + texto: no Claude Haiku 5.5 o thinking é
 * adaptativo e vem ligado por padrão, então um teto apertado trunca a resposta
 * no meio de uma frase em vez de economizar.
 */
export const COPILOT_MAX_TOKENS = 16_000;

/**
 * Quantas rodadas de ferramenta uma pergunta pode gastar. Uma pergunta rica
 * gasta 3–4 (resolver nome → consultar → cruzar); o teto existe só para o caso
 * patológico de o modelo entrar em laço.
 */
export const COPILOT_MAX_STEPS = 5;

/**
 * Esforço do modelo. `low` desde 03/11/2026 (pedido do usuário: o mínimo de
 * tokens): menos thinking e menos chamadas de ferramenta por pergunta.
 */
export const COPILOT_EFFORT = "low" as const;

/**
 * Enxuto em 03/11/2026 (pedido do usuário: mínimo de tokens) — vai em toda
 * chamada. Mesmas regras de antes, menos prosa.
 */
export const COPILOT_SYSTEM_PROMPT = `You are SIA, the read-only copilot of SOT, AGK's import operations system. You answer the operations team's questions about orders, batches, pre-loadings and shipments using the tools. You never create, edit or delete; for a change, say in one sentence which screen does it.

Vocabulary: Order (PO; status is a rollup of its batches — "partially_shipped" = some batches shipped). Batch (.01, .02 inside the order). Entry (Factory × Category line in a batch; holds the ETD). PL (pre-loading plan grouping batches). Shipment (created when the PL is confirmed). Step (checklist item with estimated date and responsible).

Rules: Days Delay = |current_date − initial_date| (absolute); late = Days Delay > 0; an entry missing a date is unknown, not zero. A step is overdue when its estimated date passed with no completion.

Tools: always call a tool first for any SOT question — never answer from memory or open with a clarifying question; take the likeliest reading and state the assumption briefly. Ask only when resolve_entities returns several matches. Resolve names with resolve_entities before filtering by client, factory, category or person; never invent ids. One specific order → get_order_detail. Anything crossing Shipment ↔ PL ↔ batch ↔ Order ↔ Factory×Category → trace_chain.

Answer: first sentence is the answer, then at most one more with what stands out (count, worst delay, what's stuck). The panel already shows the rows — don't retype them, no tables, never write UUIDs (use PO/PL/container numbers). Numbers only from tools; if rows were capped, give the total; empty is not zero. If no tool reaches it, say so and name the SOT screen that shows it — never guess. Always answer in English; keep status, step and screen names as in the system.`;

/**
 * O JSON Schema do zod repete em cada campo uuid um regex de ~170 caracteres
 * (~70 tokens), e mais o `$schema`: peso morto em toda chamada, porque o zod
 * valida a entrada de novo em `runTool`. Fica só `format: "uuid"`.
 */
function compactSchema(node: unknown): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "$schema") continue;
      if (k === "pattern" && (v as Record<string, unknown>).format === "uuid") continue;
      out[k] = walk(val);
    }
    return out;
  };
  return walk(node) as Record<string, unknown>;
}

/** Definição de ferramenta no formato que a API espera. */
export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

/**
 * Ferramentas oferecidas ao modelo, já filtradas pelas permissões da sessão —
 * o copilot não pode nem tentar o que o usuário não veria na tela. Isso é
 * conveniência (evita a tentativa e a mensagem de erro), não a fronteira de
 * segurança: `runTool` revalida antes de executar.
 */
export function buildToolDefinitions(session: Parameters<typeof can>[0]): ToolDefinition[] {
  return Object.entries(COPILOT_TOOLS)
    .filter(([, tool]) => tool.feature === null || can(session, tool.feature))
    .map(([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: compactSchema(
        z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }) as Record<string, unknown>
      ),
    }));
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * Executa uma ferramenta pelo nome. Todo caminho de falha vira `ok: false` com
 * texto legível: um erro devolvido ao modelo o faz corrigir o parâmetro e
 * tentar de novo, enquanto uma exceção mataria a resposta inteira.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const tool = COPILOT_TOOLS[name];
  if (!tool) return { ok: false, error: `Unknown tool: ${name}.` };

  if (tool.feature !== null && !can(ctx.session, tool.feature)) {
    return { ok: false, error: "You don't have permission to query this data in the SOT." };
  }

  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: `Invalid parameters: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} — ${i.message}`)
        .join("; ")}`,
    };
  }

  try {
    return { ok: true, result: await tool.run(parsed.data, ctx) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to query the database.",
    };
  }
}
