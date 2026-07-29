"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Eye } from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric, formatDateTime } from "@/lib/format";
import { SearchSelect } from "@/components/search-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { getEtdHistory, updateEtdInfoWithReason, upsertEtdInfo } from "./actions";
import type { EtdHistoryEntry } from "./actions";
import type { BatchRow, EtdInfoRow, OfcRow, Ref } from "./order-detail-client";

const EMPTY_ETD: EtdInfoRow = {
  inspection: false,
  ready: false,
  ready_date: null,
  initial_date: null,
  current_date: null,
  dispatch_location_id: null,
  dispatch_date: null,
  remarks: null,
};

const EDITABLE_FIELDS = [
  { value: "current_date", label: "Current Date" },
  { value: "ready", label: "Ready" },
  { value: "inspection", label: "Inspection" },
  { value: "dispatch_location_id", label: "Dispatch Location" },
  { value: "dispatch_date", label: "Dispatch Date" },
] as const;

type FieldKey = (typeof EDITABLE_FIELDS)[number]["value"];

const HISTORY_PAGE_SIZE = 10;

function RemarksCell({ remarks }: { remarks: string | null }) {
  const [open, setOpen] = useState(false);
  if (!remarks) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className="max-w-32 truncate">{remarks}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Full remarks" className="text-slate-400 hover:text-slate-600">
            <Eye className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <p className="mb-1 text-sm font-medium text-foreground">Full remarks</p>
          <p className="text-sm text-slate-600">{remarks}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function EtdUpdateModal({
  orderId,
  row,
  etd,
  factories,
  open,
  onOpenChange,
}: {
  orderId: string;
  row: OfcRow | null;
  etd: EtdInfoRow;
  factories: Ref[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [field, setField] = useState<FieldKey | "">("");
  const [dateValue, setDateValue] = useState("");
  const [boolValue, setBoolValue] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [history, setHistory] = useState<EtdHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [page, setPage] = useState(0);

  const openFor = open ? (row?.id ?? null) : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setField("");
    setDateValue("");
    setBoolValue(false);
    setLocationId("");
    setRemarks("");
    setPage(0);
    setHistory([]);
    if (row) {
      setHistoryLoading(true);
      getEtdHistory(row.id).then((res) => {
        if (res.ok) setHistory(res.rows);
        else toast.error(res.error);
        setHistoryLoading(false);
      });
    }
  }

  const locked = field === "ready" ? etd.ready : field === "inspection" ? etd.inspection : false;
  const canSave = !!row && !!field && !locked && remarks.trim() !== "";

  function save() {
    if (!row || !field) return;
    const value: string | boolean | null =
      field === "ready" || field === "inspection"
        ? boolValue
        : field === "dispatch_location_id"
          ? locationId || null
          : dateValue || null;
    startTransition(async () => {
      const res = await updateEtdInfoWithReason(orderId, row.id, field, value, remarks);
      if (res.ok) {
        toast.success("ETD updated.");
        router.refresh();
        const historyRes = await getEtdHistory(row.id);
        if (historyRes.ok) setHistory(historyRes.rows);
        setField("");
        setDateValue("");
        setBoolValue(false);
        setLocationId("");
        setRemarks("");
      } else {
        toast.error(res.error);
      }
    });
  }

  const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = history.slice(
    safePage * HISTORY_PAGE_SIZE,
    safePage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg text-primary">ETD update</DialogTitle>
          {row && (
            <p className="text-sm text-muted-foreground">
              {row.factory_name} - {row.category_name}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3 rounded-lg bg-slate-50 p-3">
            <div>
              <Label className="text-foreground">Select what you want to change:</Label>
              <div className="mt-1.5">
                <Select value={field} onValueChange={(v) => setField(v as FieldKey)}>
                  <SelectTrigger className="w-full bg-white">
                    <SelectValue placeholder="Select a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {field === "current_date" || field === "dispatch_date" ? (
              <div>
                <Label className="text-foreground">
                  {field === "current_date" ? "Current date" : "Dispatch date"}
                </Label>
                <Input
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  className="mt-1.5 bg-white"
                />
              </div>
            ) : field === "ready" || field === "inspection" ? (
              <div>
                {locked && (
                  <p className="mb-1.5 text-xs text-amber-600">
                    Already set to yes — locked, can’t be changed here.
                  </p>
                )}
                <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
                  <Checkbox
                    checked={boolValue}
                    disabled={locked}
                    onCheckedChange={(checked) => setBoolValue(!!checked)}
                  />
                  {field === "ready" ? "Ready" : "Inspection"}
                </label>
              </div>
            ) : field === "dispatch_location_id" ? (
              <div>
                <Label className="text-foreground">Dispatch Location</Label>
                <div className="mt-1.5">
                  <SearchSelect
                    value={locationId}
                    onChange={setLocationId}
                    options={factories}
                    placeholder="Select factory"
                  />
                </div>
              </div>
            ) : null}

            {field && (
              <div>
                <Label className="text-foreground">Remarks</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add a brief description…"
                  className="mt-1.5 bg-white"
                  rows={3}
                />
              </div>
            )}

            <Button className="w-full" disabled={!canSave || pending} onClick={save}>
              Save changes
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insp.</TableHead>
                  <TableHead>Ready?</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Factory</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Current date</TableHead>
                  <TableHead>Dispatch lo.</TableHead>
                  <TableHead>Dispatch da.</TableHead>
                  <TableHead>Date/Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : pageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
                      No changes logged yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>
                        <Checkbox checked={h.inspection} disabled />
                      </TableCell>
                      <TableCell>
                        <Checkbox checked={h.ready} disabled />
                      </TableCell>
                      <TableCell>
                        <RemarksCell remarks={h.remarks} />
                      </TableCell>
                      <TableCell>{row?.factory_name}</TableCell>
                      <TableCell>{row?.category_name}</TableCell>
                      <TableCell>{formatDateNumeric(h.current_date)}</TableCell>
                      <TableCell>{h.dispatch_location_name ?? "—"}</TableCell>
                      <TableCell>{formatDateNumeric(h.dispatch_date)}</TableCell>
                      <TableCell className="text-slate-500">
                        {formatDateTime(h.changed_at)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
              <span>
                Page {safePage + 1} of {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  ←
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  →
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="sm:min-w-32" onClick={() => onOpenChange(false)}>
            Back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EtdStepTable({
  orderId,
  ofc,
  batches,
  etdByOfc,
  factories,
}: {
  orderId: string;
  ofc: OfcRow[];
  batches: BatchRow[];
  etdByOfc: Record<string, EtdInfoRow>;
  factories: Ref[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modalRow, setModalRow] = useState<OfcRow | null>(null);

  const batchNumberById = new Map(batches.map((b) => [b.id, b.batch_number]));
  const rows = [...ofc].sort(
    (a, b) =>
      a.factory_name.localeCompare(b.factory_name) ||
      a.category_name.localeCompare(b.category_name) ||
      (batchNumberById.get(a.batch_id ?? "") ?? "").localeCompare(
        batchNumberById.get(b.batch_id ?? "") ?? "",
        undefined,
        { numeric: true }
      )
  );

  function save(ofcId: string, patch: Parameters<typeof upsertEtdInfo>[2]) {
    startTransition(async () => {
      const res = await upsertEtdInfo(orderId, ofcId, patch);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-3 py-4 text-sm text-muted-foreground">
        No Factory x Category entries for this order yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Insp.</TableHead>
            <TableHead>Ready?</TableHead>
            <TableHead>Factory</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Initial Date</TableHead>
            <TableHead>Current Date</TableHead>
            <TableHead>Dispatch loc.</TableHead>
            <TableHead>Dispatch date</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const etd = etdByOfc[r.id] ?? EMPTY_ETD;
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Checkbox
                    checked={etd.inspection}
                    disabled={pending || etd.inspection}
                    onCheckedChange={(checked) => save(r.id, { inspection: !!checked })}
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={etd.ready}
                    disabled={pending || etd.ready}
                    onCheckedChange={(checked) => save(r.id, { ready: !!checked })}
                  />
                </TableCell>
                <TableCell className="font-medium text-slate-800">{r.factory_name}</TableCell>
                <TableCell>{r.category_name}</TableCell>
                <TableCell>{r.batch_id ? (batchNumberById.get(r.batch_id) ?? "—") : "—"}</TableCell>
                <TableCell>
                  <Input
                    type="date"
                    defaultValue={etd.initial_date ?? ""}
                    disabled={pending}
                    className="h-8 w-36"
                    onChange={(e) => save(r.id, { initial_date: e.target.value || null })}
                  />
                </TableCell>
                <TableCell className="text-slate-500">
                  {formatDateNumeric(etd.current_date)}
                </TableCell>
                <TableCell className="w-40">
                  <SearchSelect
                    value={etd.dispatch_location_id ?? ""}
                    onChange={(v) => save(r.id, { dispatch_location_id: v || null })}
                    options={factories}
                    placeholder="Select"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="date"
                    defaultValue={etd.dispatch_date ?? ""}
                    disabled={pending}
                    className="h-8 w-36"
                    onChange={(e) => save(r.id, { dispatch_date: e.target.value || null })}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-primary"
                    aria-label="ETD update"
                    onClick={() => setModalRow(r)}
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <EtdUpdateModal
        orderId={orderId}
        row={modalRow}
        etd={modalRow ? (etdByOfc[modalRow.id] ?? EMPTY_ETD) : EMPTY_ETD}
        factories={factories}
        open={!!modalRow}
        onOpenChange={(o) => !o && setModalRow(null)}
      />
    </div>
  );
}
