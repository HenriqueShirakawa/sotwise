import "server-only";

import { z } from "zod";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  agentSchema,
  businessUnitSchema,
  categorySchema,
  citySchema,
  clientSchema,
  contactSchema,
  exporterSchema,
  nameSchema,
  orderTypeSchema,
} from "@/domain/registration/schema";

/**
 * Registry dos recursos da API REST. As CHAVES são a allowlist — o nome da
 * tabela nunca vem cru do client (mesma filosofia de
 * domain/registration/simple-crud.ts). Cada recurso descreve as colunas do GET,
 * o schema Zod do POST, como montar a linha a inserir e um hook pós-insert
 * opcional (junções M-N). Leitura/escrita segue o padrão do app:
 * `createAdminClient()` + soft-delete (`deleted_at`).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Tabelas expostas — união usada para tipar `admin.from(...)`. */
export type ResourceTable =
  | "agents"
  | "contacts"
  | "business_units"
  | "carriers"
  | "categories"
  | "factories"
  | "cities"
  | "pols"
  | "pods"
  | "clients"
  | "countries"
  | "exporters"
  | "order_types"
  | "shipment_models";

export type ResourceSession = { userId: string };

export interface ResourceConfig<I = unknown> {
  table: ResourceTable;
  /** Colunas retornadas no GET. */
  select: string;
  /** Validação do corpo do POST. */
  schema: z.ZodType<I>;
  /** Monta a linha a inserir (adiciona `created_by` nas tabelas que têm). */
  buildRow: (input: I, session: ResourceSession) => Record<string, unknown>;
  /** Pós-insert opcional (ex.: sincronizar junção M-N). Retorna erro ou null. */
  afterInsert?: (id: string, input: I, admin: AdminClient) => Promise<string | null>;
}

/** Preserva a inferência de `I` por recurso, apagando-a no Record final. */
function defineResource<I>(cfg: ResourceConfig<I>): ResourceConfig {
  return cfg as ResourceConfig;
}

/** Objeto name-only — carriers/factories/pols/pods/countries/shipment_models. */
const nameOnlySchema = z.object({ name: nameSchema });

/** E-mail vira null quando marcado "N/A" (mesma regra das actions de agents/contacts). */
function emailValue(input: { email: string | null; email_na: boolean }): string | null {
  return input.email_na ? null : input.email;
}

/** Regrava a junção `agent_contacts` (apaga e insere — lista pequena). */
async function syncAgentContacts(
  admin: AdminClient,
  agentId: string,
  contactIds: string[]
): Promise<string | null> {
  const { error: delError } = await admin
    .from("agent_contacts")
    .delete()
    .eq("agent_id", agentId);
  if (delError) return delError.message;

  if (contactIds.length === 0) return null;

  const { error } = await admin
    .from("agent_contacts")
    .insert(contactIds.map((contact_id) => ({ agent_id: agentId, contact_id })));
  return error?.message ?? null;
}

export const RESOURCES: Record<string, ResourceConfig> = {
  agents: defineResource({
    table: "agents",
    select: "id, name, country_id, location, email, email_na, phone_number",
    schema: agentSchema,
    buildRow: (input, session) => ({
      name: input.name,
      country_id: input.country_id,
      location: input.location,
      email: emailValue(input),
      email_na: input.email_na,
      phone_number: input.phone_number,
      created_by: session.userId,
    }),
    afterInsert: (id, input, admin) => syncAgentContacts(admin, id, input.contact_ids),
  }),

  contacts: defineResource({
    table: "contacts",
    select: "id, name, email, email_na, phone_number",
    schema: contactSchema,
    buildRow: (input, session) => ({
      name: input.name,
      email: emailValue(input),
      email_na: input.email_na,
      phone_number: input.phone_number,
      created_by: session.userId,
    }),
  }),

  "business-units": defineResource({
    table: "business_units",
    select: "id, name, icon_path",
    schema: businessUnitSchema,
    // icon_path é nullable (migração de reconcile) — via JSON criamos só o nome.
    buildRow: (input, session) => ({ name: input.name, created_by: session.userId }),
  }),

  carriers: defineResource({
    table: "carriers",
    select: "id, name",
    schema: nameOnlySchema,
    buildRow: (input, session) => ({ name: input.name, created_by: session.userId }),
  }),

  categories: defineResource({
    table: "categories",
    select: "id, name",
    schema: categorySchema,
    buildRow: (input, session) => ({ name: input.name, created_by: session.userId }),
  }),

  factories: defineResource({
    table: "factories",
    select: "id, name",
    schema: nameOnlySchema,
    buildRow: (input, session) => ({ name: input.name, created_by: session.userId }),
  }),

  cities: defineResource({
    table: "cities",
    select: "id, name",
    schema: citySchema,
    buildRow: (input) => ({ name: input.name }),
  }),

  pols: defineResource({
    table: "pols",
    select: "id, name",
    schema: nameOnlySchema,
    buildRow: (input) => ({ name: input.name }),
  }),

  pods: defineResource({
    table: "pods",
    select: "id, name",
    schema: nameOnlySchema,
    buildRow: (input) => ({ name: input.name }),
  }),

  clients: defineResource({
    table: "clients",
    select: "id, name, country_id",
    schema: clientSchema,
    buildRow: (input, session) => ({
      name: input.name,
      country_id: input.country_id,
      created_by: session.userId,
    }),
  }),

  countries: defineResource({
    table: "countries",
    select: "id, name",
    schema: nameOnlySchema,
    buildRow: (input) => ({ name: input.name }),
  }),

  exporters: defineResource({
    table: "exporters",
    select: "id, name, acronym",
    schema: exporterSchema,
    buildRow: (input, session) => ({
      name: input.name,
      acronym: input.acronym,
      created_by: session.userId,
    }),
  }),

  "order-types": defineResource({
    table: "order_types",
    select: "id, name, color, icon_path",
    schema: orderTypeSchema,
    // color/icon_path são nullable — só inclui se vierem no corpo.
    buildRow: (input, session) => {
      const row: Record<string, unknown> = { name: input.name, created_by: session.userId };
      if (input.color !== undefined) row.color = input.color;
      if (input.icon_path !== undefined) row.icon_path = input.icon_path;
      return row;
    },
  }),

  "shipment-models": defineResource({
    table: "shipment_models",
    select: "id, name",
    schema: nameOnlySchema,
    buildRow: (input, session) => ({ name: input.name, created_by: session.userId }),
  }),
};
