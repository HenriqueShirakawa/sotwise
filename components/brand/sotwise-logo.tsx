import { cn } from "@/lib/utils";

/** Significado da sigla SOTWISE (17/11/2026). */
export const SOTWISE_MEANING =
  "System Operation Trading Workflow Integration and Streamlining Efficiency";

/** Linha discreta com o significado da sigla, para ficar logo abaixo do logo. */
export function SotwiseTagline({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "max-w-[13.5rem] text-center text-[9.5px] leading-[1.35] font-medium tracking-wide text-slate-400",
        className
      )}
    >
      {SOTWISE_MEANING}
    </p>
  );
}

/** Logo oficial SOTWISE (hexágono + wordmark), auto-hospedado em /public. */
export function SotwiseLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-sotwise.svg"
      alt="Sotwise"
      className={cn("h-9 w-auto", className)}
    />
  );
}
