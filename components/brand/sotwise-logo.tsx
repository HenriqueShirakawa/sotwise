import { cn } from "@/lib/utils";

/**
 * Logo SOTWISE — PLACEHOLDER (hexágono roxo + wordmark) até o SVG oficial
 * do Bubble ser fornecido. Trocar o <svg> pelo asset real quando chegar.
 */
export function SotwiseLogo({
  className,
  wordmark = true,
}: {
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        viewBox="0 0 40 44"
        className="h-9 w-auto"
        role="img"
        aria-label="Sotwise"
      >
        <defs>
          <linearGradient id="sotwise-hex" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e935c1" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <polygon
          points="20,2 37,12 37,32 20,42 3,32 3,12"
          fill="url(#sotwise-hex)"
        />
        <path
          d="M25 16.5c-1.4-1.2-3.2-1.9-5-1.9-2.8 0-5 1.6-5 3.9 0 2.1 1.7 3 4.3 3.6 2.6.6 3.2 1 3.2 1.9s-1 1.6-2.6 1.6c-1.6 0-3.1-.7-4.3-1.8"
          fill="none"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      {wordmark ? (
        <span className="text-xl font-extrabold tracking-tight text-slate-900">
          SOTWISE
        </span>
      ) : null}
    </div>
  );
}
