/**
 * Parte do contrato OpenAPI (domain/api/openapi.ts) com os endpoints de
 * integração que NÃO são lotes: Orders, Pre-loadings, ETD Factories e
 * Bibliotecas (cadastros). Espelha o código — não a doc:
 *
 *   Orders        app/api/orders/route.ts + domain/orders/gss-{schema,read}.ts
 *   Pre-loadings  app/api/pre-loadings/route.ts + domain/pre-loadings/gss-read.ts
 *   ETD Factories app/api/etd-factories/route.ts + domain/etd-factories/gss-read.ts
 *   Bibliotecas   app/api/[resource]/** + domain/api/registry.ts + domain/registration/schema.ts
 *
 * ⚠️ Escrito à mão: mudou campo/limite/status lá, muda aqui.
 * Rotas internas (copilot, cron, webhook do Resend, dispatch de notificação)
 * ficam de fora de propósito — não são para integrador.
 */

import { dayToUnix, timestampToUnix } from "@/lib/api-dates";

export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** Exemplos escritos como data legível e convertidos para o Unix da resposta. */
export const du = (day: string) => dayToUnix(day);
const ts = (iso: string) => timestampToUnix(iso);

export const err = (description: string, example: string) => ({
  description,
  content: { "application/json": { schema: ref("Error"), example: { error: example } } },
});

export const R401 = err("Missing or invalid token.", "Invalid token");
export const R403 = err("The token has no access to this resource.", "Forbidden");
export const R500 = err("Unexpected error on the SOTWISE side — report it with the message.", "<internal message>");
export const R400Query = err("Invalid query parameter (`issues` points to the field).", "Invalid 'limit': Too big: expected number to be <=200");

export const listEnvelope = (item: string) => ({
  type: "object",
  required: ["data", "pagination"],
  properties: { data: { type: "array", items: ref(item) }, pagination: ref("Pagination") },
});

export const json = (schema: unknown, example?: unknown) => ({
  "application/json": example === undefined ? { schema } : { schema, example },
});

export const limitParam = (max: number, def: number) => ({
  name: "limit",
  in: "query",
  schema: { type: "integer", minimum: 1, maximum: max, default: def },
  description: "Page size.",
});
export const offsetParam = { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } };
export const orderParam = (by: string) => ({
  name: "order",
  in: "query",
  schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
  description: `Sort by \`${by}\`. Use \`asc\` to sweep chronologically.`,
});

/** `orders.status` (domain/orders/gss-read.ts). */
const ORDER_STATUSES = [
  "in_negotiation",
  "in_production",
  "partially_preloading",
  "pre_loading",
  "partially_shipped",
  "shipped",
  "partially_delivered",
  "delivered",
  "canceled",
];

/** Etapas da fase Order, na ordem das telas (lib/checklist.ts ORDER_STEPS). */
const ORDER_STEPS = [
  "order",
  "po",
  "pi",
  "deposit_payment",
  "packing_confirm",
  "condition_confirm",
  "place_the_order",
  "etd",
  "balance_payment",
  "pre_loading",
];

export const BATCH_STATUSES = ["in_negotiation", "in_production", "preloading", "in_transit", "delivered", "canceled"];

/** SAÍDA — dia em Unix (s) às 12:00 UTC (lib/api-dates.ts). */
export const date = { type: "number", description: "Unix seconds (12:00 UTC of the day)." };
export const nullableDate = { type: ["number", "null"], description: "Unix seconds (12:00 UTC of the day)." };
/** SAÍDA — momento em Unix (s), com fração. */
export const instant = { type: ["number", "null"], description: "Unix seconds (fractional)." };
/** ENTRADA — dia: Unix (s) ou, legado, "YYYY-MM-DD". */
export const inDay = {
  oneOf: [
    { type: "number", description: "Unix seconds — the UTC calendar day is used (send 12:00 UTC to be safe)." },
    { type: "string", format: "date", description: "Legacy: YYYY-MM-DD." },
  ],
};
export const inDayNullable = { oneOf: [...inDay.oneOf, { type: "null" }] };
/**
 * ENTRADA — campos de checklist da order (20/10/2026, lib/checklist-revisions):
 * mesmos no POST (upsert) e no PATCH.
 */
