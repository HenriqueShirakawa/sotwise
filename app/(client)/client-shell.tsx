"use client";

import { Suspense, useState, useTransition, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  Globe,
  LayoutGrid,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { signOut } from "@/lib/auth/actions";
import {
  PORTAL_LOCALES,
  PORTAL_LOCALE_NAMES,
  type PortalLocale,
  type PortalMessages,
} from "@/lib/portal-i18n";
import { cn } from "@/lib/utils";
import { SotwiseLogo } from "@/components/brand/sotwise-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import type { PortalNotification } from "@/domain/client/portal-notifications";

import { setPortalLocale } from "./locale-actions";
import { NotificationBell } from "./notification-bell";
import { PortalI18nProvider, usePortalI18n } from "./portal-i18n-provider";

/**
 * Casca do portal do cliente: menu lateral próprio (Dashboard / My orders /
 * Support), barra do topo com o título da tela, a busca de pedidos e o seletor
 * de idioma.
 *
 * Deliberadamente NÃO é o `AppShell` interno — ver o comentário em layout.tsx.
 * Mesma régua de largura do interno: sidebar fixa ≥768px, gaveta abaixo disso.
 */

type NavItem = {
  href: string;
  title: (t: PortalMessages) => string;
  icon: ComponentType<{ className?: string }>;
  /** Só a rota exata acende o item (o Dashboard é a raiz `/portal`). */
  exact?: boolean;
};

const NAV: NavItem[] = [
  { href: "/portal", title: (t) => t.nav.dashboard, icon: LayoutGrid, exact: true },
  { href: "/portal/orders", title: (t) => t.nav.myOrders, icon: Package },
  { href: "/portal/support", title: (t) => t.nav.support, icon: MessageSquare },
];

const ORDERS_PATH = "/portal/orders";

function isActive(item: NavItem, pathname: string) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/** Título da barra do topo. O detalhe do pedido (`/portal/[id]`) conta como My orders. */
function titleFor(pathname: string, t: PortalMessages) {
  if (pathname === "/portal") return t.nav.overview;
  if (pathname.startsWith("/portal/support")) return t.nav.support;
  return t.nav.myOrders;
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

export function ClientShell(props: {
  fullName: string;
  clientName: string | null;
  locale: PortalLocale;
  notifications: PortalNotification[];
  children: React.ReactNode;
}) {
  return (
    <PortalI18nProvider locale={props.locale}>
      <Shell {...props} />
    </PortalI18nProvider>
  );
}

function Shell({
  fullName,
  clientName,
  locale,
  notifications,
  children,
}: {
  fullName: string;
  clientName: string | null;
  locale: PortalLocale;
  notifications: PortalNotification[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = usePortalI18n();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/portal" onClick={onNavigate} aria-label={t.nav.dashboard}>
          <SotwiseLogo className="h-8" />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          {t.nav.menu}
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
                {item.title(t)}
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
            aria-label={t.nav.signOut}
            title={t.nav.signOut}
            className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div lang={locale} className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r md:block">
        {sidebar()}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-white/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/80 md:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.nav.openMenu}
                className="md:hidden"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">{t.nav.menu}</SheetTitle>
              {sidebar(() => setMobileOpen(false))}
            </SheetContent>
          </Sheet>
          {/* No celular o título sai e a busca ocupa a barra — o item ativo do
              menu já diz onde se está. */}
          <h1 className="hidden min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-slate-900 sm:block">
            {titleFor(pathname, t)}
          </h1>
          {/* useSearchParams pede Suspense acima dele (docs do Next). */}
          <Suspense
            fallback={<SearchBox t={t} defaultValue="" onSearch={() => {}} />}
          >
            <TopSearch />
          </Suspense>
          <NotificationBell notifications={notifications} />
          <LanguageMenu />
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 pb-16 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Seletor de idioma. A escolha fica no usuário (server action) e a tela é
 * renderizada de novo no servidor já no idioma novo.
 */
function LanguageMenu() {
  const { locale, t } = usePortalI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: PortalLocale) {
    if (next === locale) return;
    startTransition(async () => {
      const res = await setPortalLocale(next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.nav.language}
          title={t.nav.language}
          disabled={pending}
          className="shrink-0 gap-1.5 px-2 text-slate-600"
        >
          <Globe className="size-4" />
          <span className="hidden text-xs font-medium sm:inline">{PORTAL_LOCALE_NAMES[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-slate-500">{t.nav.language}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PORTAL_LOCALES.map((l) => (
          <DropdownMenuItem key={l} lang={l} onSelect={() => choose(l)} className="justify-between">
            {PORTAL_LOCALE_NAMES[l]}
            {l === locale ? <Check className="size-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const { t } = usePortalI18n();
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
      t={t}
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
  t,
  defaultValue,
  onChange,
  onSearch,
}: {
  t: PortalMessages;
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
        placeholder={t.nav.searchPlaceholder}
        aria-label={t.nav.searchLabel}
        className="h-9 rounded-lg bg-white pl-9"
      />
    </form>
  );
}
