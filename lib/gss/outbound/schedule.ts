import "server-only";

import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

import { PL_SHIPMENT_STEPS, pushPlShipment } from "./pl-shipment";

/** As etapas do checklist do PL cujas datas vão ao GSS. */
export function isGssShipmentStep(step: ChecklistStep): boolean {
  return (PL_SHIPMENT_STEPS as readonly string[]).includes(step);
}

/**
 * Manda as datas do PL ao GSS (`PATCH /v1/shipments/{pl_number}/`) logo DEPOIS
 * da resposta (`after` do Next 16): o usuário troca a data no checklist e o GSS
 * recebe na hora, sem o save esperar o GSS nem falhar por causa dele.
 *
 * Só PATCH por enquanto (decisão do usuário, 02/10): PL que não existe no GSS
 * não é criado — sai no log como não enviado. Na produção, hoje, só o PL 1306
 * existe lá. Resultado só no log da Vercel (`[gss] ...`).
 *
 * Na `dev` há também a fila de retentativa (`gss_outbound`); aqui na `main` é
 * só o envio direto.
 */
export function sendPlShipmentToGss(preLoadingId: string): void {
  // DESLIGADO em 07/10 a pedido do usuário (saves de data davam erro). Religa
  // com GSS_PL_PUSH_ENABLED=true na Vercel, sem mudar código.
  if (process.env.GSS_PL_PUSH_ENABLED !== "true") return;
  try {
    after(async () => {
      try {
        const push = await pushPlShipment(createAdminClient(), preLoadingId, { create: false });
        if (push.outcome === "skipped") {
          console.warn(`[gss] PL ${preLoadingId} não enviado: ${push.reason}`);
        } else if (push.outcome === "called") {
          const { call, result } = push;
          const line = `[gss] ${call.method} ${call.path} → ${result.status} (${result.kind})`;
          if (result.kind === "ok") console.log(line);
          else console.error(`${line}: ${result.error ?? result.text}`);
        }
      } catch (err) {
        console.error(`[gss] envio do PL ${preLoadingId} falhou:`, err);
      }
    });
  } catch (err) {
    console.error("[gss] after() indisponível:", err);
  }
}
