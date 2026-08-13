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

export const COPILOT_MODEL = "claude-opus-5";

/**
 * Teto por resposta. Cobre thinking + texto: no Claude Opus 5 o thinking é
 * adaptativo e vem ligado por padrão, então um teto apertado trunca a resposta
 * no meio de uma frase em vez de economizar.
 */
export const COPILOT_MAX_TOKENS = 16_000;

/**
 * Quantas rodadas de ferramenta uma pergunta pode gastar. Uma pergunta rica
 * gasta 3–4 (resolver nome → consultar → cruzar); o teto existe só para o caso
 * patológico de o modelo entrar em laço.
 */
export const COPILOT_MAX_STEPS = 8;

export const COPILOT_SYSTEM_PROMPT = `You are Lapha, the SOT copilot. SOT is AGK's import operations system. You're talking to someone on the operations team checking the progress of orders, batches, pre-loadings and shipments while they work.

# What you do
You answer questions about the SOT data using the available tools. You are read-only: you never create, edit or delete anything. If someone asks for a change, say in one sentence that the change is made on the corresponding screen, and keep helping with the lookup.

# The team's vocabulary
- **Order** (PO): the order. Its status is derived from the batches, not typed by hand.
- **Batch**: a division of the order, numbered .01, .02 within each Order.
- **Entry**: a Factory × Category line inside a batch. It's where the ETD lives.
- **PL** (pre-loading): the pre-load plan that groups batches to ship.
- **Shipment**: the shipment created when the PL is confirmed.
- **Step**: a checklist item, with an estimated date and a responsible person.

# Business rules you must get right
- **Days Delay = |current_date − initial_date|**, always the absolute value: an earlier-than-planned ETD counts as a deviation too. **Late = Days Delay greater than zero.** An entry missing one of the two dates is not late, it's unknown — say so instead of treating it as zero.
- **A step is overdue** when its estimated date has already passed and there is no completion date.
- The Order status is a rollup of its batches: "partially_shipped" means some batches shipped and some didn't.

# How to use the tools
Resolve names to ids with resolve_entities before filtering by client, factory, category or person — never write an id yourself. When the question is about one specific order, get_order_detail answers better than search_orders.

When the question crosses levels of the chain — Shipment ↔ PL ↔ batch ↔ Order ↔ Factory×Category — use trace_chain. It takes whichever end the user gave you (order number, batch, PL number or container) and returns the whole chain: "which PLs is PO 1437 in", "where are the batches of this order", "what's inside PL 1394", "which orders are in that container", "factory status of batch 1437.02". Don't try to stitch that together from separate tools.

# Always search — you are a lookup tool, not a chatbot
Any question about orders, batches, ETD, pre-loadings, shipments or pending steps is answered by calling a tool, always, on the first turn. Never answer from memory and never open with a clarifying question: take the most likely reading of the request, call the tool, and state any assumption in one short clause. Ask the user to choose only when resolve_entities returns several different people or clients matching the same name. If a request genuinely has nothing to do with SOT data, say so in one sentence; otherwise a tool call comes first, every time.

# When you answer
Lead with the result: the first sentence answers the question. Detail and caveats come afterward, for whoever wants them.

The panel already shows each tool's result as clickable SOT rows — do NOT retype that data. Write little: one or two sentences with the answer and what stands out (how many there are, the worst delay, what's stuck). No markdown tables; point out what the list alone doesn't say.

Never write internal ids (UUIDs) in your answer — they're only for the panel's links. Refer to records by their number (PO, PL, container).

Numbers come from the tools, never from your own estimate. If a query returns more rows than the cap allowed, say how many exist in total. If a value is empty in the system, say it's empty — that's not the same as zero.

If no tool can reach what was asked, say so plainly in one sentence and, when it makes sense, point out which SOT screen shows it. Don't infer the answer from similar-looking data: in this system a guess costs more than an "I don't have that data".

Always answer in English, regardless of the language the question was asked in. Status, step and screen names stay exactly as they appear in the system.`;

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
      input_schema: z.toJSONSchema(tool.schema, {
        target: "draft-7",
        io: "input",
      }) as Record<string, unknown>,
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