export const orderChecklistFieldsIn = {
  order_received_date: {
    ...inDay,
    description:
      "Order step: date the client's final order was received. The first one completes the step; later changes are kept as revisions (the original is never lost). Not nullable.",
  },
  pi_status: {
    type: "string",
    maxLength: 200,
    description:
      "PI step: PI status in GSS, free text (e.g. issued, revised). The first one completes the step; each later status/date is kept as a revision. Same status + date again → no-op.",
  },
  pi_status_date: {
    ...inDay,
    description: "Date of `pi_status` (default: today). Requires `pi_status`.",
  },
  revision_reason: {
    type: "string",
    maxLength: 500,
    description: "Reason stored with a revision of the fields above. Default: \"Updated by GSS\".",
  },
};
export const updatedSinceParam = {
  name: "updated_since",
  in: "query",
  schema: { oneOf: [{ type: "number" }, { type: "string", format: "date-time" }] },
  description: "Unix seconds (e.g. `1790812800`); ISO 8601 with offset is still accepted (legacy).",
};
export const uuid = { type: "string", format: "uuid" };

/*
 * `is_active` (2026-10-13) — comum a TODOS os recursos da API. É só uma marca:
 * inativo continua aparecendo (telas e API); exclusão é outra coisa
 * (`deleted_at` das bibliotecas / DELETE dos operacionais).
 */
const IS_ACTIVE_NOTE = "Flag only — an inactive record still appears in SOTWISE and in this API; deletion is separate.";
/** SAÍDA — todo objeto de topo (e as linhas Factory × Category embutidas). */
export const isActiveOut = { type: "boolean", description: `Active flag (\`true\` by default). ${IS_ACTIVE_NOTE}` };
/** ENTRADA — opcional em todo POST/PATCH. */
export const isActiveIn = {
  type: "boolean",
  description: `Optional. Omitted → unchanged (new records start \`true\`). ${IS_ACTIVE_NOTE}`,
};
/** Filtro das listas: sem o parâmetro vêm ativos E inativos. */
export const isActiveParam = {
  name: "is_active",
  in: "query",
  schema: { type: "boolean" },
  description: "Filter by the `is_active` flag (`true` / `false`). Omitted → no filter (active and inactive both come).",
};

/* -------------------------------------------------------------------------- */
/* Bibliotecas (cadastros) — uma entrada por recurso de domain/api/registry.ts */
/* -------------------------------------------------------------------------- */

const name = { type: "string", minLength: 1, maxLength: 200 };
const phone = { type: "string", minLength: 1, maxLength: 50 };
const email = { type: ["string", "null"], format: "email", maxLength: 200 };

type Lib = {
  key: string;
  label: string;
  /** Colunas do GET (o `select` do registry). */
  out: Record<string, unknown>;
  create: Record<string, unknown>;
  required: string[];
  update: Record<string, unknown>;
  note?: string;
  example: Record<string, unknown>;
};

const NAME_ONLY = (key: string, label: string, extraOut: Record<string, unknown> = {}): Lib => ({
  key,
  label,
  out: { id: uuid, name: { type: "string" }, ...extraOut },
  create: { name },
  required: ["name"],
  update: { name },
  example: { name: "Shanghai" },
});

/**
 * Geografia (Countries/Cities) é ESPELHO do GSS — ele é o dono do cadastro e
 * estas duas bibliotecas são o reflexo do `/core/country/` e `/core/city/` dele.
 */
const GEO_MIRROR_NOTE =
  "Mirror of the GSS registry: these records are pulled from GSS and refreshed by the scheduled sync. Writing here is possible, but the next sync restores the GSS value.";

const GEO_TEXT_NOTE =
  "Plain text, not a foreign key — the GSS province/country tables are not replicated here.";

const EMAIL_NOTE =
  "E-mail rule: send `email` filled **or** `email_na: true` (then `email` is stored as null). On PATCH the rule applies only when one of the two is sent.";

