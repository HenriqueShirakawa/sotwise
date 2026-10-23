"use server";

import { EVENT_DATE_LABELS } from "@/lib/checklist";
import { requireInternal } from "@/lib/dal";
import type { StepOwner } from "@/lib/checklist-email-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChecklistStep, ChecklistStepLogAction } from "@/types/database";

/** De onde contar o log: o checklist da Order ou o checklist único do PL/Shipment. */
export type StepLogScope =
  | { kind: "order"; orderId: string }
  | { kind: "pre_loading"; preLoadingId: string };

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Trocas do "Order received date" que vieram do GSS (API). O log só grava
 * alteração de usuário, mas esse campo é exceção (20/10/2026): o History da
 * etapa Order mostra também as do GSS — lidas da tabela de revisões, onde já
 * ficam gravadas, e marcadas como "GSS".
 */
async function gssReceivedDateRevisions(admin: Admin, stepIds: string[]) {
  if (stepIds.length === 0) return [];
  const { data } = await admin
    .from("checklist_step_revisions")
    .select("id, step_id, previous_date, new_date, reason, changed_at")
    .eq("kind", "order_received_date")
    .eq("source", "gss")
    .in("step_id", stepIds);
  return data ?? [];
}

/**
 * Quantas entradas de History cada etapa tem — UMA consulta por tela, para o
 * contador ao lado do chevron (o detalhe só carrega quando o popup abre).
 */
