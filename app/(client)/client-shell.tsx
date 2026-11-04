"use client";

import { Suspense, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, LogOut, Menu, MessageSquare, Package, Search } from "lucide-react";

import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import { SotwiseLogo } from "@/components/brand/sotwise-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * Casca do portal do cliente: menu lateral próprio (Dashboard / My orders /
 * Support), barra do topo com o título da tela e a busca de pedidos.
 *
 * Deliberadamente NÃO é o `AppShell` interno — ver o comentário em layout.tsx.
 * Mesma régua de largura do interno: sidebar fixa ≥768px, gaveta abaixo disso.
 */

type NavItem = {
  href: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  /** Só a rota exata acende o item (o Dashboard é a raiz `/portal`). */
  exact?: boolean;
};

const NAV: NavItem[] = [
  { href: "/portal", title: "Dashboard", icon: LayoutGrid, exact: true },
  { href: "/portal/orders", title: "My orders", icon: Package },
  { href: "/portal/support", title: "Support", icon: MessageSquare },
];

const ORDERS_PATH = "/portal/orders";

function isActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/** Título da barra do topo. O detalhe do pedido (`/portal/[id]`) conta como My orders. */
function titleFor(pathname: string) {
  if (pathname === "/portal") return "Overview";
  if (pathname.startsWith("/portal/support")) return "Support";
  return "My orders";
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function ClientShell({
  fullName,
  clientName,
  children,
}: {
  fullName: string;
  clientName: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/portal" onClick={onNavigate} aria-label="Dashboard">
          <SotwiseLogo className="h-8" />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          Menu
        </p>
        <div className="grid gap-1">
          {NAV.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                {item.title}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex items-center gap-3 border-t p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
          {initials(fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">{fullName}</p>
          {clientName ? <p className="truncate text-xs text-slate-500">{clientName}</p> : null}
        </div>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r md:block">
        {sidebar()}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-white/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/80 md:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu" className="md:hidden">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {sidebar(() => setMobileOpen(false))}
            </SheetContent>
          </Sheet>
          {/* No celular o título sai e a busca ocupa a barra — o item ativo do
              menu já diz onde se está. */}
          <h1 className="hidden min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-slate-900 sm:block">
            {titleFor(pathname)}
          </h1>
          {/* useSearchParams pede Suspense acima dele (docs do Next). */}
          <Suspense fallback={<SearchBox defaultValue="" onSearch={() => {}} />}>
            <TopSearch />
          </Suspense>
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 pb-16 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Busca do topo. Em My orders ela filtra a lista ao vivo (escreve `?q=` na
 * URL, que a lista lê); em qualquer outra tela, Enter leva a My orders já
 * filtrado, na aba All — quem busca um pedido não sabe em que aba ele está.
 */
function TopSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const onOrders = pathname === ORDERS_PATH;
  const current = onOrders ? params.get("q") ?? "" : "";

  function hrefFor(q: string, keepTab: boolean) {
    const next = new URLSearchParams(keepTab ? params.toString() : "");
    if (q) next.set("q", q);
    else next.delete("q");
    if (!keepTab && q) next.set("tab", "all");
    const qs = next.toString();
    return qs ? `${ORDERS_PATH}?${qs}` : ORDERS_PATH;
  }

  return (
    <SearchBox
      // Remonta ao sair/entrar de My orders para o campo refletir a URL.
      key={onOrders ? "orders" : "elsewhere"}
      defaultValue={current}
      onChange={
        onOrders ? (q) => router.replace(hrefFor(q, true), { scroll: false }) : undefined
      }
      onSearch={(q) => {
        if (!onOrders) router.push(hrefFor(q, false));
      }}
    />
  );
}

function SearchBox({
  defaultValue,
  onChange,
  onSearch,
}: {
  defaultValue: string;
  onChange?: (q: string) => void;
  onSearch: (q: string) => void;
}) {
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
        onSearch(q);
      }}
      className="relative min-w-0 flex-1 sm:w-[300px] sm:flex-none"
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        name="q"
        type="search"
        defaultValue={defaultValue}
        onChange={onChange ? (e) => onChange(e.target.value.trim()) : undefined}
        placeholder="Search order or reference"
        aria-label="Search orders"
        className="h-9 rounded-lg bg-white pl-9"
      />
    </form>
  );
}
