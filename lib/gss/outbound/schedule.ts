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
 * Manda o estado atual do PL ao GSS (`PATCH /v1/shipments/{pl_number}/`) logo
 * DEPOIS da resposta (`after` do Next 16): o usuário troca a data no checklist e
 * o GSS recebe na hora, sem o save esperar o GSS nem falhar por causa dele.
 *
 * Chamado por Create PL / edição do PL (lotes incluídos ou retirados), pelos
 * saves das etapas de data (Pre-loading e Shipment — Delivered incluso), pelo
 * Confirm Shipping e pelo desfazer embarque. Vão as datas, o status da fase e os
 * lotes do PL (ver pl-shipment.ts). Resultado só no log da Vercel (`[gss] ...`).
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
        // Só PATCH: o SOT espelha no GSS o que já existe lá, NUNCA cria — toda
        // criação é no GSS (decisão do usuário, reafirmada em 13/10). PL que não
        // existe no GSS sai "skipped" no log.
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
