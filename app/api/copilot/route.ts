import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { resolveSession } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COPILOT_MAX_STEPS,
  COPILOT_MAX_TOKENS,
  COPILOT_MODEL,
  COPILOT_SYSTEM_PROMPT,
  buildToolDefinitions,
  createCopilotClient,
  runTool,
} from "@/lib/copilot/client";

/**
 * Copilot — conversa com streaming (docs/regras_de_negocio.md §6.1).
 *
 * Route Handler em vez de Server Action porque a resposta é um stream longo: o
 * usuário lê enquanto o modelo escreve, e as Actions devolvem de uma vez.
 *
 * Autorização: `resolveSession()` aqui e `can()` de novo dentro de `runTool` —
 * a lista de ferramentas enviada ao modelo é conveniência, não fronteira.
 */

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(40),
});

/** Evento SSE que o painel consome. */
type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  // O resultado estruturado da ferramenta: o painel o renderiza como linhas
  // clicáveis do SOT, não como texto. É por isso que o copilot não é um chat —
  // o dado volta como dado, não como tabela markdown que o modelo digitou.
  | { type: "result"; tool: string; result: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export async function POST(request: Request) {
  const result = await resolveSession();
  if (result.kind !== "ok") {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  const session = result.session;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  let client: Anthropic;
  try {
    client = createCopilotClient();
  } catch {
    // Chave ausente é erro de configuração do ambiente, não do usuário.
    return Response.json(
      { error: "Lapha is not configured in this environment (ANTHROPIC_API_KEY is missing)." },
      { status: 503 }
    );
  }

  const tools = buildToolDefinitions(session) as unknown as Anthropic.Tool[];
  const ctx = {
    admin: createAdminClient(),
    session,
    // "Hoje" fixado no início: duas ferramentas na mesma resposta não podem
    // discordar sobre a data de referência.
    todayMs: Date.now(),
  };

  const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for (let step = 0; step < COPILOT_MAX_STEPS; step++) {
          const modelStream = client.messages.stream({
            model: COPILOT_MODEL,
            max_tokens: COPILOT_MAX_TOKENS,
            system: COPILOT_SYSTEM_PROMPT,
            tools,
            output_config: { effort: "medium" },
            messages,
          });

          for await (const event of modelStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ type: "text", text: event.delta.text });
            }
          }

          const message = await modelStream.finalMessage();
          messages.push({ role: "assistant", content: message.content });

          if (message.stop_reason !== "tool_use") {
            if (message.stop_reason === "max_tokens") {
              send({ type: "error", message: "The response was too long and got truncated." });
            }
            break;
          }

          const calls = message.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
          );

          // Todas as ferramentas são de leitura e independentes entre si, então
          // rodam juntas; os resultados voltam num único turno de usuário, como
          // a API espera.
          const results = await Promise.all(
            calls.map(async (call) => {
              send({ type: "tool", name: call.name });
              const outcome = await runTool(call.name, call.input, ctx);
              // O painel renderiza o resultado como linhas do SOT; o modelo
              // recebe o mesmo dado para escrever a resposta. Só o sucesso vira
              // linha — o erro o modelo trata e tenta de novo.
              if (outcome.ok) {
                send({ type: "result", tool: call.name, result: outcome.result });
              }
              return {
                type: "tool_result" as const,
                tool_use_id: call.id,
                content: outcome.ok ? JSON.stringify(outcome.result) : outcome.error,
                is_error: !outcome.ok,
              };
            })
          );

          messages.push({ role: "user", content: results });
        }

        send({ type: "done" });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to reach Lapha.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
