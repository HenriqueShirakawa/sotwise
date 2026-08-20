"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { PreLoadingInput } from "@/domain/pre-loadings/schema";
import type { BatchStatus } from "@/types/database";
import { formatDateNumeric } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/search-select";
import { MultiSearchSelect } from "@/components/multi-search-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { createPreLoading, updatePreLoading } from "./actions";
import type { Ref } from "./filters-modal";
import type { PreLoadingRow } from "./pre-loading-client";

/**
 * Um lote selecionável na seção "Order selection". Só entram lotes em
 * `in_production` (regra confirmada: o PL agrupa lotes em produção) — mais os
 * lotes que já pertencem ao PL em edição, que estão em `preloading`.
 */
export type BatchOption = {
  id: string;
  order_id: string;
  po_number: string;
  batch_number: string;
  status: BatchStatus;
  client: string | null;
  client_id: string | null;
  /** PL que já reservou este lote — `null` quando está livre. */
  pre_loading_id: string | null;
  /** Entradas Factory×Category do lote (coluna "Factories Number"). */
  entries: { factory: string; category: string }[];
};

type FormState = {
  client_ids: string[];
  client_reference: string;
  pod_id: string;
  responsible_signer_id: string;
  leader_id: string;
};

const EMPTY: FormState = {
  client_ids: [],
  client_reference: "",
  pod_id: "",
  responsible_signer_id: "",
  leader_id: "",
};

const ROWS_PER_PAGE = 10;

type BatchSortKey = "client" | "po_batch" | "registers";
type BatchSort = { key: BatchSortKey; desc: boolean };

/** Ordem inicial: PO decrescente, igual à lista de lotes do Bubble. */
const DEFAULT_SORT: BatchSort = { key: "po_batch", desc: true };

/** PO e lote como número (o lote vem ".01", ".010"…) — desempate padrão. */
function poBatchCompare(a: BatchOption, b: BatchOption): number {
  return (
    (Number(a.po_number) || 0) - (Number(b.po_number) || 0) ||
    a.batch_number.localeCompare(b.batch_number, undefined, { numeric: true })
  );
}

const COMPARATORS: Record<BatchSortKey, (a: BatchOption, b: BatchOption) => number> = {
  client: (a, b) => (a.client ?? "").localeCompare(b.client ?? ""),
  po_batch: poBatchCompare,
  registers: (a, b) => a.entries.length - b.entries.length,
};

function fromRow(row: PreLoadingRow): FormState {
  return {
    client_ids: row.client_ids,
    client_reference: row.client_reference ?? "",
    pod_id: row.pod_id ?? "",
    responsible_signer_id: row.responsible_signer_id ?? "",
    leader_id: row.leader_id ?? "",
  };
}

/** "0 register" / "1 register" / "3 registers" — mesmo texto do Bubble, que usa
 * o singular também no zero. */
function registerLabel(count: number): string {
  return `${count} ${count <= 1 ? "register" : "registers"}`;
}

/** `PO / lote` — o lote é gravado como ".01"; aqui vai sem o ponto ("1488 / 01"). */
function poBatchLabel(poNumber: string, batchNumber: string): string {
  return `${poNumber} / ${batchNumber.replace(/^\.+/, "")}`;
}

