"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Paperclip, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { triggerDownload } from "@/lib/download";

import {
  deleteStepAttachment,
  getAttachmentDownloadUrl,
  uploadStepAttachment,
} from "./actions";
import type { BatchRow, ChecklistStepRow, OfcRow } from "./order-detail-client";

const GROUPS_PAGE_SIZE = 10;

type FactoryGroup = {
  factory_id: string;
  factory_name: string;
  entries: { id: string; category_name: string; batch_number: string }[];
};

/** Agrupa as entradas Factory x Category do pedido por Factory — mesma
 * entidade da etapa PO, só reexibida agrupada (ver docs/regras_de_negocio.md
 * §3.7.3). */
function buildFactoryGroups(ofc: OfcRow[], batches: BatchRow[]): FactoryGroup[] {
  const batchNumberById = new Map(batches.map((b) => [b.id, b.batch_number]));
  const byFactory = new Map<string, FactoryGroup>();
  for (const r of ofc) {
    if (!byFactory.has(r.factory_id)) {
      byFactory.set(r.factory_id, {
        factory_id: r.factory_id,
        factory_name: r.factory_name,
        entries: [],
      });
    }
    byFactory.get(r.factory_id)!.entries.push({
      id: r.id,
      category_name: r.category_name,
      batch_number: r.batch_id ? (batchNumberById.get(r.batch_id) ?? "—") : "—",
    });
  }
  return Array.from(byFactory.values()).sort((a, b) =>
    a.factory_name.localeCompare(b.factory_name)
  );
}

function FactoryAttachments({
  orderId,
  attachments,
}: {
  orderId: string;
  attachments: ChecklistStepRow["attachments"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function download(a: { file_path: string; file_name?: string | null }) {
    startTransition(async () => {
      const res = await getAttachmentDownloadUrl(a.file_path, a.file_name);
      if (res.ok) triggerDownload(res.url, a.file_name);
      else toast.error(res.error);
    });
  }

  function remove(a: { id: string; file_path: string }) {
    startTransition(async () => {
      const res = await deleteStepAttachment(orderId, a.id, a.file_path);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  if (attachments.length === 0) return null;

  return (
    <div className="space-y-1 px-3 py-2">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 text-sm"
        >
          <button
            type="button"
            className="truncate text-primary hover:underline"
            disabled={pending}
            onClick={() => download(a)}
          >
            {a.file_name ?? "File"}
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-rose-500 hover:text-rose-600"
            aria-label="Delete attachment"
            disabled={pending}
            onClick={() => remove(a)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function PlaceOrderFactoryGroups({
  orderId,
  stepId,
  ofc,
  batches,
  attachments,
}: {
  orderId: string;
  stepId: string;
  ofc: OfcRow[];
  batches: BatchRow[];
  attachments: ChecklistStepRow["attachments"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadFactoryId, setUploadFactoryId] = useState<string | null>(null);

  const groups = buildFactoryGroups(ofc, batches);
  const totalPages = Math.max(1, Math.ceil(groups.length / GROUPS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageGroups = groups.slice(
    safePage * GROUPS_PAGE_SIZE,
    safePage * GROUPS_PAGE_SIZE + GROUPS_PAGE_SIZE
  );

  function toggle(factoryId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(factoryId)) next.delete(factoryId);
      else next.add(factoryId);
      return next;
    });
  }

  function attachTo(factoryId: string) {
    setUploadFactoryId(factoryId);
    inputRef.current?.click();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const factoryId = uploadFactoryId;
    if (!file || !factoryId) return;
    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const res = await uploadStepAttachment(orderId, stepId, formData, factoryId);
      if (res.ok) {
        setExpanded((prev) => new Set(prev).add(factoryId));
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <input ref={inputRef} type="file" className="hidden" onChange={handleFile} />
      <div className="hidden grid-cols-[1fr_160px_128px_40px] items-center gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 sm:grid">
        <span>Factory</span>
        <span>N° of categories</span>
        <span />
        <span />
      </div>
      {pageGroups.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          No Factory x Category entries for this order yet.
        </p>
      ) : (
        pageGroups.map((g) => {
          const open = expanded.has(g.factory_id);
          const groupAttachments = attachments.filter((a) => a.factory_id === g.factory_id);
          return (
            <div key={g.factory_id} className="border-t">
              <div className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 text-sm sm:grid-cols-[1fr_160px_128px_40px]">
                <span className="flex min-w-0 items-center gap-2">
                  {/* Verde = fábrica já tem documento; âmbar = ainda falta. A
                      etapa só conclui quando todas estão verdes. */}
                  <span
                    aria-hidden
                    title={
                      groupAttachments.length > 0 ? "Document attached" : "Needs a document"
                    }
                    className={`size-2 shrink-0 rounded-full ${
                      groupAttachments.length > 0 ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  <span className="truncate font-medium text-slate-800">{g.factory_name}</span>
                </span>
                <span className="text-slate-700 max-sm:col-start-1 max-sm:text-xs max-sm:text-slate-500">
                  {g.entries.length}
                  <span className="sm:hidden"> categories</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start max-sm:col-start-1 max-sm:row-start-3"
                  disabled={pending}
                  onClick={() => attachTo(g.factory_id)}
                >
                  <Plus className="size-3.5" />
                  Attach
                  {groupAttachments.length > 0 && (
                    <span className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary">
                      {groupAttachments.length}
                    </span>
                  )}
                </Button>
                <button
                  type="button"
                  aria-label={open ? "Collapse" : "Expand"}
                  className="justify-self-center max-sm:col-start-2 max-sm:row-start-1"
                  onClick={() => toggle(g.factory_id)}
                >
                  <ChevronDown
                    className={`size-4 text-slate-400 transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>
              {open && (
                <div className="border-t bg-slate-50/60">
                  <div className="grid grid-cols-2 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500">
                    <span>Categories</span>
                    <span>Batch Number</span>
                  </div>
                  {g.entries.map((e) => (
                    <div key={e.id} className="grid grid-cols-2 border-t px-3 py-2 text-sm">
                      <span className="truncate text-slate-700">{e.category_name}</span>
                      <span className="text-slate-700">{e.batch_number}</span>
                    </div>
                  ))}
                  {groupAttachments.length > 0 && (
                    <div className="border-t">
                      <p className="flex items-center gap-1.5 px-3 pt-2 text-xs text-muted-foreground">
                        <Paperclip className="size-3.5" />
                        Attached documents
                      </p>
                      <FactoryAttachments orderId={orderId} attachments={groupAttachments} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
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
  );
}
