"use client";

import { LogOut, ChevronDown } from "lucide-react";

import { signOut } from "@/lib/auth/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

/**
 * Menu de conta do portal. Gêmeo enxuto do `UserCard` da sidebar interna, e
 * separado dele de propósito: aquele leva a `/profile`, que é tela interna e
 * agora recusa usuário externo — o link apareceria só para dar erro.
 */
export function ClientUserMenu({
  fullName,
  email,
}: {
  fullName: string;
  email: string | null;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-slate-100"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-violet-100 text-xs font-semibold text-violet-700">
              {initials(fullName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm font-medium text-slate-700 sm:block">
            {fullName}
          </span>
          <ChevronDown className="size-4 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{fullName}</p>
          {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild variant="destructive">
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="size-4" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
