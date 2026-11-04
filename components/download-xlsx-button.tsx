"use client";

import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Botão "Download XLSX" das listas (lib/xlsx-download) — mesmo visual do "Filters". */
export function DownloadXlsxButton({
  downloading,
  onClick,
}: {
  downloading: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" className="h-11 rounded-xl bg-white" disabled={downloading} onClick={onClick}>
      {downloading ? <Loader2 className="animate-spin" /> : <Download />}
      Download XLSX
    </Button>
  );
}
