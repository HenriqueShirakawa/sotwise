import { STATUS_COLORS, statusChipStyle } from "@/lib/status-colors";

export function StatusPill({ label }: { label: string }) {
  const hex = STATUS_COLORS[label] ?? "#475569";
  return (
    <span
      style={statusChipStyle(hex)}
      className="inline-flex items-center rounded-[4px] border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    >
      {label}
    </span>
  );
}
