"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";

import { formatDateNumeric } from "@/lib/format";
import { SearchSelect } from "@/components/search-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormDrawer } from "@/components/form-drawer";

import { upsertEtdInfo } from "./actions";
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

function RemarksDrawer({
  orderId,
  row,
  etd,
  open,
  onOpenChange,
}: {
  orderId: string;
  row: OfcRow | null;
  etd: EtdInfoRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [remarks, setRemarks] = useState(etd.remarks ?? "");

  const openFor = open ? (row?.id ?? null) : null;
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (openFor !== syncedFor) {
    setSyncedFor(openFor);
    setRemarks(etd.remarks ?? "");
  }

  function save() {
    if (!row) return;
    startTransition(async () => {
      const res = await upsertEtdInfo(orderId, row.id, { remarks: remarks.trim() || null });
      if (res.ok) {
        toast.success("ETD information updated.");
        router.refresh();
        onOpenChange(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <FormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="ETD information"
      description={row ? `${row.factory_name} · ${row.category_name}` : undefined}
    >
      <div className="grid gap-4 pt-2">
        <div className="grid gap-2">
          <Label>Remarks</Label>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={6}
            placeholder="Notes about this ETD…"
          />
        </div>
        <Button onClick={save} disabled={pending}>
          Save
        </Button>
      </div>
    </FormDrawer>
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
  const [drawerRow, setDrawerRow] = useState<OfcRow | null>(null);

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
                    disabled={pending}
                    onCheckedChange={(checked) => save(r.id, { inspection: !!checked })}
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={etd.ready}
                    disabled={pending}
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
                    aria-label="ETD information"
                    onClick={() => setDrawerRow(r)}
                  >
                    <ArrowUpRight className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <RemarksDrawer
        orderId={orderId}
        row={drawerRow}
        etd={drawerRow ? (etdByOfc[drawerRow.id] ?? EMPTY_ETD) : EMPTY_ETD}
        open={!!drawerRow}
        onOpenChange={(o) => !o && setDrawerRow(null)}
      />
    </div>
  );
}
