import type { LucideIcon } from "lucide-react";
import {
  Package,
  Factory,
  PackageOpen,
  Ship,
  ListTodo,
  Layers,
  Users,
  ShieldCheck,
} from "lucide-react";

import type { FeatureKey } from "@/domain/access/features";

export type NavLink = {
  type: "link";
  title: string;
  href: string;
  icon: LucideIcon;
  feature: FeatureKey;
};

export type NavGroup = {
  type: "group";
  title: string;
  icon: LucideIcon;
  feature: FeatureKey;
  children: { title: string; href: string }[];
};

export type NavItem = NavLink | NavGroup;

/**
 * Menu principal — flat, no estilo Bubble. Cada item declara a `feature` que o
 * governa; a sidebar esconde o que a sessão não pode ver. Continua sendo
 * cosmético — a autorização real é a `requireFeature` de cada page/action —,
 * mas agora as duas leem a mesma fonte, então o menu não mente.
 */
export const NAV: NavItem[] = [
  { type: "link", title: "Orders", href: "/orders", icon: Package, feature: "orders" },
  {
    type: "link",
    title: "ETD factories",
    href: "/etd-factories",
    icon: Factory,
    feature: "etd_factories",
  },
  {
    type: "link",
    title: "Pre-Loading",
    href: "/pre-loading",
    icon: PackageOpen,
    feature: "pre_loading",
  },
  { type: "link", title: "Shipments", href: "/shipments", icon: Ship, feature: "shipments" },
  { type: "link", title: "To do list", href: "/todo", icon: ListTodo, feature: "todo" },
  {
    type: "group",
    title: "Registration",
    icon: Layers,
    feature: "registration",
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
  { type: "link", title: "Users", href: "/users", icon: Users, feature: "users" },
  { type: "link", title: "Access", href: "/access", icon: ShieldCheck, feature: "access" },
];
