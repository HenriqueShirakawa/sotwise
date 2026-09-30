import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Gatilho do lote `in_negotiation -> in_production` (docs §3.7.2): a etapa
 * "Deposit Payment" da Order concluída OU desligada no toggle. Antes o app só
 * mudava pelo seletor manual do lote — o gatilho existia na doc, não no código
 * (QA E2E 30/09/2026). O seletor manual continua valendo.
 *
 * Decisão do usuário (30/09): vale no momento em que o Deposit fica resolvido
 * E para lote novo depois disso — lote criado com Factory x Category, ou lote
 * criado vazio que recebe a primeira entrada, já vai para In Production.
 * Desfazer o Deposit não rebaixa lote nenhum.
 *
 * Lote sem nenhuma entrada fica em In Negotiation: a regra de 17/09 não deixa
 * lote vazio em produção (`updateBatchStatus`).
 */
async function isDepositSettled(admin: Admin, orderId: string): Promise<boolean> {
  const { data } = await admin
    .from("order_checklist_steps")
    .select("enabled, completed_on")
    .eq("order_id", orderId)
    .eq("step", "deposit_payment")
    .maybeSingle();
  if (!data) return false;
  return !data.enabled || !!data.completed_on;
}

/**
 * Com o Deposit resolvido, move para In Production os lotes In Negotiation da
 * Order que têm ao menos uma Factory x Category — todos, ou só `batchIds`.
 * Quem chama refaz o rollup da Order depois (`syncOrderStatus`), que também
 * empurra o aviso ao cliente. Devolve a mensagem de erro, ou null.
 */
export async function promoteBatchesIfDepositSettled(
  admin: Admin,
  orderId: string,
  batchIds?: string[]
): Promise<string | null> {
  if (batchIds && batchIds.length === 0) return null;
  if (!(await isDepositSettled(admin, orderId))) return null;

  let query = admin
    .from("batches")
    .select("id")
    .eq("order_id", orderId)
    .eq("status", "in_negotiation");
  if (batchIds) query = query.in("id", batchIds);
  const { data: candidates, error } = await query;
  if (error) return error.message;
  if (!candidates?.length) return null;

  const { data: withEntries, error: entriesError } = await admin
    .from("order_factory_category")
    .select("batch_id")
    .in(
      "batch_id",
      candidates.map((b) => b.id)
    );
  if (entriesError) return entriesError.message;

  const ids = [...new Set((withEntries ?? []).map((e) => e.batch_id as string))];
  if (ids.length === 0) return null;

  const { error: updateError } = await admin
    .from("batches")
    .update({ status: "in_production" })
    .in("id", ids);
  return updateError?.message ?? null;
}
