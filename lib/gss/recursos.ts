import { GSS_ENDPOINTS } from "./client";

/**
 * Os recursos que o painel/snapshot sabem listar: o endpoint do GSS, a tabela
 * nossa que ele alimenta e quais campos mostrar. Espelha o escopo de
 * `lib/gss/sync.ts` — quando um recurso entrar lá, entra aqui.
 *
 * Vive em `lib/gss/` (imports relativos) para ser compartilhado por dois
 * consumidores: o painel `app/(dashboard)/access/gss/page.tsx` (via alias `@/`)
 * e o gerador de snapshot `scripts/sync-gss/snapshot.ts` (via caminho relativo,
 * porque o `tsx` não resolve o alias `@/`).
 *
 * `shipment_models` não aparece: não existe endpoint no GSS (INTEGRACAO_GSS §9.8).
 */
export type Recurso = {
  key: string;
  label: string;
  endpoint: string;
  /** Tabela local que este recurso alimenta. */
  table:
    | "countries" | "cities" | "pols" | "pods" | "clients" | "exporters"
    | "order_types" | "business_units" | "factories" | "categories"
    | "agents" | "carriers" | "contacts";
  /** Campo do GSS que carrega o nome (`supplier` usa `company_name`). */
  campoNome: string;
  /** Segundo campo exibido, quando ajuda a identificar o registro. */
  campoDetalhe?: string;
  detalheLabel?: string;
};

export const RECURSOS = [
  { key: "city", label: "Cities", endpoint: GSS_ENDPOINTS.city, table: "cities", campoNome: "name", campoDetalhe: "province_name", detalheLabel: "Província" },
  { key: "country", label: "Countries", endpoint: GSS_ENDPOINTS.country, table: "countries", campoNome: "name", campoDetalhe: "iso_code", detalheLabel: "ISO" },
  { key: "port", label: "Ports", endpoint: GSS_ENDPOINTS.port, table: "pods", campoNome: "name", campoDetalhe: "country_name", detalheLabel: "País" },
  { key: "supplier", label: "Suppliers → factories", endpoint: GSS_ENDPOINTS.supplier, table: "factories", campoNome: "company_name" },
  { key: "customer", label: "Customers → clients", endpoint: GSS_ENDPOINTS.customer, table: "clients", campoNome: "name", campoDetalhe: "country_name", detalheLabel: "País" },
  { key: "agent", label: "Agents", endpoint: GSS_ENDPOINTS.agent, table: "agents", campoNome: "name", campoDetalhe: "email", detalheLabel: "E-mail" },
  { key: "carrier", label: "Carriers", endpoint: GSS_ENDPOINTS.carrier, table: "carriers", campoNome: "name", campoDetalhe: "email", detalheLabel: "E-mail" },
  { key: "exporter", label: "Exporters", endpoint: GSS_ENDPOINTS.exporter, table: "exporters", campoNome: "name", campoDetalhe: "code", detalheLabel: "Código" },
  { key: "orderType", label: "Order types", endpoint: GSS_ENDPOINTS.orderType, table: "order_types", campoNome: "name" },
  { key: "businessUnit", label: "Business units", endpoint: GSS_ENDPOINTS.businessUnit, table: "business_units", campoNome: "name" },
  { key: "company", label: "Companies", endpoint: GSS_ENDPOINTS.company, table: "contacts", campoNome: "name", campoDetalhe: "email", detalheLabel: "E-mail" },
] as const satisfies readonly Recurso[];

export type RecursoKey = (typeof RECURSOS)[number]["key"];
