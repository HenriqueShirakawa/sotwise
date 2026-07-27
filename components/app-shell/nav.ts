import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  PackageOpen,
  Ship,
  Factory,
  ListTodo,
  Building2,
  Users,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

/** Navegação principal. `adminOnly` esconde o item para o papel `user`
 * (checagem cosmética — a autorização real é imposta no servidor). */
export const NAV: NavGroup[] = [
  {
    title: "Operations",
    items: [
      { title: "Orders", href: "/orders", icon: ClipboardList },
      { title: "Pre-loading", href: "/pre-loading", icon: PackageOpen },
      { title: "Shipments", href: "/shipments", icon: Ship },
      { title: "ETD Factories", href: "/etd-factories", icon: Factory },
      { title: "To do list", href: "/todo", icon: ListTodo },
    ],
  },
  {
    title: "Registration",
    items: [
      { title: "Factories", href: "/registration/factories", icon: Factory },
      { title: "Clients", href: "/registration/clients", icon: Building2 },
    ],
  },
  {
    title: "Administration",
    items: [{ title: "Users", href: "/users", icon: Users, adminOnly: true }],
  },
];
