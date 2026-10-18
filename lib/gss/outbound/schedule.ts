import "server-only";

import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep } from "@/types/database";

import { pushEtdFactory } from "./etd-factory";
import { PL_SHIPMENT_STEPS, pushPlShipment } from "./pl-shipment";
import type { GssWriteResult } from "../client";

/** As etapas do checklist do PL cujas datas vão ao GSS. */
export function isGssShipmentStep(step: ChecklistStep): boolean {
  return (PL_SHIPMENT_STEPS as readonly string[]).includes(step);
}

/**
 * Envio na hora ao GSS (datas do PL e ETD) — LIGADO. Ficou desligado de 07 a
 * 16/10 por um "fail request" que não era dele: naquele dia TODAS as actions das
 * telas de detalhe quebravam por um `export type` em arquivo "use server"
 * (corrigido em 9d31fa9). `GSS_PUSH_DISABLED=true` na Vercel desliga sem deploy
 * de código (só redeploy).
 */
function gssPushEnabled(): boolean {
  return process.env.GSS_PUSH_DISABLED !== "true";
}

function logWrite(prefix: string, call: { method: string; path: string }, result: GssWriteResult): void {
  const line = `${prefix} ${call.method} ${call.path} → ${result.status} (${result.kind})`;
  if (result.kind === "ok") console.log(line);
  else console.error(`${line}: ${result.error ?? result.text}`);
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
export function sendPlShipmentToGss(preLoadingId: string, opts: { create?: boolean } = {}): void {
  if (!gssPushEnabled()) return;
  try {
    after(async () => {
      try {
        // Padrão = só PATCH: PL que não existe no GSS sai "skipped" no log. O
        // Create PL passa `create: true` → PATCH 404 → POST /shipments/ (pedido
        // do usuário em 18/10: "liberar um POST lá quando criamos um PL").
        const push = await pushPlShipment(createAdminClient(), preLoadingId, { create: opts.create ?? false });
        if (push.outcome === "skipped") {
          console.warn(`[gss] PL ${preLoadingId} não enviado: ${push.reason}`);
        } else if (push.outcome === "called") {
          logWrite("[gss]", push.call, push.result);
          if (push.meta) logWrite("[gss]", push.meta.call, push.meta.result);
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
 * Manda o ETD das linhas Factory × Category ao GSS (`/shipments/etd-factories/`)
 * depois da resposta — mesmo esquema do PL acima. Chamado pelos saves do ETD
 * na tela (linha e modal de motivo); a escrita pela NOSSA API não chama (não
 * ecoa de volta para o GSS o que veio dele).
 */
export function sendEtdToGss(ofcIds: string[]): void {
  if (!gssPushEnabled() || !ofcIds.length) return;
  try {
    after(async () => {
      const db = createAdminClient();
      for (const ofcId of ofcIds) {
        try {
          const push = await pushEtdFactory(db, ofcId);
          if (push.outcome === "skipped") console.warn(`[gss-etd] ${ofcId} não enviado: ${push.reason}`);
          else if (push.outcome === "called") logWrite(`[gss-etd] ${push.label}`, push.call, push.result);
        } catch (err) {
          console.error(`[gss-etd] envio da linha ${ofcId} falhou:`, err);
        }
      }
    });
  } catch (err) {
    console.error("[gss-etd] after() indisponível:", err);
  }
}
