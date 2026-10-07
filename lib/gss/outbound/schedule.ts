import "server-only";

import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

import { dispatchGssOutbound, gssOutboundEnabled } from "./dispatch";
import { PL_SHIPMENT_STEPS, pushPlShipment } from "./pl-shipment";

/** As etapas do checklist do PL cujas datas vão ao GSS. */
export function isGssShipmentStep(step: ChecklistStep): boolean {
  return (PL_SHIPMENT_STEPS as readonly string[]).includes(step);
}

/**
 * Manda o estado atual do PL ao GSS (`/v1/shipments/`) logo DEPOIS da resposta
 * (`after` do Next 16): o usuário troca a data no checklist e o GSS recebe na
 * hora, sem o save esperar o GSS nem falhar por causa dele.
 *
 * Chamado por Create PL, pelos saves das etapas de data (Pre-loading e
 * Shipment) e pelo Confirm Shipping. Falha só vai pro log (`[gss]`); a fila
 * `gss_outbound` (migration 20261002120000), quando aplicada, é a rede de
 * retentativa.
 */
export function sendPlShipmentToGss(preLoadingId: string): void {
  // DESLIGADO em 07/10 a pedido do usuário (saves de data davam erro). Religa
  // com GSS_PL_PUSH_ENABLED=true na Vercel, sem mudar código.
  if (process.env.GSS_PL_PUSH_ENABLED !== "true") return;
  try {
    after(async () => {
      try {
        // Só PATCH por enquanto (02/10): PL que não existe no GSS não é criado.
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

/**
 * Drena a fila `gss_outbound` depois da resposta. Só age com a migration
 * 20261002120000 aplicada e `GSS_OUTBOUND_ENABLED=true`; sem isso é no-op.
 * Hoje só o Create PL usa (os saves de data mandam direto, acima).
 */
export async function scheduleGssOutboundDispatch(): Promise<void> {
  if (!gssOutboundEnabled()) return;
  try {
    after(async () => {
      try {
        const result = await dispatchGssOutbound(createAdminClient());
        if (result.errors.length) console.error("[gss-outbound]", result.errors.join(" | "));
      } catch (err) {
        console.error("[gss-outbound] disparo falhou:", err);
      }
    });
  } catch {
    // `after` fora do escopo suportado — a fila segura o evento.
  }
}
