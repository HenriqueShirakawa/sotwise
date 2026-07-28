import { cn } from "@/lib/utils";

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
