"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { SotwiseLogo } from "@/components/brand/sotwise-logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";
import { UserCard } from "./user-menu";

export function AppShell({
  fullName,
  email,
  role,
  isAdmin,
  children,
}: {
  fullName: string;
  email: string | null;
  role: string;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarInner = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[105px] shrink-0 items-center justify-center px-6">
        <SotwiseLogo className="h-16" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <SidebarNav isAdmin={isAdmin} onNavigate={onNavigate} />
      </div>
      <div className="border-t p-3">
        <UserCard fullName={fullName} email={email} role={role} />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-full flex-1">
      {/* Sidebar — desktop */}
      <aside className="hidden w-64 shrink-0 border-r md:block">
        {sidebarInner()}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {/* Top bar — só mobile */}
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

        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
