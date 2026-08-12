"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PermissionMap } from "@/domain/access/features";
import { NAV, type NavGroup } from "./nav";

export function SidebarNav({
  permissions,
  onNavigate,
  collapsed = false,
}: {
  permissions: PermissionMap;
  onNavigate?: () => void;
  /** Trilho estreito (<1100px, sem hover): só o ícone num quadrado arredondado. */
  collapsed?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("grid gap-1", collapsed && "justify-items-center")}>
      {NAV.map((item) => {
        // Mapa já resolvido no servidor (lib/dal.ts) — aqui é só exibição.
        if (!permissions[item.feature].view) return null;

        // Grupo no trilho vira só o ícone (leva ao primeiro filho); a árvore
        // completa aparece quando o trilho expande no hover.
        if (item.type === "group") {
          if (collapsed) {
            const childActive = item.children.some(
              (c) => pathname === c.href || pathname.startsWith(c.href + "/")
            );
            return (
              <RailIcon
                key={item.title}
                href={item.children[0]?.href ?? "#"}
                icon={item.icon}
                title={item.title}
                active={childActive}
                onNavigate={onNavigate}
              />
            );
          }
          return (
            <GroupItem
              key={item.title}
              group={item}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          );
        }

        if (collapsed) {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <RailIcon
              key={item.href}
              href={item.href}
              icon={item.icon}
              title={item.title}
              active={active}
              onNavigate={onNavigate}
            />
          );
        }

        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <div key={item.href} className="relative">
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg py-2.5 pl-3 pr-10 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              <Icon className="size-[18px] shrink-0" />
              <span className="flex-1">{item.title}</span>
            </Link>
            {/* Abre a MESMA rota em nova aba. Âncora à parte: não se aninha <a> em <a>. */}
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${item.title} in a new tab`}
              title="Open in a new tab"
              className={cn(
                "absolute inset-y-0 right-0 flex items-center px-3 transition-colors",
                active
                  ? "text-white/70 hover:text-white"
                  : "text-slate-300 hover:text-slate-500"
              )}
            >
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          </div>
        );
      })}
    </nav>
  );
}

/** Item do trilho colapsado: só o ícone, num quadrado arredondado. */
function RailIcon({
  href,
  icon: Icon,
  title,
  active,
  onNavigate,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={title}
      title={title}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex size-10 items-center justify-center rounded-xl transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-slate-600 hover:bg-slate-100"
      )}
    >
      <Icon className="size-[18px] shrink-0" />
    </Link>
  );
}

function GroupItem({
  group,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  onNavigate?: () => void;
}) {
  const childActive = group.children.some(
    (c) => pathname === c.href || pathname.startsWith(c.href + "/")
  );
  const [open, setOpen] = useState(childActive);
  const Icon = group.icon;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          childActive ? "text-primary" : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="flex-1 text-left">{group.title}</span>
        <ChevronDown
          className={cn(
            "size-4 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open ? (
        <div className="mt-1 grid gap-1 pl-6">
          {group.children.map((c) => {
            const active =
              pathname === c.href || pathname.startsWith(c.href + "/");
            return (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-slate-500 hover:bg-slate-100"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    active ? "bg-primary" : "bg-slate-300"
                  )}
                />
                {c.title}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
