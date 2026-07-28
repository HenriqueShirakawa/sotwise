"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { NAV, type NavGroup } from "./nav";

export function SidebarNav({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="grid gap-1">
      {NAV.map((item) => {
        if (item.adminOnly && !isAdmin) return null;

        if (item.type === "group") {
          return (
            <GroupItem
              key={item.title}
              group={item}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          );
        }

        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
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
                ? "bg-violet-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <Icon className="size-[18px] shrink-0" />
            <span className="flex-1">{item.title}</span>
          </Link>
        );
      })}
    </nav>
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
          childActive ? "text-violet-700" : "text-slate-600 hover:bg-slate-100"
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
                    ? "bg-violet-50 font-medium text-violet-700"
                    : "text-slate-500 hover:bg-slate-100"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    active ? "bg-violet-600" : "bg-slate-300"
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