const LIBS: Lib[] = [
  {
    key: "agents",
    label: "Agents",
    out: {
      id: uuid,
      name: { type: "string" },
      country_id: { type: ["string", "null"], format: "uuid" },
      location: { type: "string", enum: ["brazil", "china"] },
      email: { type: ["string", "null"] },
      email_na: { type: "boolean" },
      phone_number: { type: "string" },
    },
    create: {
      name,
      country_id: { ...uuid, description: "Id from `GET /api/countries`." },
      location: { type: "string", enum: ["brazil", "china"] },
      email,
      email_na: { type: "boolean" },
      phone_number: phone,
      contact_ids: { type: "array", items: uuid, description: "Ids from `GET /api/contacts`. Validate them first: an unknown id fails with 500 after the agent was created." },
    },
    required: ["name", "country_id", "location", "email", "email_na", "phone_number", "contact_ids"],
    update: {
      name,
      country_id: uuid,
      location: { type: "string", enum: ["brazil", "china"] },
      email,
      email_na: { type: "boolean" },
      phone_number: phone,
      contact_ids: { type: "array", items: uuid, description: "Sent (even `[]`) → replaces the links; omitted → untouched." },
    },
    note: EMAIL_NOTE,
    example: {
      name: "Atlas Freight",
      country_id: "8e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a45",
      location: "china",
      email: "ops@atlas.cn",
      email_na: false,
      phone_number: "+86 21 5555 0000",
      contact_ids: [],
    },
  },
  {
    key: "contacts",
    label: "Contacts",
    out: {
      id: uuid,
      name: { type: "string" },
      email: { type: ["string", "null"] },
      email_na: { type: "boolean" },
      phone_number: { type: "string" },
    },
    create: { name, email, email_na: { type: "boolean" }, phone_number: phone },
    required: ["name", "email", "email_na", "phone_number"],
    update: { name, email, email_na: { type: "boolean" }, phone_number: phone },
    note: EMAIL_NOTE,
    example: { name: "Chen", email: "chen@zenchum.com", email_na: false, phone_number: "+86 138 0000 0000" },
  },
  NAME_ONLY("business-units", "Business Units", { icon_path: { type: ["string", "null"] } }),
  NAME_ONLY("carriers", "Carriers"),
  {
    key: "categories",
    label: "Categories",
    out: { id: uuid, name: { type: "string" } },
    create: {
      name,
      factory_ids: { type: "array", items: uuid, description: "Optional Factory × Category links (ids from `GET /api/factories`)." },
    },
    required: ["name"],
    update: {
      name,
      factory_ids: { type: "array", items: uuid, description: "Sent (even `[]`) → replaces the links; omitted → untouched." },
    },
    example: { name: "Brake Pads", factory_ids: [] },
  },
  NAME_ONLY("factories", "Factories"),
  {
    key: "cities",
    label: "Cities",
    out: {
      id: uuid,
      name: { type: "string" },
      province: { type: ["string", "null"] },
      country: { type: ["string", "null"] },
    },
    create: {
      name,
      province: { type: ["string", "null"], maxLength: 200, description: GEO_TEXT_NOTE },
      country: { type: ["string", "null"], maxLength: 200, description: GEO_TEXT_NOTE },
    },
    required: ["name"],
    update: {
      name,
      province: { type: ["string", "null"], maxLength: 200 },
      country: { type: ["string", "null"], maxLength: 200 },
    },
    note: GEO_MIRROR_NOTE,
    example: { name: "Ningbo", province: "Zhejiang", country: "China" },
  },
  NAME_ONLY("pols", "POLs"),
  NAME_ONLY("pods", "PODs"),
  {
    key: "clients",
    label: "Clients",
    out: { id: uuid, name: { type: "string" }, country_id: { type: ["string", "null"], format: "uuid" } },
    create: { name, country_id: { ...uuid, description: "Id from `GET /api/countries`." } },
    required: ["name", "country_id"],
    update: { name, country_id: uuid },
    example: { name: "Amacom", country_id: "8e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a45" },
  },
  {
    key: "countries",
    label: "Countries",
    out: { id: uuid, name: { type: "string" }, iso_code: { type: ["string", "null"] } },
    create: { name, iso_code: { type: ["string", "null"], minLength: 2, maxLength: 10, description: "ISO 3166-1 alpha-3 (BRA, CHN)." } },
    required: ["name"],
    update: { name, iso_code: { type: ["string", "null"], minLength: 2, maxLength: 10 } },
    note: GEO_MIRROR_NOTE,
    example: { name: "China", iso_code: "CHN" },
  },
  {
    key: "exporters",
    label: "Exporters",
    out: { id: uuid, name: { type: "string" }, acronym: { type: ["string", "null"] } },
    create: { name, acronym: { type: "string", minLength: 1, maxLength: 50 } },
    required: ["name", "acronym"],
    update: { name, acronym: { type: "string", minLength: 1, maxLength: 50 } },
    example: { name: "AGK Solution", acronym: "AGK" },
  },
  {
    key: "order-types",
    label: "Order Types",
    out: {
      id: uuid,
      name: { type: "string" },
      color: { type: "string", description: "Always set — `#640BB7` (SOTWISE purple) when none was sent." },
      icon_path: { type: ["string", "null"] },
    },
    create: {
      name,
      color: { type: "string", maxLength: 50, description: "Optional. Hex, e.g. `#640BB7`. Defaults to `#640BB7` (SOTWISE purple) when omitted." },
      icon_path: { type: "string", maxLength: 500 },
    },
    required: ["name"],
    update: { name, color: { type: "string", maxLength: 50 }, icon_path: { type: "string", maxLength: 500 } },
    example: { name: "Sales", color: "#640BB7" },
  },
  NAME_ONLY("shipment-models", "Shipment Models"),
];