export function PreLoadingFormModal({
  open,
  onOpenChange,
  editing,
  nextPlNumber,
  today,
  clients,
  profiles,
  pods,
  batchOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PreLoadingRow | null;
  nextPlNumber: string;
  today: string;
  clients: Ref[];
  profiles: Ref[];
  pods: Ref[];
  batchOptions: BatchOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [selected, setSelected] = useState<string[]>([]);
  // Snapshot dos lotes que já eram do PL na abertura — usado só pra ordenar
  // (eles vêm primeiro, senão ficariam perdidos numas 20 páginas). Não muda
  // quando o usuário marca/desmarca, pra tabela não pular embaixo do clique.
  const [pinned, setPinned] = useState<string[]>([]);
  const [orderQuery, setOrderQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<BatchSort>(DEFAULT_SORT);

  // Reinicializa o form a cada abertura (novo = vazio; edição = valores
  // atuais). Ajuste de estado durante o render — mesmo padrão do modal de
  // Orders, evita o antipadrão useEffect+setState.
  const openFor = open ? (editing?.id ?? "new") : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    if (openFor !== null) {
      setForm(editing ? fromRow(editing) : EMPTY);
      setSelected(editing ? editing.batch_ids : []);
      setPinned(editing ? editing.batch_ids : []);
      setOrderQuery("");
      setExpanded(null);
      setPage(0);
      setSort(DEFAULT_SORT);
    }
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Lotes "In production" ainda livres + os que já são deste PL (esses estão em
  // `preloading` e precisam aparecer marcados na edição). Os do PL ficam sempre
  // no topo, qualquer que seja a ordenação escolhida.
  const available = useMemo(() => {
    const pinnedSet = new Set(pinned);
    const compare = COMPARATORS[sort.key];
    const dir = sort.desc ? -1 : 1;
    return batchOptions
      .filter((b) =>
        b.pre_loading_id === null
          ? b.status === "in_production"
          : b.pre_loading_id === editing?.id
      )
      .sort(
        (a, b) =>
          Number(pinnedSet.has(b.id)) - Number(pinnedSet.has(a.id)) ||
          dir * compare(a, b) ||
          poBatchCompare(a, b)
      );
  }, [batchOptions, editing?.id, pinned, sort]);

  const toggleSort = (key: BatchSortKey) => {
    // Primeiro clique numa coluna nova = crescente; no mesmo cabeçalho, inverte.
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: false }));
    setPage(0);
  };

  // Os clientes escolhidos lá em cima também filtram a lista de lotes. Um lote
  // já marcado nunca some do filtro — senão ele iria junto no submit sem estar
  // visível pra ser desmarcado.
  const filtered = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    const clientSet = new Set(form.client_ids);
    return available.filter((b) => {
      if (selected.includes(b.id)) return true;
      if (clientSet.size && !(b.client_id && clientSet.has(b.client_id))) return false;
      return !q || b.po_number.toLowerCase().includes(q);
    });
  }, [available, orderQuery, form.client_ids, selected]);

  const pageCount = Math.max(Math.ceil(filtered.length / ROWS_PER_PAGE), 1);
  const pageIndex = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(pageIndex * ROWS_PER_PAGE, (pageIndex + 1) * ROWS_PER_PAGE);

  const toggleBatch = (batch: BatchOption) => {
    const isSelected = selected.includes(batch.id);
    setSelected((s) =>
      isSelected ? s.filter((v) => v !== batch.id) : [...s, batch.id]
    );
    // Ao MARCAR um lote, herda o cliente dele no campo Client (que também é o
    // filtro), se ainda não estiver lá — poupa o usuário de setar o filtro à
    // mão. Ao desmarcar não mexe: tirar o cliente na mão fica com o usuário.
    if (!isSelected && batch.client_id) {
      const clientId = batch.client_id;
      setForm((f) =>
        f.client_ids.includes(clientId)
          ? f
          : { ...f, client_ids: [...f.client_ids, clientId] }
      );
    }
  };

  const plNumber = editing ? editing.pl_number : nextPlNumber;
  const createDate = editing ? editing.created_date : today;

  const canSubmit =
    form.client_ids.length > 0 &&
    !!form.client_reference.trim() &&
    !!form.pod_id &&
    !!form.leader_id &&
    !pending;

  function submit() {
    const payload: PreLoadingInput = {
      client_ids: form.client_ids,
      client_reference: form.client_reference.trim(),
      pod_id: form.pod_id,
      responsible_signer_id: form.responsible_signer_id || null,
      leader_id: form.leader_id,
      batch_ids: selected,
    };
    startTransition(async () => {
      if (editing) {
        const res = await updatePreLoading(editing.id, payload);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Pre-loading updated.");
        onOpenChange(false);
        router.refresh();
        return;
      }
      const res = await createPreLoading(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Pre-loading created.");
      onOpenChange(false);
      // PL novo abre direto no próprio checklist — a lista atrás do modal é
      // idêntica e voltar pra ela dava a impressão de que nada aconteceu.
      router.push(`/pre-loading/${res.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">
            {editing ? "Edit pre-loading" : "Create pre-loading"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Section title="Pre-loading information">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pre-Loading No.:">
                <Input value={`PL - ${plNumber}`} disabled className="bg-muted" />
              </Field>
              <Field label="Pre-Loading Create Date:">
                <Input value={formatDateNumeric(createDate)} disabled className="bg-muted" />
              </Field>
            </div>
          </Section>

          <Section title="Operational details">
            <Field label="Client:" required>
              <MultiSearchSelect
                value={form.client_ids}
                onChange={(v) => {
                  set("client_ids", v);
                  setPage(0); // a lista de lotes abaixo também filtra por cliente
                }}
                options={clients}
                placeholder="Choose some clients..."
              />
            </Field>
            <Field label="Client(s) Reference:" required>
              <Input
                value={form.client_reference}
                onChange={(e) => set("client_reference", e.target.value)}
                placeholder="Enter client reference"
              />
            </Field>
            <Field label="Port of Destination:" required>
              <SearchSelect
                value={form.pod_id}
                onChange={(v) => set("pod_id", v)}
                options={pods}
                placeholder="Select port of destination"
              />
            </Field>
          </Section>

          <Section title="Responsible">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Responsible and Signer">
                <ProfileSelect
                  value={form.responsible_signer_id}
                  onChange={(v) => set("responsible_signer_id", v)}
                  options={profiles}
                />
              </Field>
              <Field label="Leader:" required>
                <ProfileSelect
                  value={form.leader_id}
                  onChange={(v) => set("leader_id", v)}
                  options={profiles}
                />
              </Field>
            </div>
          </Section>

          <Section title="Order selection">
            <div className="space-y-1.5">
              <Label className="text-foreground">Order number</Label>
              <div className="flex items-center gap-3">
                <Input
                  value={orderQuery}
                  onChange={(e) => {
                    setOrderQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Select order number"
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  className="shrink-0 border-primary text-primary"
                  onClick={() => {
                    setOrderQuery("");
                    setPage(0);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/80 text-xs font-semibold text-slate-500">
                    <th className="w-10 px-4 py-3" />
                    <SortableHeader
                      label="Clients"
                      sortKey="client"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableHeader
                      label="PO / Batch Number"
                      sortKey="po_batch"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableHeader
                      label="Factories Number"
                      sortKey="registers"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="h-20 text-center text-muted-foreground">
                        No batches in production available.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((b) => (
                      <Fragment key={b.id}>
                        <tr className="border-t">
                          <td className="px-4 py-3">
                            <Checkbox
                              checked={selected.includes(b.id)}
                              onCheckedChange={() => toggleBatch(b)}
                              aria-label={`Select batch ${poBatchLabel(
                                b.po_number,
                                b.batch_number
                              )}`}
                            />
                          </td>
                          <td className="px-4 py-3">{b.client ?? "—"}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {poBatchLabel(b.po_number, b.batch_number)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {registerLabel(b.entries.length)}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                              aria-label="Show factory entries"
                              className="text-slate-500 hover:text-primary"
                            >
                              <ChevronDown
                                className={`size-4 transition-transform ${
                                  expanded === b.id ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          </td>
                        </tr>
                        {expanded === b.id && (
                          <tr className="border-t bg-slate-50/60">
                            <td />
                            <td colSpan={4} className="px-4 py-3">
                              {b.entries.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  No Factory × Category entries for this batch.
                                </p>
                              ) : (
                                <ul className="space-y-1 text-xs text-slate-600">
                                  {b.entries.map((e, i) => (
                                    <li key={i}>
                                      {e.factory} — {e.category}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Page {pageIndex + 1} of {pageCount}
                {selected.length > 0 && ` · ${selected.length} selected`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-lg"
                  onClick={() => setPage(pageIndex - 1)}
                  disabled={pageIndex === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-lg"
                  onClick={() => setPage(pageIndex + 1)}
                  disabled={pageIndex >= pageCount - 1}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </Section>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="sm:min-w-32"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button className="sm:min-w-32" onClick={submit} disabled={!canSubmit}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cabeçalho clicável da seleção de lotes — mesma seta da lista de Pre-loading. */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: BatchSortKey;
  sort: BatchSort;
  onSort: (key: BatchSortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th className="px-4 py-3 text-left font-semibold">
      <button
        type="button"
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-slate-700"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowUpDown className={`size-3.5 ${active ? "text-primary" : "text-slate-400"}`} />
      </button>
    </th>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <p className="border-b pb-2 text-sm text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ProfileSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Ref[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
