/**
 * Backfill das etapas 18-24 (Shipping Date, BL, Original Docs, Inspection
 * Report, ETA Brazil, ATA Brazil, Delivered) em `pre_loading_checklist_steps`,
 * mais leader/signer/carrier em `shipments`.
 *
 * POR QUE: a migração original monta as etapas do PL a partir de
 * `[vistapub]checklistxitem`, ligando cada item ao PL via
 * `pre-loading."[Vistapub] Checklist x Item"`. Os 24.505 itens de Sorted 18-24
 * do Bubble NÃO estão nessa lista (zero deles) — então todos caíam no `skip`
 * de importChecklist(). Resultado: 1.337 embarques exibem "7 of 14 steps" e o
 * bloco Transport/Responsible vazio, mesmo com 1.266 marcados "Delivered".
 *
 * FONTES (a primeira que resolver, por etapa):
 *   A) `shipping` — tem, por etapa, data prevista + data de conclusão +
 *      responsável + signatário. É a fonte rica. Junta por
 *      PreShipmentNumber = pre_loadings.pl_number.
 *   B) `[vistapub]shippment` — tem 5 das 7 datas como campos diretos
 *      ([Filter] Shipping Date / BL Date / ETA Brazil / ATA Brazil / Delivered),
 *      sem original_docs nem inspection_report. Junta por shipments.bubble_id,
 *      que a migração já gravou. Cobre os embarques que A não alcança.
 *
 * NÃO recuperável: `shipments.shipment_model_id` — não há campo de modelo de
 * embarque em nenhum dos data types do Bubble (só a tabela `shipmentmodel`
 * solta, sem quem a referencie).
 *
 * SEGURANÇA:
 *   - dry-run por padrão; grava só com `--apply`.
 *   - nunca sobrescreve linha de etapa existente (respeita o que o app criou).
 *   - em `shipments`, só preenche coluna que está NULL.
 *   - `bubble_id` das linhas criadas carrega a origem
 *     (`shipping:<id>:<step>` / `shippment:<id>:<step>`), o que dá idempotência
 *     e permite reverter por prefixo.
 *
 * Uso:  npx tsx scripts/migrate/backfill-shipment-checklist.ts [--apply]
 */
import { fetchAll, type BubbleRow } from "./bubble";
import { supabaseAdmin } from "./client";
import { dateOnly, loadIdMap, ref, str } from "./upsert";

const APPLY = process.argv.includes("--apply");
const PAGE = 1000;
const BATCH = 500;

type Row = Record<string, unknown>;

/** As 7 etapas de embarque e os campos correspondentes em `shipping`. */
const SHIP_STEPS = [
  { step: "shipping_date", comp: "ShipmentDate-Date-Comp", prev: "ShipmentDate-Date-Prev", resp: "ShipmentDate-Resp", sign: "Shipment-Date-Signature", direct: "[Filter] Shipping Date" },
  { step: "bl", comp: "BL-Date-Comp", prev: "BL-Date-Prev", resp: "BL-Resp", sign: "BL-Signature", direct: "[Filter] BL Date" },
  { step: "original_docs", comp: "OriginalDocs-Date-Comp", prev: "OriginalDocs-Date-Prev", resp: "OriginalDocs-Resp", sign: "Original-Docs-Signature", direct: null },
  { step: "inspection_report", comp: "InspectionReport-Date-Comp", prev: "InspectionReport-Date-Prev", resp: "InspectionReport-Resp", sign: "Inspection-Report-Signature", direct: null },
  { step: "eta_brazil", comp: "ETA-Brazil-Date-Comp", prev: "ETABrazil-Date-Prev", resp: "ETABrazil-Resp", sign: "ETA-Brazil-Signature", direct: "[Filter] ETA Brazil" },
  { step: "ata_brazil", comp: "ATA-Brazil-Date-Comp", prev: "ATA-Brazil-Date-Prev", resp: "ATA-Brazil-Resp", sign: "ATA-Brazil-Signature", direct: "[Filter] ATA Brazil" },
  { step: "delivered", comp: "Delivery-Date-Comp", prev: "Delivery-Date-Prev", resp: "Delivery-Resp", sign: "Delivery-Signature", direct: "[Filter] Delivered" },
] as const;

type ShipmentRow = {
  id: string;
  pre_loading_id: string;
  bubble_id: string | null;
  container_number: string | null;
  carrier_id: string | null;
  leader_id: string | null;
  signer_id: string | null;
};