const schemaName = (lib: Lib, suffix: string) =>
  lib.label.replace(/[^A-Za-z]/g, "") + suffix;

const LIB_400 = err(
  "Invalid body (`issues` lists every problem), a reference id that does not exist (e.g. `country_id`), or a PATCH with no field to update.",
  "Name is required."
);
const LIB_404 = err("`{id}` not found or already deleted.", "Record not found.");

function libPaths() {
  const paths: Record<string, unknown> = {};
  for (const lib of LIBS) {
    const tag = "Libraries";
    const item = schemaName(lib, "");
    paths[`/api/${lib.key}`] = {
      get: {
        tags: [tag],
        operationId: `list_${lib.key}`,
        summary: `List ${lib.label}`,
        description:
          "Deleted records never appear; inactive ones (`is_active: false`) do, unless filtered with `is_active`. Sorted by `name`. No `pagination` block — page with `limit`/`offset`.",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Case-insensitive partial match on `name`." },
          { name: "gss_id", in: "query", schema: { type: "string" }, description: "Exact match on the GSS id." },
          isActiveParam,
          limitParam(1000, 1000),
          offsetParam,
        ],
        responses: {
          200: {
            description: "Records.",
            content: json({
              type: "object",
              required: ["data"],
              properties: { data: { type: "array", items: ref(item) } },
            }),
          },
          400: LIB_400,
          401: R401,
          403: R403,
          500: R500,
        },
      },
      post: {
        tags: [tag],
        operationId: `create_${lib.key}`,
        summary: `Create ${lib.label.replace(/s$/, "")}`,
        description: [
          lib.note,
          "Send `gss_id` to link the record to the GSS. With `gss_id` the call is idempotent: if a record " +
            "with that `gss_id` already exists it is UPDATED with the body (200) instead of duplicated.",
          "Unknown fields are silently dropped.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        requestBody: { required: true, content: json(ref(schemaName(lib, "Create")), lib.example) },
        responses: {
          200: {
            description: "Updated — a record with this `gss_id` already existed.",
            content: json({ type: "object", required: ["data"], properties: { data: ref(item) } }),
          },
          201: {
            description: "Created — the record with its new `id`.",
            content: json({ type: "object", required: ["data"], properties: { data: ref(item) } }),
          },
          400: LIB_400,
          401: R401,
          403: R403,
          409: err("`gss_id` belongs to a deleted record.", "gss_id '118' belongs to a deleted record."),
          500: R500,
        },
      },
    };
    paths[`/api/${lib.key}/{id}`] = {
      parameters: [{ name: "id", in: "path", required: true, schema: uuid }],
      patch: {
        tags: [tag],
        operationId: `update_${lib.key}`,
        summary: `Update ${lib.label.replace(/s$/, "")}`,
        description: [
          'Partial: only the fields sent change. `{ "gss_id": "118" }` alone links the record to the GSS.',
          lib.note,
        ]
          .filter(Boolean)
          .join("\n\n"),
        requestBody: { required: true, content: json(ref(schemaName(lib, "Update"))) },
        responses: {
          200: {
            description: "Updated record.",
            content: json({ type: "object", required: ["data"], properties: { data: ref(item) } }),
          },
          400: LIB_400,
          401: R401,
          403: R403,
          404: LIB_404,
          409: err("`gss_id` already used by another record.", "gss_id '118' is already used by another record."),
          500: R500,
        },
      },
    };
  }
  return paths;
}

/** `gss_id` é comum a todas as bibliotecas (tratado no handler, não no schema). */
const LIB_GSS_ID_OUT = {
  type: ["string", "null"],
  description: "Id of the record in the GSS (null = not linked to the GSS yet).",
};
const LIB_GSS_ID_IN = {
  type: ["string", "integer", "null"],
  description:
    "Id of the record in the GSS (stored as text; unique per library). On POST it makes the call " +
    "idempotent: an existing `gss_id` updates that record instead of creating a duplicate. On PATCH it can " +
    "be sent alone to link the record; `null` unlinks it.",
};

