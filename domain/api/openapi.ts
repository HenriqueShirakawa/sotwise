import {
  BATCH_STATUSES,
  DEFAULT_LIMIT,
  EDITABLE_BATCH_STATUSES,
  MAX_LIMIT,
} from "@/domain/batches/api-schema";

import { dayToUnix, timestampToUnix } from "@/lib/api-dates";

import { integrationPaths, integrationSchemas, integrationTags } from "./openapi-integration";
import { restPaths, restSchemas, restTags } from "./openapi-rest";

/**
 * Contrato OpenAPI 3.1 da API do SOTWISE para integradores (GSS).
 *
 * Servido em `/api/openapi.json` e renderizado pelo Swagger UI em `/api/docs`.
 * Cobre TODA a API de integração: Lotes (aqui) + Orders, Pre-loadings, ETD
 * Factories e Bibliotecas (./openapi-integration.ts). Rotas internas (copilot,
 * cron, webhooks, dispatch) ficam de fora.
 *
 * ⚠️ Escrito à mão: ao mudar domain/batches/api-schema.ts (campos, limites,
 * status), atualizar aqui também. Os enums/limites já vêm de lá.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description: string, example: string) => ({
  description,
  content: {
    "application/json": {
      schema: ref("Error"),
      example: { error: example },
    },
  },
});

const R400 = errorResponse(
  "Invalid payload/query, or a reference (order, item, supplier_category_gss_id) that does not exist.",
  "No order found for order_gss_id '1680'."
);
const R401 = errorResponse("Missing or invalid token.", "Invalid token");
const R403 = errorResponse("The token has no access to this resource.", "Forbidden");
const R404 = errorResponse("Batch not found.", "Batch not found.");
const R409 = errorResponse(
  "Business-rule conflict with the current state (batch not editable, duplicated batch_number, duplicated Category + Factory, In Production batch left empty).",
  "Batch '.02' can only be changed while In Negotiation or In Production (later statuses are driven by the Pre-loading/Shipment flow)."
);
const R500 = errorResponse("Unexpected error.", "Failed to update batch.");

const batchIdParam = {
  name: "id",
  in: "path",
  required: true,
  description:
    "Batch UUID (`data.id` from the list, from the POST, or `items[].batch.id` from `GET /api/orders?include=items`) **or** its `full_number` (`1230.02` — the GSS `batch_code`).",
  schema: { type: "string" },
};

const exampleBatch = {
  id: "7b0f7f43-3c0a-4a43-9a0e-0d3f4f6f2b11",
  gss_id: "37",
  batch_number: ".02",
  full_number: "1680.02",
  status: "in_negotiation",
  split_from_batch_id: null,
  order: { id: "c1d1f0a2-5b8e-4a37-8a54-2f0c6d0a9e01", gss_id: "1680", po_number: "1680" },
  items: [
    {
      id: "0e5b5f0e-1d7c-4a8e-bb8e-6f1b1b2b9c33",
      supplier_category_gss_id: "4521",
      factory: { id: "2b7d6c1e-0a4f-4e8b-9c3d-5f6a7b8c9d01", gss_id: "312", name: "Zenchum" },
      category: { id: "8e1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a45", gss_id: "88", name: "Brake Pads" },
      ship_requirement: dayToUnix("2026-11-30"),
      loading_status: null,
    },
  ],
  pre_loadings: [],
  created_at: timestampToUnix("2026-10-05T14:02:11.120Z"),
  updated_at: timestampToUnix("2026-10-05T14:02:11.120Z"),
};

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "SOTWISE API",
    version: "1.0.0",
    description: [
      "Integration API of SOTWISE, for the GSS team.",
      "",
      "**Authentication** — every call sends `Authorization: Bearer <API_TOKEN>` (click **Authorize** above).",
      "",
      "**Envelope** — success: `{ \"data\": … }` (lists also carry `pagination`). Error: `{ \"error\": \"message\" }` (validation errors also carry `issues`).",
      "",
      "**Status codes** — 4xx: review what was sent; 5xx: problem on the SOTWISE side (report it with the message, do not retry forever).",
      "",
      "**Dates** — always **Unix timestamps in seconds**, in and out (same as GSS). A calendar day (e.g. `ship_requirement`) is sent as 12:00 UTC of that day, so it is the same day in Brazil and China; created/updated moments carry a fraction. Input still accepts the legacy formats (`YYYY-MM-DD` for days, ISO 8601 with offset for `updated_since`). Send seconds, not milliseconds.",
      "",
      "**Resources** — REST (`GET`, `POST`, `PATCH`, `DELETE`) on the five main ones: **Orders**, **Batches**, **Order items** (Factory × Category lines), **ETD Factories** (the ETD of a line) and **Shipments** (Pre-loading + its shipment, one record keyed by `pl_number`).",
      "The `{id}` of an item route takes the UUID **or** the business number: `/api/orders/1230`, `/api/batches/1230.02`, `/api/shipments/1306`. " +
        "References to registers take the SOTWISE id or the `gss_id`; people are sent by e-mail. Every write runs the same rules as the SOTWISE screens. " +
        "What GSS writes here is not sent back to GSS.",
      "",
      "**Batches** belong to one order and group its Factory × Category lines (the `items`).",
      "A line enters a batch in two ways: `item_ids` (a line that already exists in the order is *moved* — its id comes from `GET /api/orders?include=items`)",
      "or `items` (a *new* line, identified by `supplier_category_gss_id`, same as `items[]` of `POST /api/orders`).",
      "",
      "Rules (same as the SOTWISE screen):",
      "- A batch can only be changed or deleted while `in_negotiation` or `in_production`. After that the Pre-loading/Shipment flow drives it.",
      "- `status` can only be set to `in_negotiation` or `in_production`.",
      "- The same Category + Factory cannot appear twice in a batch.",
      "- A batch `in_production` always keeps at least one item (applies to the batch an item is moved *from* as well).",
      "- When the order's Deposit Payment step is settled, a batch that receives its first item goes to `in_production` automatically (unless the same PATCH sets `status`).",
      "- The order status is recalculated from its batches after every write.",
    ].join("\n"),
  },
  servers: [{ url: "/", description: "This environment" }],
  security: [{ bearerAuth: [] }],
  tags: [
    integrationTags[0],
    { name: "Batches", description: "Order batches (lotes) — full CRUD." },
    ...restTags,
    ...integrationTags.slice(1),
  ],
  paths: {
    ...integrationPaths,
    ...restPaths,
    "/api/batches": {
      get: {
        tags: ["Batches"],
        operationId: "listBatches",
        summary: "List batches",
        description:
          "Always returns a list. Filter by order with `order_gss_id` **or** `po_number` (unknown order → empty list). " +
          "Incremental sync: keep the highest `updated_at` seen and send it back as `updated_since` with `order=asc`. " +
          "⚠️ `updated_at` is the batch's own: moving/creating items does not change it.",
        parameters: [
          { name: "gss_id", in: "query", schema: { type: "string" }, description: "GSS OrderBatch id — the batch created in GSS." },
          { name: "order_gss_id", in: "query", schema: { type: "string" }, description: "Order `gss_id` (the GSS order id)." },
          { name: "po_number", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: [...BATCH_STATUSES] } },
          {
            name: "updated_since",
            in: "query",
            schema: { oneOf: [{ type: "number" }, { type: "string", format: "date-time" }] },
            description: "Unix seconds (e.g. `1790812800`); ISO 8601 with offset is still accepted (legacy).",
          },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" }, description: "Sort by `updated_at`." },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          200: {
            description: "Page of batches.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "pagination"],
                  properties: {
                    data: { type: "array", items: ref("Batch") },
                    pagination: ref("Pagination"),
                  },
                },
                example: {
                  data: [exampleBatch],
                  pagination: { limit: DEFAULT_LIMIT, offset: 0, returned: 1, total: 1 },
                },
              },
            },
          },
          400: R400,
          401: R401,
          403: R403,
          500: R500,
        },
      },
      post: {
        tags: ["Batches"],
        operationId: "createBatch",
        summary: "Create a batch (also the GSS webhook)",
        description:
          "Creates a batch in an order, optionally already filled. It starts `in_negotiation` " +
          "(or `in_production` if the order's Deposit Payment is settled and the batch has items). " +
          "Use `PATCH` to change the status.\n\n" +
          "**Webhook from GSS** — batches are created in GSS and pushed here with the GSS OrderBatch id in `gss_id`. " +
          "With `gss_id` the call is idempotent:\n" +
          "- `gss_id` already known → **200**, the batch is returned (and `batch_number`/`items`/`item_ids`, if sent, are applied like a PATCH);\n" +
          "- a batch with the same `batch_number` already exists in the order without `gss_id` → it is linked to this `gss_id` (**200**);\n" +
          "- otherwise → **201**, created.\n\n" +
          "`batch_number` accepts the GSS `batch_code` (`1680.02`) as well as the suffix (`.02`).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: ref("BatchCreate"),
              examples: {
                webhook: {
                  summary: "GSS webhook (batch created in GSS)",
                  value: { gss_id: 37, order_gss_id: 1680, batch_number: "1680.02" },
                },
                empty: {
                  summary: "Empty batch (next number automatically)",
                  value: { order_gss_id: "1680" },
                },
                newItems: {
                  summary: "With new items",
                  value: {
                    order_gss_id: "1680",
                    batch_number: ".02",
                    items: [{ supplier_category_gss_id: "4521", ship_requirement: dayToUnix("2026-11-30") }],
                  },
                },
                moveItems: {
                  summary: "Moving lines that already exist in the order",
                  value: {
                    po_number: "1680",
                    item_ids: ["0e5b5f0e-1d7c-4a8e-bb8e-6f1b1b2b9c33"],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "`gss_id` already known (or linked to an existing batch with the same number) — the batch as it is now.",
            content: { "application/json": { schema: ref("BatchEnvelope"), example: { data: exampleBatch } } },
          },
          201: {
            description: "Batch created.",
            content: { "application/json": { schema: ref("BatchEnvelope"), example: { data: exampleBatch } } },
          },
          400: R400,
          401: R401,
          403: R403,
          409: R409,
          500: R500,
        },
      },
    },
    "/api/batches/{id}": {
      parameters: [batchIdParam],
      get: {
        tags: ["Batches"],
        operationId: "getBatch",
        summary: "Get a batch",
        responses: {
          200: {
            description: "The batch.",
            content: { "application/json": { schema: ref("BatchEnvelope"), example: { data: exampleBatch } } },
          },
          401: R401,
          403: R403,
          404: R404,
          500: R500,
        },
      },
      patch: {
        tags: ["Batches"],
        operationId: "updateBatch",
        summary: "Update a batch",
        description:
          "Partial update — only the fields sent are applied. Everything is validated before anything is written. " +
          "`remove_item_ids` takes lines out of the batch (they stay in the order, without batch).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: ref("BatchUpdate"),
              examples: {
                status: { summary: "Move to production", value: { status: "in_production" } },
                rename: { summary: "Change the number", value: { batch_number: ".03" } },
                items: {
                  summary: "Add, move and remove items",
                  value: {
                    items: [{ supplier_category_gss_id: "4521", ship_requirement: dayToUnix("2026-11-30") }],
                    item_ids: ["0e5b5f0e-1d7c-4a8e-bb8e-6f1b1b2b9c33"],
                    remove_item_ids: ["5d2c9a77-8f4e-4c55-9a1b-3e2f6c7d8e99"],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Batch updated (returned as it is now).",
            content: { "application/json": { schema: ref("BatchEnvelope"), example: { data: exampleBatch } } },
          },
          400: R400,
          401: R401,
          403: R403,
          404: R404,
          409: R409,
          500: R500,
        },
      },
      delete: {
        tags: ["Batches"],
        operationId: "deleteBatch",
        summary: "Delete a batch",
        description:
          "Deletes the batch (only `in_negotiation`/`in_production`). Its lines are **not** deleted: they stay in the order without batch, " +
          "and their ids are returned in `released_item_ids`.",
        responses: {
          200: {
            description: "Batch deleted.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["id", "deleted", "released_item_ids"],
                      properties: {
                        id: { type: "string", format: "uuid" },
                        deleted: { type: "boolean", const: true },
                        released_item_ids: { type: "array", items: { type: "string", format: "uuid" } },
                      },
                    },
                  },
                },
                example: {
                  data: {
                    id: exampleBatch.id,
                    deleted: true,
                    released_item_ids: ["0e5b5f0e-1d7c-4a8e-bb8e-6f1b1b2b9c33"],
                  },
                },
              },
            },
          },
          401: R401,
          403: R403,
          404: R404,
          409: R409,
          500: R500,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "The `API_TOKEN` shared with the GSS team." },
    },
    schemas: {
      ...integrationSchemas,
      ...restSchemas,
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          issues: { type: "array", items: { type: "object" }, description: "Validation details (400 only)." },
        },
      },
      Pagination: {
        type: "object",
        required: ["limit", "offset", "returned", "total"],
        properties: {
          limit: { type: "integer" },
          offset: { type: "integer" },
          returned: { type: "integer" },
          total: { type: "integer" },
        },
      },
      LibraryRef: {
        type: ["object", "null"],
        required: ["id", "gss_id", "name"],
        properties: {
          id: { type: "string", format: "uuid" },
          gss_id: { type: ["string", "null"] },
          name: { type: "string" },
        },
      },
      BatchItem: {
        type: "object",
        description: "A Factory × Category line of the order that is in this batch.",
        required: ["id", "supplier_category_gss_id", "factory", "category", "ship_requirement", "loading_status"],
        properties: {
          id: { type: "string", format: "uuid", description: "Line id — use it in `item_ids` / `remove_item_ids`." },
          supplier_category_gss_id: { type: ["string", "null"] },
          factory: ref("LibraryRef"),
          category: ref("LibraryRef"),
          ship_requirement: { type: ["number", "null"], description: "Unix seconds (12:00 UTC of the day)." },
          loading_status: {
            type: ["string", "null"],
            enum: ["total", "partial", "none", null],
            description: "Filled when the shipping is confirmed.",
          },
        },
      },
      Batch: {
        type: "object",
        required: [
          "id",
          "gss_id",
          "batch_number",
          "full_number",
          "status",
          "split_from_batch_id",
          "order",
          "items",
          "pre_loadings",
          "created_at",
          "updated_at",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          gss_id: { type: ["string", "null"], description: "GSS OrderBatch id; null for batches that exist only in SOTWISE." },
          batch_number: { type: "string", description: "Suffix inside the order, usually `.NN` (e.g. `.02`)." },
          full_number: { type: "string", description: "`po_number` + `batch_number` (e.g. `1680.02`)." },
          status: { type: "string", enum: [...BATCH_STATUSES] },
          split_from_batch_id: {
            type: ["string", "null"],
            format: "uuid",
            description: "Set when the batch was created by a partial shipping split.",
          },
          order: {
            type: "object",
            required: ["id", "gss_id", "po_number"],
            properties: {
              id: { type: "string", format: "uuid" },
              gss_id: { type: ["string", "null"] },
              po_number: { type: "string" },
            },
          },
          items: { type: "array", items: ref("BatchItem") },
          pre_loadings: {
            type: "array",
            description: "Pre-loadings (PL) this batch was put in.",
            items: {
              type: "object",
              required: ["id", "pl_number"],
              properties: { id: { type: "string", format: "uuid" }, pl_number: { type: "string" } },
            },
          },
          created_at: { type: ["number", "null"], description: "Unix seconds (fractional)." },
          updated_at: { type: ["number", "null"], description: "Unix seconds (fractional)." },
        },
      },
      BatchEnvelope: {
        type: "object",
        required: ["data"],
        properties: { data: ref("Batch") },
      },
      NewItem: {
        type: "object",
        additionalProperties: false,
        required: ["supplier_category_gss_id", "ship_requirement"],
        properties: {
          supplier_category_gss_id: { type: "string", description: "GSS supplier-category id (gives factory + category)." },
          ship_requirement: {
            oneOf: [
              { type: "number", description: "Unix seconds — the UTC calendar day is used (send 12:00 UTC to be safe)." },
              { type: "string", format: "date", description: "Legacy: YYYY-MM-DD." },
            ],
          },
        },
      },
      BatchCreate: {
        type: "object",
        additionalProperties: false,
        description: "Send exactly one of `order_gss_id` / `po_number`. Unknown fields → 400.",
        properties: {
          gss_id: {
            type: ["integer", "string"],
            description: "GSS OrderBatch id. Makes the call idempotent (see the operation description). Stored as text.",
          },
          order_gss_id: {
            type: ["integer", "string"],
            description: "GSS order id. Matches `orders.gss_id`; if no order has it, the order whose `po_number` equals it (and has no `gss_id` yet).",
          },
          po_number: { type: "string" },
          batch_number: {
            type: "string",
            maxLength: 20,
            description:
              "Optional. `.NN` or the GSS `batch_code` (`1680.02` → `.02`). Default: next free `.NN` of the order. Must be unique inside the order.",
          },
          item_ids: {
            type: "array",
            maxItems: 500,
            items: { type: "string", format: "uuid" },
            description: "Existing lines of the same order to move into the batch.",
          },
          items: { type: "array", maxItems: 500, items: ref("NewItem"), description: "New lines, created inside the batch." },
        },
      },
      BatchUpdate: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        description: "Partial. Unknown fields → 400.",
        properties: {
          batch_number: { type: "string", maxLength: 20 },
          status: { type: "string", enum: [...EDITABLE_BATCH_STATUSES] },
          item_ids: {
            type: "array",
            maxItems: 500,
            items: { type: "string", format: "uuid" },
            description: "Existing lines of the same order to move into the batch.",
          },
          items: { type: "array", maxItems: 500, items: ref("NewItem"), description: "New lines, created inside the batch." },
          remove_item_ids: {
            type: "array",
            maxItems: 500,
            items: { type: "string", format: "uuid" },
            description: "Lines of this batch to take out (they stay in the order without batch).",
          },
        },
      },
    },
  },
} as const;