/** Lê uma tabela inteira, contornando o corte de 1000 linhas do PostgREST. */
async function readAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(APPLY ? "== MODO APPLY (grava) ==\n" : "== DRY-RUN (nao grava; use --apply) ==\n");

  const [shipments, pls, userMap, carrierMap] = await Promise.all([
    readAll<ShipmentRow>(
      "shipments",
      "id, pre_loading_id, bubble_id, container_number, carrier_id, leader_id, signer_id",
      (q) => q.is("deleted_at", null)
    ),
    readAll<{ id: string; pl_number: string; bubble_id: string | null }>(
      "pre_loadings",
      "id, pl_number, bubble_id"
    ),
    loadIdMap("profiles"),
    loadIdMap("carriers"),
  ]);
  console.log("shipments vivos:", shipments.length, "| pre_loadings:", pls.length);
  console.log("profiles mapeados:", userMap.size, "| carriers mapeados:", carrierMap.size);

  const plNumberById = new Map(pls.map((p) => [p.id, String(Number(p.pl_number))]));
  const plBubbleById = new Map(pls.map((p) => [p.id, p.bubble_id]));

  // ---- Fonte A: `shipping`, por numero de PL ----
  const shippingRows = await fetchAll("shipping");
  const shippingByNum = new Map<string, BubbleRow>();
  let dupA = 0;
  for (const r of shippingRows) {
    const n = String(Number(r.PreShipmentNumber));
    if (shippingByNum.has(n)) { dupA++; continue; } // mantem o primeiro
    shippingByNum.set(n, r);
  }
  console.log("`shipping`:", shippingRows.length, "| duplicados de PreShipmentNumber ignorados:", dupA);

  // ---- Fonte B: `[vistapub]shippment`, pelo bubble_id do shipment ----
  const shippmentRows = await fetchAll("[vistapub]shippment");
  const shippmentById = new Map(shippmentRows.map((r) => [r._id, r]));
  console.log("`[vistapub]shippment`:", shippmentRows.length);

  // ---- Carrier: item de checklist Sorted 16 (etapa Agents) do PL ----
  const items = await fetchAll("[vistapub]checklistxitem");
  const itemById = new Map(items.map((i) => [i._id, i]));
  const carrierByPlBubble = new Map<string, string>();
  for (const p of await fetchAll("[vistapub]pre-loading")) {
    const list = Array.isArray(p["[Vistapub] Checklist x Item"]) ? p["[Vistapub] Checklist x Item"] : [];
    for (const it of list) {
      const item = itemById.get(it as string);
      if (item && Number(item.Sorted) === 16 && str(item["[Value] Carrier"])) {
        carrierByPlBubble.set(p._id, String(item["[Value] Carrier"]));
      }
    }
  }
  console.log("PLs com carrier na etapa Agents:", carrierByPlBubble.size);

  // ---- Etapas 18-24 que JA existem: nunca sobrescrever ----
  const stepNames = SHIP_STEPS.map((s) => s.step);
  const existing = await readAll<{ pre_loading_id: string; step: string }>(
    "pre_loading_checklist_steps",
    "pre_loading_id, step",
    (q) => q.in("step", stepNames)
  );
  const existingKey = new Set(existing.map((e) => `${e.pre_loading_id}|${e.step}`));
  console.log("linhas 18-24 preexistentes (preservadas):", existingKey.size);

  // ---- Monta as linhas ----
  const novas: Row[] = [];
  const porFonte = { shipping: 0, shippment: 0 };
  const porEtapa = new Map<string, number>();
  let comData = 0;
  const shipUpdates: { id: string; patch: Row }[] = [];
  let semFonte = 0;

  for (const s of shipments) {
    const num = plNumberById.get(s.pre_loading_id);
    const a = num ? shippingByNum.get(num) : undefined;
    const b = s.bubble_id ? shippmentById.get(s.bubble_id) : undefined;
    if (!a && !b) { semFonte++; continue; }

    for (const def of SHIP_STEPS) {
      if (existingKey.has(`${s.pre_loading_id}|${def.step}`)) continue;

      let completed_on: string | null = null;
      let estimated_date: string | null = null;
      let responsible_id: string | null = null;
      let signed_by_id: string | null = null;
      let origem: "shipping" | "shippment" | null = null;
      let origemId = "";

      if (a) {
        completed_on = dateOnly(a[def.comp]);
        estimated_date = dateOnly(a[def.prev]);
        responsible_id = ref(userMap, a[def.resp]);
        signed_by_id = ref(userMap, a[def.sign]);
        if (completed_on || estimated_date || responsible_id) {
          origem = "shipping";
          origemId = a._id;
        }
      }
      if (!origem && b && def.direct) {
        completed_on = dateOnly(b[def.direct]);
        estimated_date = null;
        responsible_id = ref(userMap, b["[Header] Responsible"]);
        signed_by_id = ref(userMap, b["[Header] Signer"]);
        if (completed_on) {
          origem = "shippment";
          origemId = b._id;
        }
      }
      // Sem nenhum dado pra essa etapa: cria a linha vazia de qualquer forma,
      // senao o checklist do embarque continua com 7 de 14 slots. A etapa
      // aparece como pendente, que e a verdade.
      if (!origem) {
        origem = a ? "shipping" : "shippment";
        origemId = (a ?? b)!._id;
        completed_on = null;
        estimated_date = null;
        responsible_id = null;
        signed_by_id = null;
      } else if (completed_on) {
        comData++;
      }

      porFonte[origem]++;
      porEtapa.set(def.step, (porEtapa.get(def.step) ?? 0) + 1);
      novas.push({
        pre_loading_id: s.pre_loading_id,
        step: def.step,
        done: completed_on != null,
        estimated_date,
        completed_on,
        responsible_id,
        signed_by_id,
        bubble_id: `${origem}:${origemId}:${def.step}`,
      });
    }

    // Cabecalho do shipment: so preenche o que esta NULL
    const patch: Row = {};
    const plBubble = plBubbleById.get(s.pre_loading_id);
    if (!s.leader_id && b) {
      const v = ref(userMap, b["[Header] Responsible"]);
      if (v) patch.leader_id = v;
    }
    if (!s.signer_id && b) {
      const v = ref(userMap, b["[Header] Signer"]);
      if (v) patch.signer_id = v;
    }
    if (!s.container_number && b) {
      const v = str(b["[Header] Container Number"]);
      if (v && v !== "N/A") patch.container_number = v;
    }
    if (!s.carrier_id && plBubble) {
      const cb = carrierByPlBubble.get(plBubble);
      const v = cb ? carrierMap.get(cb) ?? null : null;
      if (v) patch.carrier_id = v;
    }
    if (Object.keys(patch).length) shipUpdates.push({ id: s.id, patch });
  }

  console.log("\n=== linhas de etapa a criar ===");
  console.log("total:", novas.length, "| com data de conclusao:", comData);
  // A To do list lista etapa pendente (completed_on NULL) COM responsible_id.
  // Linha assim, num embarque ja entregue, entra la como tarefa falsa — e o
  // mesmo ruido ja conhecido da migracao original. Medir antes de aplicar.
  const pendenteComResp = novas.filter((r) => !r.completed_on && r.responsible_id).length;
  const pendenteSemResp = novas.filter((r) => !r.completed_on && !r.responsible_id).length;
  console.log("pendentes COM responsavel (entram na To do list):", pendenteComResp);
  console.log("pendentes sem responsavel (invisiveis na To do):", pendenteSemResp);
  console.log("por fonte:", porFonte);
  for (const st of stepNames) console.log("  ", st.padEnd(18), porEtapa.get(st) ?? 0);
  console.log("shipments sem nenhuma fonte:", semFonte);

  const campos = { leader_id: 0, signer_id: 0, container_number: 0, carrier_id: 0 };
  for (const u of shipUpdates)
    for (const k of Object.keys(u.patch)) campos[k as keyof typeof campos]++;
  console.log("\n=== shipments a atualizar ===");
  console.log("registros:", shipUpdates.length, campos);

  if (!APPLY) {
    console.log("\nDry-run: nada gravado. Rode com --apply pra aplicar.");
    return;
  }

  console.log("\nGravando etapas...");
  for (let i = 0; i < novas.length; i += BATCH) {
    const chunk = novas.slice(i, i + BATCH);
    const { error } = await supabaseAdmin
      .from("pre_loading_checklist_steps")
      .upsert(chunk, { onConflict: "bubble_id" });
    if (error) throw new Error(`insert etapas @${i}: ${error.message}`);
    process.stdout.write(`\r  ${Math.min(i + BATCH, novas.length)}/${novas.length}`);
  }
  console.log("\nAtualizando shipments...");
  let n = 0;
  for (const u of shipUpdates) {
    const { error } = await supabaseAdmin.from("shipments").update(u.patch).eq("id", u.id);
    if (error) throw new Error(`update shipment ${u.id}: ${error.message}`);
    if (++n % 100 === 0) process.stdout.write(`\r  ${n}/${shipUpdates.length}`);
  }
  console.log(`\r  ${n}/${shipUpdates.length}`);
  console.log("\nPronto.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
