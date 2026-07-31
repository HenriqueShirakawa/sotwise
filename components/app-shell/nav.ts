import type { LucideIcon } from "lucide-react";
import {
  Package,
  Factory,
  PackageOpen,
  Ship,
  ListTodo,
  Layers,
  Users,
} from "lucide-react";

export type NavLink = {
  type: "link";
  title: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export type NavGroup = {
  type: "group";
  title: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  children: { title: string; href: string }[];
};

export type NavItem = NavLink | NavGroup;

/** Menu principal — flat, no estilo Bubble. `adminOnly` esconde para `user`
 * (cosmético; a autorização real é no servidor). */
export const NAV: NavItem[] = [
  { type: "link", title: "Orders", href: "/orders", icon: Package },
  { type: "link", title: "ETD factories", href: "/etd-factories", icon: Factory },
  { type: "link", title: "Pre-Loading", href: "/pre-loading", icon: PackageOpen },
  { type: "link", title: "Shipments", href: "/shipments", icon: Ship },
  { type: "link", title: "To do list", href: "/todo", icon: ListTodo },
  {
    type: "group",
    title: "Registration",
    icon: Layers,
    children: [
      { title: "Agents", href: "/registration/agents" },
      { title: "Contacts", href: "/registration/contacts" },
      { title: "Business Unit", href: "/registration/business-units" },
      { title: "Carriers", href: "/registration/carriers" },
      { title: "Factories", href: "/registration/factories" },
      { title: "Clients", href: "/registration/clients" },
      { title: "POL", href: "/registration/pols" },
      { title: "POD", href: "/registration/pods" },
      { title: "Countries", href: "/registration/countries" },
      { title: "Order Type", href: "/registration/order-types" },
      { title: "Shipment Models", href: "/registration/shipment-models" },
    ],
  },
  { type: "link", title: "Users", href: "/users", icon: Users, adminOnly: true },
];
