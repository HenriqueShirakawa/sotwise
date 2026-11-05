import type { MessageEntity } from "@/types/database";

/**
 * "PL 1473 texto" → { pre_loading, "1473", "texto" }. Regra do usuário
 * (04/11): SEMPRE exigir o número no início — sem ele, nada é gravado.
 *   "1676 ok"      → Order 1676
 *   "PL 1473 ok"   → Pre-loading 1473
 *   "SH 1473 ok"   → Shipment do PL 1473
 * Aceita "#", ":" ou "-" depois do número. Sem texto depois → null.
 */
export function parseReply(
  content: string
): { type: MessageEntity; number: string; body: string } | null {
  const m = content.match(/^\s*(?:(PL|SH)\s*)?#?(\d+)\s*[:,\-–]?\s+([\s\S]*\S)\s*$/i);
  if (!m) return null;
  const tag = m[1]?.toUpperCase();
  const type: MessageEntity = tag === "PL" ? "pre_loading" : tag === "SH" ? "shipment" : "order";
  return { type, number: m[2], body: m[3].trim() };
}