function libSchemas() {
  const schemas: Record<string, unknown> = {};
  // `is_active` entra aqui, uma vez, em todas as bibliotecas.
  for (const lib of LIBS) {
    schemas[schemaName(lib, "")] = {
      type: "object",
      properties: { ...lib.out, gss_id: LIB_GSS_ID_OUT, is_active: isActiveOut },
    };
    schemas[schemaName(lib, "Create")] = {
      type: "object",
      required: lib.required,
      properties: { ...lib.create, gss_id: LIB_GSS_ID_IN, is_active: isActiveIn },
    };
    schemas[schemaName(lib, "Update")] = {
      type: "object",
      minProperties: 1,
      description: "Any subset of the fields — `{ \"is_active\": false }` or `{ \"gss_id\": \"118\" }` alone is valid.",
      properties: { ...lib.update, gss_id: LIB_GSS_ID_IN, is_active: isActiveIn },
    };
  }
  return schemas;
}

/* -------------------------------------------------------------------------- */
/* Orders, Pre-loadings, ETD Factories                                         */
/* -------------------------------------------------------------------------- */

const exampleOrder = {
  id: "0f63d999-6a51-4a8e-9a77-2b1c3d4e5f60",
  gss_id: "1601",
  po_number: "1601",
  status: "partially_shipped",
  asap: false,
  schedule_requested: du("2026-08-28"),
  client_reference: "Tester 28/08",
  date_po: du("2026-08-28"),
  order_type: { id: "1364838b-0000-4000-8000-000000000001", name: "Sales", gss_id: "1" },
  client: { id: "1468aa94-4987-442d-acc4-f2ae59f92d06", name: "AGK", gss_id: "1" },
  business_unit: { id: "8ed55e47-0000-4000-8000-000000000002", name: "Other", gss_id: "6" },
  exporter: { id: "2770eb04-0000-4000-8000-000000000003", name: "AGK", gss_id: "3" },
  leader: { id: "46c4eb13-0000-4000-8000-000000000004", name: "André Mazzuchelli" },
  requester: { id: "45b0bc3e-0000-4000-8000-000000000005", name: "Amy" },
  is_active: true,
  created_at: ts("2026-08-28T20:40:41.406099+00:00"),
  updated_at: ts("2026-08-28T20:50:36.391853+00:00"),
};

export const integrationTags = [
  {
    name: "Orders",
    description: "GSS creates/updates orders (`POST`, push) and reads their state back (`GET`, pull).",
  },
  {
    name: "Pre-loadings",
    description:
      "Legacy read view of PLs (dates + batches). The full resource (create, change, Confirm Shipping, checklist steps) is **Shipments**.",
  },
  {
    name: "ETD Factories",
    description:
      "Factory × Category entries with the ETD dates. The ETD of one line is changed with `PATCH /api/etd-factories/{id}`.",
  },
  {
    name: "Libraries",
    description:
      "Reference registers (cadastros): list, create, update. No PUT/DELETE — soft delete belongs to the app. `is_active` is only a flag (it does not delete or hide).",
  },
];

