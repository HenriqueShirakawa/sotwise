"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";
import { SotwiseLogo } from "@/components/brand/sotwise-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MessageFab } from "@/components/messages/message-fab";
import type { PermissionMap } from "@/domain/access/features";
import { SidebarNav } from "./sidebar-nav";
import { UserCard } from "./user-menu";

/** Iniciais (até 2) pro avatar do trilho colapsado. */
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

export function AppShell({
  fullName,
  email,
  role,
  permissions,
  unreadMessages,
  children,
}: {
  fullName: string;
  email: string | null;
  role: string;
  permissions: PermissionMap;
  unreadMessages: number;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Hover do trilho controlado no React: `w-10 hover:w-64` do Tailwind não
  // vencia o `w-10` base na cascata (v4 mantém o hover em @media e o base ganhava
  // por ordem), então a expansão não acontecia. Alternando a classe na mão só
  // uma largura existe por vez — sem conflito.
  const [railHover, setRailHover] = useState(false);

  const sidebarInner = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[105px] shrink-0 items-center justify-center px-6">
        <SotwiseLogo className="h-16" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SidebarNav permissions={permissions} onNavigate={onNavigate} />
      </div>
      <div className="border-t p-3">
        <UserCard fullName={fullName} email={email} role={role} />
      </div>
    </div>
  );

  // Conteúdo do trilho estreito (<1100px, sem hover): logo só o hexágono, nav
  // só ícones em quadrados arredondados e o avatar. A sidebar completa aparece
  // ao passar o mouse (troca por `sidebarInner`).
  const sidebarRail = () => (
    <div className="flex h-full w-14 flex-col items-center bg-white">
      <div className="flex h-[105px] shrink-0 items-center justify-center">
        {/* Recorta o wordmark: sobra o hexágono. */}
        <span className="flex size-9 items-center overflow-hidden rounded-lg">
          <SotwiseLogo className="h-9 max-w-none" />
        </span>
      </div>
      <div className="w-full flex-1 overflow-y-auto px-2 py-2">
        <SidebarNav permissions={permissions} collapsed />
      </div>
      <div className="flex w-full justify-center border-t p-2">
        <span className="flex size-9 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
          {initials(fullName)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full flex-1">
      {/* Sidebar completa — só a partir de 1100px. */}
      <aside className="hidden w-64 shrink-0 border-r min-[1100px]:block">
        {sidebarInner()}
      </aside>

      {/* Entre 768px e 1100px a sidebar vira um trilho estreito só com ícones;
          passar o mouse expande por cima do conteúdo (overlay) e mostra a
          sidebar completa, sem empurrar a página. Reserva a largura do trilho
          no fluxo e sobrepõe o resto. */}
      <aside className="relative hidden w-14 shrink-0 md:max-[1099px]:block">
        <div
          onMouseEnter={() => setRailHover(true)}
          onMouseLeave={() => setRailHover(false)}
          className={cn(
            "absolute inset-y-0 left-0 z-30 overflow-hidden border-r bg-white transition-[width] duration-200",
            railHover ? "w-64 shadow-xl" : "w-14"
          )}
        >
          {railHover ? <div className="h-full w-64">{sidebarInner()}</div> : sidebarRail()}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* Top bar — só abaixo de 768px (celular). */}
        <header className="flex h-14 items-center gap-2 border-b bg-white px-4 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {sidebarInner(() => setMobileOpen(false))}
            </SheetContent>
          </Sheet>
          <SotwiseLogo />
        </header>

        {/* pb generoso: o balão de mensagens é fixo no canto inferior direito e
            cobria a última linha (ex.: abrir o Pre-Loading). */}
        <main className="flex-1 overflow-y-auto p-4 pb-28 md:p-8 md:pb-28">{children}</main>
      </div>

      {/* Balão de mensagens — em todas as telas do sistema. */}
      <MessageFab initialUnread={unreadMessages} />
    </div>
  );
}
