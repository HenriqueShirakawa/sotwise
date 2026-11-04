import { STATUS_COLORS, statusChipStyle } from "@/lib/status-colors";

/**
 * `label` é o rótulo canônico (inglês) e escolhe a cor; `text`, quando vier,
 * é o que aparece — o portal do cliente passa o status traduzido sem perder a
 * cor do status.
 */
export function StatusPill({ label, text }: { label: string; text?: string }) {
  const hex = STATUS_COLORS[label] ?? "#475569";
  return (
    <span
      style={statusChipStyle(hex)}
      className="inline-flex items-center rounded-[4px] border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    >
      {text ?? label}
    </span>
  );
}