export const integrationPaths = {
  "/api/orders": {
    get: {
      tags: ["Orders"],
      operationId: "listOrders",
      summary: "List orders",
      description:
        "Always a list — filter by `gss_id` to read one order (0 or 1 item, never 404). " +
        "Incremental sync: keep the highest `updated_at` seen and send it as `updated_since` with `order=asc`; page with `offset` until `returned < limit` " +
        "(sorted by `updated_at` + `id`, so nothing skips or repeats). " +
        "⚠️ `updated_at` is the order's own: a batch assigned to a line or a new line does not change it.\n\n" +
        "The read-only PO token can call this, but not with `include=checklist` (403).",
      parameters: [
        { name: "gss_id", in: "query", schema: { type: "string" }, description: "GSS order id — read one specific order." },
        { name: "po_number", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string", enum: ORDER_STATUSES } },
        isActiveParam,
        updatedSinceParam,
        orderParam("updated_at"),
        limitParam(200, 50),
        offsetParam,
        {
          name: "include",
          in: "query",
          schema: { type: "string" },
          description: "Comma-separated extra blocks: `items` (Factory × Category lines with their batch) and/or `checklist` (the 10 Order-phase steps). Each one costs extra queries.",
          example: "items,checklist",
        },
      ],
      responses: {
        200: {
          description: "Page of orders.",
          content: json(listEnvelope("Order"), {
            data: [exampleOrder],
            pagination: { limit: 50, offset: 0, returned: 1, total: 1651 },
          }),
        },
        400: R400Query,
        401: R401,
        403: R403,
        500: R500,
      },
    },
    post: {
      tags: ["Orders"],
      operationId: "upsertOrder",
      summary: "Create or update an order",
      description: [
        "**Idempotent by `gss_id`**: unknown `gss_id` → creates (201); known → updates (200). Retrying is safe.",
        "",
        "**Partial update**: on a resend only the keys sent change; omitted keys are untouched; explicit `null` clears. So the order can be created first and completed later.",
        "",
        "- `po_number` is required only to create (unique — collision → 409).",
        "- Library references by their `gss_id` (`client_gss_id`, `order_type_gss_id`, `business_unit_gss_id`, `exporter_gss_id`); unknown → 400.",
        "- Leader / Requester are SOTWISE users, matched by e-mail; unknown e-mail → 400.",
        "- `items[]` creates Factory × Category lines **without batch**. Additive: a resend only adds new (factory, category) pairs; existing ones are never recreated or overwritten.",
        "- `date_po` defaults to today, on creation only.",
        "- Checklist: `order_received_date` completes the **Order** step; `pi_status` (+ `pi_status_date`) completes the **PI** step; the first `items[]` delivery completes the **PO** step. Later changes become revisions (original kept).",
      ].join("\n"),
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: ref("OrderUpsert"),
            examples: {
              create: {
                summary: "Create (moment 1)",
                value: {
                  gss_id: "1001",
                  po_number: "1001",
                  schedule_requested: du("2026-09-15"),
                  client_reference: "REPLACEMENT",
                  client_gss_id: "9",
                  order_type_gss_id: "3",
                  business_unit_gss_id: "3",
                  exporter_gss_id: "3",
                  leader_email: "leader@example.com",
                  requester_email: "requester@example.com",
                },
              },
              items: {
                summary: "Add Factory × Category lines (moment 2)",
                value: {
                  gss_id: "1001",
                  items: [
                    { supplier_category_gss_id: "11", ship_requirement: du("2026-09-10") },
                    { supplier_category_gss_id: "593", ship_requirement: du("2026-09-20") },
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Existing order (`gss_id` known) updated.",
          content: json(ref("OrderUpsertResult"), { data: { id: exampleOrder.id, po_number: "1001", is_active: true }, created: false }),
        },
        201: {
          description: "Order created (its 10 checklist steps are seeded automatically).",
          content: json(ref("OrderUpsertResult"), { data: { id: exampleOrder.id, po_number: "1001", is_active: true }, created: true }),
        },
        400: err(
          "Invalid payload, unknown library `gss_id`, e-mail without SOTWISE user, unknown `supplier_category_gss_id` (nothing is written), or creation without `po_number`.",
          "No clients found for gss_id '9999'."
        ),
        401: R401,
        403: R403,
        409: err("`po_number` already used by another order.", "po_number '1001' is already in use."),
        500: R500,
      },
    },
  },
  "/api/pre-loadings": {
    get: {
      tags: ["Pre-loadings"],
      operationId: "listPreLoadings",
      summary: "List pre-loadings (PL)",
      description:
        "Legacy view — prefer `GET /api/shipments` (same fields + id, gss_id, status). One row per PL. Dates come from the PL checklist: *estimated* (`estimated_date`) or *actual* (`completed_on`) of each step — see each field. " +
        "Fields stay `null` until the step is filled. Deleted PLs never appear.",
      parameters: [
        { name: "pl_number", in: "query", schema: { type: "string" }, description: "Partial match on the PL number." },
        { name: "po_number", in: "query", schema: { type: "string" }, description: "Partial match: PLs that carry a batch of these orders." },
        { ...isActiveParam, description: `${isActiveParam.description} It is the PL's flag (mirrored to its shipment).` },
        orderParam("created_at"),
        limitParam(200, 50),
        offsetParam,
      ],
      responses: {
        200: {
          description: "Page of PLs.",
          content: json(listEnvelope("PreLoading"), {
            data: [
              {
                pl_number: 1306,
                estimated_loading_date: du("2026-07-08"),
                loading_date: du("2026-07-10"),
                ETD: du("2026-07-18"),
                ETA_Brazil: du("2026-09-05"),
                ATA_Brazil: du("2026-10-05"),
                DELIVERED_DATE: du("2026-09-15"),
                shipping_date: du("2026-07-19"),
                batches: [
                  { order: 1230, batch: ".02" },
                  { order: 1324, batch: ".03" },
                ],
                is_active: true,
              },
            ],
            pagination: { limit: 50, offset: 0, returned: 1, total: 1460 },
          }),
        },
        400: R400Query,
        401: R401,
        403: R403,
        500: R500,
      },
    },
  },
  "/api/etd-factories": {
    get: {
      tags: ["ETD Factories"],
      operationId: "listEtdFactories",
      summary: "List ETD Factories entries",
      description:
        "Factory × Category entries that are in a batch, with the ETD dates — the same data as the SOTWISE \"ETD Factories\" screen. " +
        "Without `batch_status` **everything** comes (the screen shows only active batches). " +
        "`lote` alone is not unique (it restarts per order) — always pair it with `po_number`.",
      parameters: [
        { name: "po_number", in: "query", schema: { type: "string" }, description: "Partial match on the order number." },
        {
          name: "batch_status",
          in: "query",
          schema: { type: "string" },
          description: `Comma-separated batch statuses: ${BATCH_STATUSES.map((s) => `\`${s}\``).join(", ")}.`,
          example: "in_production,preloading",
        },
        { ...isActiveParam, description: `${isActiveParam.description} It is the flag of the line's ETD record.` },
        orderParam("created_at"),
        limitParam(200, 50),
        offsetParam,
      ],
      responses: {
        200: {
          description: "Page of entries.",
          content: json(listEnvelope("EtdFactory"), {
            data: [
              {
                id: "0e5b5f0e-1d7c-4a8e-bb8e-6f1b1b2b9c33",
                po_number: "1488",
                lote: ".02",
                FACTORY: "Aok",
                category: "Absorber",
                initial_date: du("2026-08-20"),
                current_date: du("2026-08-22"),
                ready_parts: false,
                is_active: true,
              },
            ],
            pagination: { limit: 50, offset: 0, returned: 1, total: 1317 },
          }),
        },
        400: R400Query,
        401: R401,
        403: R403,
        500: R500,
      },
    },
  },
  ...libPaths(),
};

export const integrationSchemas = {
  LibraryRefNamed: {
    type: ["object", "null"],
    required: ["id", "name", "gss_id"],
    properties: { id: uuid, name: { type: "string" }, gss_id: { type: ["string", "null"], description: "null = not paired with GSS yet." } },
  },
  PersonRef: {
    type: ["object", "null"],
    required: ["id", "name"],
    properties: { id: uuid, name: { type: ["string", "null"] } },
  },
  OrderItem: {
    type: "object",
    required: ["id", "factory", "category", "ship_requirement", "loading_status", "batch", "is_active"],
    properties: {
      id: { ...uuid, description: "Line id — usable in `item_ids` of the batches API." },
      factory: ref("LibraryRefNamed"),
      category: ref("LibraryRefNamed"),
      ship_requirement: date,
      loading_status: { type: ["string", "null"], enum: ["total", "partial", "none", null] },
      batch: {
        type: ["object", "null"],
        description: "Batch assigned in SOTWISE; null = no batch yet.",
        properties: { id: uuid, batch_number: { type: "string" }, status: { type: "string", enum: BATCH_STATUSES } },
      },
      is_active: isActiveOut,
    },
  },
  OrderChecklistStep: {
    type: "object",
    required: ["step", "enabled", "done", "estimated_date", "completed_on"],
    properties: {
      step: { type: "string", enum: ORDER_STEPS },
      enabled: { type: "boolean" },
      done: { type: "boolean" },
      estimated_date: nullableDate,
      completed_on: nullableDate,
    },
  },
  Order: {
    type: "object",
    properties: {
      id: uuid,
      gss_id: { type: ["string", "null"], description: "null when the order was born in SOTWISE." },
      po_number: { type: "string" },
      status: { type: "string", enum: ORDER_STATUSES },
      asap: { type: "boolean" },
      schedule_requested: nullableDate,
      client_reference: { type: ["string", "null"] },
      date_po: nullableDate,
      order_received_date: { ...nullableDate, description: "Order step — current value (after revisions)." },
      pi_status: { type: ["string", "null"], description: "PI step — last status received from GSS." },
      pi_status_date: nullableDate,
      order_type: ref("LibraryRefNamed"),
      client: ref("LibraryRefNamed"),
      business_unit: ref("LibraryRefNamed"),
      exporter: ref("LibraryRefNamed"),
      leader: ref("PersonRef"),
      requester: ref("PersonRef"),
      operational_responsible: ref("PersonRef"),
      is_active: isActiveOut,
      created_at: instant,
      updated_at: instant,
      items: { type: "array", items: ref("OrderItem"), description: "Only with `include=items`." },
      checklist: {
        type: "array",
        items: ref("OrderChecklistStep"),
        description: "Only with `include=checklist`. Canonical order of the screens.",
      },
    },
  },
  OrderUpsertItem: {
    type: "object",
    required: ["supplier_category_gss_id", "ship_requirement"],
    properties: {
      supplier_category_gss_id: { type: "string", description: "GSS supplier-category id (gives factory + category)." },
      ship_requirement: inDay,
    },
  },
  OrderUpsert: {
    type: "object",
    required: ["gss_id"],
    properties: {
      gss_id: { type: "string", description: "GSS order id — idempotency key." },
      po_number: { type: "string", maxLength: 50, description: "Required to create; unique." },
      schedule_requested: inDayNullable,
      client_reference: { type: ["string", "null"], maxLength: 200 },
      date_po: { ...inDayNullable, description: "Default: today (creation only)." },
      client_gss_id: { type: ["string", "null"] },
      order_type_gss_id: { type: ["string", "null"] },
      business_unit_gss_id: { type: ["string", "null"] },
      exporter_gss_id: { type: ["string", "null"] },
      leader_email: { type: ["string", "null"], format: "email" },
      requester_email: { type: ["string", "null"], format: "email" },
      operational_responsible_email: { type: ["string", "null"], format: "email" },
      is_active: isActiveIn,
      ...orderChecklistFieldsIn,
      items: { type: ["array", "null"], items: ref("OrderUpsertItem") },
    },
  },
  OrderUpsertResult: {
    type: "object",
    required: ["data", "created"],
    properties: {
      data: {
        type: "object",
        required: ["id", "po_number", "is_active"],
        properties: { id: uuid, po_number: { type: "string" }, is_active: isActiveOut },
      },
      created: { type: "boolean" },
    },
  },
  PreLoading: {
    type: "object",
    properties: {
      pl_number: { type: ["integer", "null"], description: "Numeric part of the PL number (\"PL - 1306\" → 1306)." },
      estimated_loading_date: { ...nullableDate, description: "Estimated date of the Loading Date step." },
      loading_date: { ...nullableDate, description: "Actual date of the Loading Date step." },
      ETD: { ...nullableDate, description: "Estimated date of the Shipping Date step." },
      ETA_Brazil: { ...nullableDate, description: "Estimated date of the ETA Brazil step." },
      ATA_Brazil: { ...nullableDate, description: "Actual date of the ATA Brazil step." },
      DELIVERED_DATE: { ...nullableDate, description: "Actual date of the Delivered step." },
      shipping_date: { ...nullableDate, description: "Actual date of the Shipping Date step." },
      batches: { type: "array", items: ref("PlBatchRef"), description: "Batches in the PL." },
      is_active: { ...isActiveOut, description: `The PL's flag (mirrored to its shipment). ${isActiveOut.description}` },
    },
  },
  PlBatchRef: {
    type: "object",
    required: ["order", "batch"],
    properties: {
      order: { type: ["integer", "string", "null"], description: "po_number (a number when numeric)." },
      batch: { type: "string", description: "Batch number inside the order (`.NN`)." },
    },
  },
  EtdFactory: {
    type: "object",
    properties: {
      id: { ...uuid, description: "Factory × Category line id — the `{id}` of `PATCH /api/etd-factories/{id}`." },
      po_number: { type: ["string", "null"] },
      lote: { type: "string", description: "Batch number inside the order (`.NN`)." },
      FACTORY: { type: ["string", "null"] },
      category: { type: ["string", "null"] },
      initial_date: { ...nullableDate, description: "null until the order's ETD step is filled for the first time." },
      current_date: nullableDate,
      ready_parts: { type: "boolean", description: "The \"Ready Parts\" checkbox." },
      is_active: { ...isActiveOut, description: `Flag of this line's ETD record. ${isActiveOut.description}` },
    },
  },
  ...libSchemas(),
};