export async function loadStepLogCounts(
  scope: StepLogScope
): Promise<Partial<Record<ChecklistStep, number>>> {
  await requireInternal();
  const admin = createAdminClient();

  const { data: steps } =
    scope.kind === "order"
      ? await admin.from("order_checklist_steps").select("id, step").eq("order_id", scope.orderId)
      : await admin
          .from("pre_loading_checklist_steps")
          .select("id, step")
          .eq("pre_loading_id", scope.preLoadingId);
  if (!steps || steps.length === 0) return {};

  const stepOf = new Map(steps.map((s) => [s.id, s.step as ChecklistStep]));
  const column = scope.kind === "order" ? "checklist_step_id" : "pre_loading_step_id";
  const { data: rows } = await admin
    .from("checklist_step_log")
    .select(column)
    .in(column, [...stepOf.keys()]);

  const counts: Partial<Record<ChecklistStep, number>> = {};
  for (const row of (rows ?? []) as Record<string, string | null>[]) {
    const step = stepOf.get(row[column] ?? "");
    if (step) counts[step] = (counts[step] ?? 0) + 1;
  }
  if (scope.kind === "order") {
    for (const rev of await gssReceivedDateRevisions(admin, [...stepOf.keys()])) {
      const step = stepOf.get(rev.step_id);
      if (step) counts[step] = (counts[step] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Leitura do log de alterações de UMA etapa (`checklist_step_log`, ver
 * lib/checklist-step-log.ts) — alimenta o "History" das 3 telas de checklist.
 * Os ids crus do diff (responsável, agentes, porto…) saem daqui já com nome.
 */

type FieldKind = "date" | "text" | "bool";

export type StepLogChange = {
  field: string;
  label: string;
  kind: FieldKind;
  from: string | null;
  to: string | null;
};

export type StepLogEntry = {
  id: string;
  action: ChecklistStepLogAction;
  created_at: string;
  actor_name: string;
  changes: StepLogChange[];
  /** Só em attachment_added/attachment_removed. */
  file_name: string | null;
  /** Fábrica do anexo (Place the Order, por fábrica). */
  factory_name: string | null;
  /** Motivo da correção do admin (Completed on travado). */
  reason: string | null;
  /** "gss" = troca do Order received date vinda da API (selo "GSS"). */
  source: "user" | "gss";
};

type Lookup =
  | "profiles"
  | "factories"
  | "cities"
  | "pols"
  | "carriers"
  | "agents"
  | "contacts"
  | "clients";

/** Rótulo e tipo de cada coluna do log, na ordem em que aparecem na tela. */
const FIELDS: Record<string, { label: string; kind: FieldKind; lookup?: Lookup }> = {
  order_received_date: { label: "Order received date", kind: "date" },
  deposit_date: { label: "Deposit date", kind: "date" },
  balance_date: { label: "Balance date", kind: "date" },
  // Place the Order: "Fábrica: dd/mm/yyyy" (uma data por fábrica, 22/10/2026).
  placed_on: { label: "Placed on", kind: "text" },
  // Shipping Date / ETA / ATA / Delivered / Loading Date — o rótulo real vem de EVENT_DATE_LABELS.
  event_date: { label: "Date", kind: "date" },
  enabled: { label: "Enabled", kind: "bool" },
  estimated_date: { label: "Estimated date", kind: "date" },
  responsible_id: { label: "Responsible", kind: "text", lookup: "profiles" },
  completed_on: { label: "Completed on", kind: "date" },
  signed_by_id: { label: "Signed by", kind: "text", lookup: "profiles" },
  notes: { label: "Notes", kind: "text" },
  consolidation_point_id: { label: "Consolidation point", kind: "text", lookup: "factories" },
  city_id: { label: "City", kind: "text", lookup: "cities" },
  pol_id: { label: "Port of loading", kind: "text", lookup: "pols" },
  carrier_id: { label: "Carrier", kind: "text", lookup: "carriers" },
  agent_brazil_id: { label: "Agent Brazil", kind: "text", lookup: "agents" },
  agent_china_id: { label: "Agent China", kind: "text", lookup: "agents" },
  contact_brazil_id: { label: "Contact Brazil", kind: "text", lookup: "contacts" },
  contact_china_id: { label: "Contact China", kind: "text", lookup: "contacts" },
  booking_number: { label: "Booking number", kind: "text" },
  cutoff_date: { label: "Container cut-off", kind: "date" },
  doc_cutoff_date: { label: "Doc cut-off", kind: "date" },
  // Por cliente (22/10/2026): "Cliente: valor".
  client_tracking_number: { label: "Tracking number", kind: "text" },
  client_telex_release: { label: "Telex release", kind: "text" },
  client_delivered_date: { label: "Delivered date", kind: "text" },
};

type Diff = Record<string, { from: unknown; to: unknown }>;

export async function loadStepLog(owner: StepOwner): Promise<StepLogEntry[]> {
  await requireInternal();
  const admin = createAdminClient();

  let stepId: string | null = owner.kind === "order" ? owner.stepId : null;
  if (owner.kind === "pre_loading") {
    const { data } = await admin
      .from("pre_loading_checklist_steps")
      .select("id")
      .eq("pre_loading_id", owner.preLoadingId)
      .eq("step", owner.step)
      .maybeSingle();
    stepId = data?.id ?? null;
  }
  if (!stepId) return [];

  const { data: rows } = await admin
    .from("checklist_step_log")
    .select("id, action, changes, actor_id, created_at")
    .eq(owner.kind === "order" ? "checklist_step_id" : "pre_loading_step_id", stepId)
    .order("created_at", { ascending: false });

  const gssEntries: StepLogEntry[] =
    owner.kind === "order"
      ? (await gssReceivedDateRevisions(admin, [stepId])).map((rev) => ({
          id: rev.id,
          action: "update" as const,
          created_at: rev.changed_at,
          actor_name: "GSS",
          changes: [
            {
              field: "order_received_date",
              label: FIELDS.order_received_date.label,
              kind: "date" as const,
              from: rev.previous_date,
              to: rev.new_date,
            },
          ],
          file_name: null,
          factory_name: null,
          reason: rev.reason,
          source: "gss" as const,
        }))
      : [];
  if ((!rows || rows.length === 0) && gssEntries.length === 0) return [];

  // Junta todos os ids por tabela pra resolver os nomes de uma vez só.
  const idsByLookup = new Map<Lookup, Set<string>>();
  const want = (lookup: Lookup, id: unknown) => {
    if (typeof id !== "string" || !id) return;
    if (!idsByLookup.has(lookup)) idsByLookup.set(lookup, new Set());
    idsByLookup.get(lookup)!.add(id);
  };
  for (const row of rows ?? []) {
    want("profiles", row.actor_id);
    const changes = row.changes as Record<string, unknown>;
    want("factories", changes.factory_id);
    want("clients", changes.client_id);
    for (const [field, value] of Object.entries(changes)) {
      const lookup = FIELDS[field]?.lookup;
      if (!lookup || !value || typeof value !== "object") continue;
      const diff = value as { from: unknown; to: unknown };
      want(lookup, diff.from);
      want(lookup, diff.to);
    }
  }

  const names = new Map<string, string>();
  await Promise.all(
    [...idsByLookup].map(async ([lookup, ids]) => {
      const column = lookup === "profiles" ? "full_name" : "name";
      const { data } = await admin
        .from(lookup)
        .select(`id, ${column}`)
        .in("id", [...ids]);
      for (const r of (data ?? []) as unknown as Record<string, string>[]) {
        names.set(r.id, r[column]);
      }
    })
  );

  const display = (field: string, value: unknown): string | null => {
    if (value === null || value === undefined || value === "") return null;
    const meta = FIELDS[field];
    if (meta?.lookup) return names.get(String(value)) ?? "(removed)";
    if (meta?.kind === "bool") return value ? "Yes" : "No";
    return String(value);
  };

  const order = Object.keys(FIELDS);
  const userEntries: StepLogEntry[] = (rows ?? []).map((row) => {
    const raw = row.changes as Record<string, unknown>;
    const isAttachment = row.action === "attachment_added" || row.action === "attachment_removed";
    const changes: StepLogChange[] = isAttachment
      ? []
      : Object.entries(raw as Diff)
          .filter(([field]) => field in FIELDS)
          .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
          .map(([field, diff]) => ({
            field,
            label:
              field === "event_date" && owner.kind === "pre_loading"
                ? (EVENT_DATE_LABELS[owner.step] ?? FIELDS[field].label)
                : FIELDS[field].label,
            kind: FIELDS[field].kind,
            from: display(field, diff?.from),
            to: display(field, diff?.to),
          }));
    return {
      id: row.id,
      action: row.action,
      created_at: row.created_at,
      actor_name: names.get(row.actor_id) ?? "—",
      changes,
      file_name: isAttachment ? ((raw.file_name as string | null) ?? null) : null,
      factory_name:
        // De quem é o documento: a fábrica (Place the Order) ou o cliente
        // (Shipping Docs de PL com 2+ clientes).
        isAttachment && typeof raw.factory_id === "string"
          ? (names.get(raw.factory_id) ?? null)
          : isAttachment && typeof raw.client_id === "string"
            ? (names.get(raw.client_id) ?? null)
            : null,
      reason: typeof raw.reason === "string" ? raw.reason : null,
      source: "user" as const,
    };
  });

  // Mais recente primeiro, juntando usuário e GSS.
  return [...userEntries, ...gssEntries].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}
