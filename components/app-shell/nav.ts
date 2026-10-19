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
  Mail,
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
  /** `exact`: só fica ativo na URL exata — para pai de outra rota do grupo
   *  (/access vs /access/gss) não acender junto com o filho. */
  children: { title: string; href: string; exact?: boolean }[];
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
  { type: "link", title: "Emails", href: "/emails", icon: Mail, feature: "email_history" },
  {
    type: "group",
    title: "Registration",
    icon: Layers,
    feature: "registration",
    // Ordem alfabética. O `sort` fica aqui, e não só na ordem do literal, para
    // a lista não voltar a desandar quando entrar cadastro novo — 11 itens sem
    // ordem previsível viram caça ao tesouro.
    children: [
      { title: "Agents", href: "/registration/agents" },
      { title: "Business Unit", href: "/registration/business-units" },
      { title: "Carriers", href: "/registration/carriers" },
      { title: "Categories", href: "/registration/categories" },
      { title: "Cities", href: "/registration/cities" },
      { title: "Clients", href: "/registration/clients" },
      { title: "Contacts", href: "/registration/contacts" },
      { title: "Countries", href: "/registration/countries" },
      { title: "Country Languages", href: "/registration/country-languages" },
      { title: "Exporters", href: "/registration/exporters" },
      { title: "Factories", href: "/registration/factories" },
      { title: "Order Type", href: "/registration/order-types" },
      { title: "POD", href: "/registration/pods" },
      { title: "POL", href: "/registration/pols" },
      { title: "Shipment Models", href: "/registration/shipment-models" },
    ].sort((a, b) => a.title.localeCompare(b.title)),
  },
  { type: "link", title: "Users", href: "/users", icon: Users, feature: "users" },
  {
    type: "group",
    title: "Access",
    icon: ShieldCheck,
    feature: "access",
    // Owner-only (feature `access`). Permissões, e as duas ferramentas da
    // integração com o GSS: paridade dos cadastros e o log de chamadas.
    children: [
      { title: "Permissions", href: "/access", exact: true },
      { title: "GSS parity", href: "/access/gss", exact: true },
      { title: "GSS calls", href: "/access/gss/calls" },
    ],
  },
];
