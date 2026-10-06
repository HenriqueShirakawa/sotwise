/**
 * Parte do contrato OpenAPI (domain/api/openapi.ts) com o REST completo de
 * 06/10: item de Orders, linhas Factory × Category, PATCH do ETD e PL +
 * Shipment como um recurso só. Espelha o código:
 *
 *   Orders/{id}        app/api/orders/[id]/route.ts + domain/orders/api-write.ts
 *   Order items        app/api/order-items/** + domain/order-items/*
 *   ETD/{id}           app/api/etd-factories/[id]/route.ts + domain/etd-factories/api-write.ts
 *   Shipments          app/api/shipments/** + domain/shipments/*
 *
 * ⚠️ Escrito à mão: mudou campo/regra lá, muda aqui.
 */

import {
  BATCH_STATUSES,
  R400Query,
  R401,
  R403,
  R500,
  du,
  err,
  inDay,
  inDayNullable,
  instant,
  json,
  limitParam,
  listEnvelope,
  nullableDate,
  offsetParam,
  orderParam,
  ref,
  updatedSinceParam,
  uuid,
} from "./openapi-integration";

const R404 = (what: string) => err(`${what} not found.`, `${what} not found.`);
const R400Body = (example: string) => err("Invalid body (`issues` points to the field) or a reference that does not exist.", example);
const R409 = (description: string, example: string) => err(description, example);

const ref2 = { type: ["string", "integer"], description: "SOTWISE id (UUID) **or** the `gss_id`." };
const refNullable = { type: ["string", "integer", "null"], description: "SOTWISE id (UUID) or `gss_id`; `null` clears." };
const emailIn = { type: "string", format: "email" };
const emailInNullable = { type: ["string", "null"], format: "email" };
const deleted = {
  type: "object",
  required: ["data"],
  properties: {
    data: { type: "object", required: ["id", "deleted"], properties: { id: uuid, deleted: { type: "boolean", const: true } } },
  },
};

const PL_STEPS = [
  "consolidation_point",
  "city",
  "port_of_loading",
  "shipping_docs",
  "agents",
  "booking",
  "loading_date",
];
const SHIP_STEPS = ["shipping_date", "bl", "original_docs", "inspection_report", "eta_brazil", "ata_brazil", "delivered"];

const orderKey = {
  name: "id",
  in: "path",
  required: true,
  description: "Order UUID **or** `po_number` (e.g. `1230`).",
  schema: { type: "string" },
};
const itemKey = {
  name: "id",
  in: "path",
  required: true,
  description: "Factory × Category line UUID (same id as `GET /api/orders?include=items` and batch `items[]`).",
  schema: uuid,
};
const shipmentKey = {
  name: "id",
  in: "path",
  required: true,
  description: "Pre-loading UUID **or** `pl_number` (e.g. `1306`).",
  schema: { type: "string" },
};

const exampleItem = {
  id: "0e5b5f0e-1d7c-4a8e-bb8e-6f1b1b2b9c33",
  po_number: "1230",
  order_gss_id: "1230",
  batch_id: "7b0f7f43-3c0a-4a43-9a0e-0d3f4f6f2b11",
  batch: ".02",
  batch_status: "in_production",
  factory: "Jingtuo",
  factory_gss_id: "444",
  category: "Pedal",
  category_gss_id: "22",
  supplier_category_gss_id: "4521",
  ship_requirement: du("2026-11-30"),
  loading_status: null,
  created_at: 1791319187.185,
  updated_at: 1791319187.185,
};

const exampleShipment = {
  id: "21d4d81b-a0e9-4b23-b8b1-280690b0c9e7",
  gss_id: "1",
  pl_number: 1306,
  status: "in_transit",
  batches: [
    { order: 1230, batch: ".02" },
    { order: 1324, batch: ".03" },
  ],
  estimated_loading_date: du("2026-07-08"),
  loading_date: du("2026-07-10"),
  ETD: du("2026-07-18"),
  ETA_Brazil: du("2026-09-05"),
  ATA_Brazil: null,
  DELIVERED_DATE: null,
  shipping_date: du("2026-07-19"),
  created_at: 1790947812.75,
  updated_at: 1791233008.1,
};

export const restTags = [
  {
    name: "Order items",
    description:
      "Factory × Category lines of an order — full CRUD. Moving a line between batches follows the batch rules. The ETD of a line is in **ETD Factories**.",
  },
  {
    name: "Shipments",
    description:
      "Pre-loading (PL) **and** its shipment as ONE resource (like GSS `/v1/shipments/`), keyed by `pl_number`. " +
      "Create the PL, change it, ship it (Confirm Shipping), fill the checklist steps, undo the shipment, delete.",
  },
];

export const restPaths = {
  "/api/orders/{id}": {
    parameters: [orderKey],
    get: {
      tags: ["Orders"],
      operationId: "getOrder",
      summary: "Get an order",
      description: "Same shape as one item of `GET /api/orders` (incl. `include=items,checklist`).",
      parameters: [
        {
          name: "include",
          in: "query",
          schema: { type: "string" },
          description: "Comma-separated: `items` and/or `checklist`.",
          example: "items,checklist",
        },
      ],
      responses: {
        200: { description: "The order.", content: json({ type: "object", required: ["data"], properties: { data: ref("Order") } }) },
        400: R400Query,
        401: R401,
        403: R403,
        404: R404("Order"),
        500: R500,
      },
    },
    patch: {
      tags: ["Orders"],
      operationId: "patchOrder",
      summary: "Update an order header",
      description:
        "Partial: only the keys sent change; `null` clears. Library refs by `gss_id`, people by e-mail (unknown → 400). " +
        "`po_number`, `gss_id` and `status` cannot change here (status is the rollup of the batches). Lines: **Order items**.",
      requestBody: {
        required: true,
        content: json(ref("OrderPatch"), { client_reference: "REPLACEMENT 2", leader_email: "leader@example.com" }),
      },
      responses: {
        200: {
          description: "Updated.",
          content: json(ref("OrderUpsertResult"), { data: { id: "c1d1f0a2-5b8e-4a37-8a54-2f0c6d0a9e01", po_number: "1230" } }),
        },
        400: R400Body("No SOTWISE user found for e-mail 'x@example.com'."),
        401: R401,
        403: R403,
        404: R404("Order"),
        500: R500,
      },
    },
    delete: {
      tags: ["Orders"],
      operationId: "deleteOrder",
      summary: "Delete an order",
      description:
        "Hard delete, same locks as the SOTWISE trash button: only `in_negotiation`, `in_production` or `canceled`, and never when a batch is in a pre-loading/shipment. " +
        "Batches, lines, ETD and checklist go with it.",
      responses: {
        200: { description: "Deleted.", content: json(deleted) },
        401: R401,
        403: R403,
        404: R404("Order"),
        409: R409("Status not deletable, or a batch is in a pre-loading/shipment.", "This order is already in pre-loading 1306. Remove it from there before deleting the order."),
        500: R500,
      },
    },
  },

  "/api/order-items": {
    get: {
      tags: ["Order items"],
      operationId: "listOrderItems",
      summary: "List Factory × Category lines",
      description: "Flat rows. Sorted by `updated_at` + `id`.",
      parameters: [
        { name: "po_number", in: "query", schema: { type: "string" } },
        { name: "order_gss_id", in: "query", schema: { type: "string" } },
        { name: "batch_id", in: "query", schema: { type: "string" }, description: "Batch UUID or `full_number` (`1230.02`)." },
        { name: "unassigned", in: "query", schema: { type: "string", enum: ["true", "false"] }, description: "`true` = only lines without batch." },
        updatedSinceParam,
        orderParam("updated_at"),
        limitParam(200, 50),
        offsetParam,
      ],
      responses: {
        200: {
          description: "Page of lines.",
          content: json(listEnvelope("OrderItemRow"), { data: [exampleItem], pagination: { limit: 50, offset: 0, returned: 1, total: 1 } }),
        },
        400: R400Query,
        401: R401,
        403: R403,
        500: R500,
      },
    },
    post: {
      tags: ["Order items"],
      operationId: "createOrderItem",
      summary: "Create a line",
      description:
        "The line is identified by `supplier_category_gss_id` (→ factory + category), like `items[]` of `POST /api/orders`. " +
        "With `batch_id` it is born in that batch (batch rules apply: editable batch, no twin Category + Factory). " +
        "Without batch, the same pair cannot be loose twice in the order (409).",
      requestBody: {
        required: true,
        content: json(ref("OrderItemCreate"), { po_number: "1230", supplier_category_gss_id: "4521", ship_requirement: du("2026-11-30"), batch_id: "1230.02" }),
      },
      responses: {
        201: { description: "Created.", content: json({ type: "object", properties: { data: ref("OrderItemRow") } }, { data: exampleItem }) },
        400: R400Body("No factory_products found for supplier_category_gss_id '9999'."),
        401: R401,
        403: R403,
        409: R409("Twin in the batch, batch not editable, or the pair is already loose in the order.", "The same Category + Factory can only appear once per batch."),
        500: R500,
      },
    },
  },
  "/api/order-items/{id}": {
    parameters: [itemKey],
    get: {
      tags: ["Order items"],
      operationId: "getOrderItem",
      summary: "Get a line",
      responses: {
        200: { description: "The line.", content: json({ type: "object", properties: { data: ref("OrderItemRow") } }, { data: exampleItem }) },
        401: R401,
        403: R403,
        404: R404("Item"),
        500: R500,
      },
    },
    patch: {
      tags: ["Order items"],
      operationId: "patchOrderItem",
      summary: "Move a line / change ship requirement",
      description:
        "`batch_id` moves the line (UUID or `full_number`; `null` takes it out of its batch) — origin and target must be editable, " +
        "an In Production batch never becomes empty, no twins. `ship_requirement` only while the line's batch is editable. " +
        "Factory/category cannot change (delete and create). `loading_status` comes from Confirm Shipping.",
      requestBody: { required: true, content: json(ref("OrderItemUpdate"), { batch_id: "1230.03" }) },
      responses: {
        200: { description: "Updated.", content: json({ type: "object", properties: { data: ref("OrderItemRow") } }) },
        400: R400Body("Batch '1230.09' not found."),
        401: R401,
        403: R403,
        404: R404("Item"),
        409: R409("Batch rule (not editable, twin, In Production left empty).", "A batch In Production needs at least one Factory x Category entry. Move the batch back to In Negotiation first."),
        500: R500,
      },
    },
    delete: {
      tags: ["Order items"],
      operationId: "deleteOrderItem",
      summary: "Delete a line",
      description: "Only in an editable batch (or without batch); never the last line of an In Production batch; never a line already loaded in a shipment. Its ETD goes with it.",
      responses: {
        200: { description: "Deleted.", content: json(deleted) },
        401: R401,
        403: R403,
        404: R404("Item"),
        409: R409("Batch rule, or the line was loaded in a shipment.", "This item was loaded in a shipment and can't be deleted."),
        500: R500,
      },
    },
  },

  "/api/etd-factories/{id}": {
    parameters: [itemKey],
    get: {
      tags: ["ETD Factories"],
      operationId: "getEtdFactory",
      summary: "Get the ETD of a line",
      description: "Same shape as one row of `GET /api/etd-factories` (also for a line without batch).",
      responses: {
        200: { description: "The ETD row.", content: json({ type: "object", properties: { data: ref("EtdFactory") } }) },
        401: R401,
        403: R403,
        404: R404("Item"),
        500: R500,
      },
    },
    patch: {
      tags: ["ETD Factories"],
      operationId: "patchEtdFactory",
      summary: "Update the ETD of a line",
      description: [
        "Same rules as the SOTWISE screen:",
        "- `initial_date` can only be set while empty (409 after). Its first value is copied to `current_date`.",
        "- `ready_parts` false → true is free.",
        "- A **correction** — changing a filled `current_date` or unchecking `ready_parts` — requires `remarks` (the reason).",
        "- `current_date` cannot change once the batch has shipped.",
        "- Every change is written to the ETD history (source \"API (GSS)\").",
      ].join("\n"),
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: ref("EtdPatch"),
            examples: {
              first: { summary: "First ETD", value: { initial_date: du("2026-11-20") } },
              correction: { summary: "Correction (needs remarks)", value: { current_date: du("2026-11-27"), remarks: "Factory delayed one week" } },
              ready: { summary: "Parts ready", value: { ready_parts: true } },
            },
          },
        },
      },
      responses: {
        200: { description: "Updated ETD row.", content: json({ type: "object", properties: { data: ref("EtdFactory") } }) },
        400: R400Body("remarks is required to correct an ETD (changing a filled current_date or unchecking ready_parts)."),
        401: R401,
        403: R403,
        404: R404("Item"),
        409: R409("Initial Date already set, or the batch has shipped.", "Initial Date is locked once set. Change the current_date instead (with remarks)."),
        500: R500,
      },
    },
  },

  "/api/shipments": {
    get: {
      tags: ["Shipments"],
      operationId: "listShipments",
      summary: "List PLs / shipments",
      description:
        "Flat rows (same fields as `GET /api/pre-loadings` + `id`, `gss_id`, `status`). " +
        "`status`: `preloading` until Confirm Shipping, then `in_transit` → `delivered` (Delivered step). " +
        "`updated_since` also catches changes in the checklist steps and in the shipment.",
      parameters: [
        { name: "pl_number", in: "query", schema: { type: "string" }, description: "Exact PL number." },
        { name: "po_number", in: "query", schema: { type: "string" }, description: "Partial match: PLs that carry a batch of these orders." },
        { name: "status", in: "query", schema: { type: "string", enum: ["preloading", "in_transit", "delivered"] } },
        updatedSinceParam,
        orderParam("created_at"),
        limitParam(200, 50),
        offsetParam,
      ],
      responses: {
        200: {
          description: "Page of PLs.",
          content: json(listEnvelope("Shipment"), { data: [exampleShipment], pagination: { limit: 50, offset: 0, returned: 1, total: 1 } }),
        },
        400: R400Query,
        401: R401,
        403: R403,
        500: R500,
      },
    },
    post: {
      tags: ["Shipments"],
      operationId: "createShipment",
      summary: "Create a pre-loading (PL)",
      description:
        "The PL number is assigned by SOTWISE. The 14 checklist steps are created with it. " +
        "Batches must be **In Production**, have at least one line and not be in another PL; they move to `preloading`. " +
        "**Idempotent by `gss_id`**: a resend returns the existing PL (200) unchanged — use PATCH to change it.",
      requestBody: {
        required: true,
        content: json(ref("ShipmentCreate"), {
          gss_id: "1",
          clients: [9],
          client_reference: "MOTOBOR 2.0",
          pod: 14,
          leader_email: "leader@example.com",
          batch_ids: ["1230.02", "1324.03"],
        }),
      },
      responses: {
        200: { description: "`gss_id` already known — the existing PL.", content: json({ type: "object", properties: { data: ref("Shipment") } }) },
        201: { description: "Created.", content: json({ type: "object", properties: { data: ref("Shipment") } }, { data: { ...exampleShipment, status: "preloading" } }) },
        400: R400Body("No client found for '9999' (send the SOTWISE id or the gss_id)."),
        401: R401,
        403: R403,
        409: R409("A batch is not In Production, has no line, or is in another PL.", "Batch 1230.02 is already in pre-loading 1306."),
        500: R500,
      },
    },
  },
  "/api/shipments/{id}": {
    parameters: [shipmentKey],
    get: {
      tags: ["Shipments"],
      operationId: "getShipment",
      summary: "Get a PL / shipment",
      responses: {
        200: { description: "The PL.", content: json({ type: "object", properties: { data: ref("Shipment") } }, { data: exampleShipment }) },
        401: R401,
        403: R403,
        404: R404("Pre-loading"),
        500: R500,
      },
    },
    patch: {
      tags: ["Shipments"],
      operationId: "patchShipment",
      summary: "Update, ship (Confirm Shipping) or undo",
      description: [
        "Three uses — `status` goes in its own request:",
        "1. **Header / batches** (`clients`, `client_reference`, `pod`, people, `batch_ids` = the full set, `gss_id`) — only while not shipped (409 after).",
        "2. **`status: \"in_transit\"` + `confirm`** = Confirm Shipping, same rules as the screen: the 7 Pre-loading steps complete " +
          "(incl. the Shipping Docs attachment, uploaded in SOTWISE), a `loading_status` for **every** line of the PL's batches, " +
          "and no batch with every line `none`. `none`/`partial` lines move to the next open batch of the order (or a new one).",
        "3. **`status: \"preloading\"`** = undo the shipment (reverts the split). Refused for a delivered shipment or when the split batches already moved on.",
        "",
        "`delivered` is not set here — complete the `delivered` step.",
      ].join("\n"),
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: ref("ShipmentPatch"),
            examples: {
              header: { summary: "Change header / batches", value: { client_reference: "MOTOBOR 2.0_203", batch_ids: ["1230.02", "1324.03", "1337.01"] } },
              ship: {
                summary: "Confirm Shipping",
                value: {
                  status: "in_transit",
                  confirm: {
                    container_number: "MSCU1234567",
                    seal_number: "SL998877",
                    estimated_date: du("2026-07-08"),
                    loading_date_completed_on: du("2026-07-10"),
                    carrier: 1,
                    shipment_model: "027d1f3c-3ac9-400c-967e-bda0248daa89",
                    shipment_leader_email: "leader@example.com",
                    signer_email: "signer@example.com",
                    lines: [
                      { item_id: "0e5b5f0e-1d7c-4a8e-bb8e-6f1b1b2b9c33", loading_status: "total" },
                      { item_id: "1a2b3c4d-1d7c-4a8e-bb8e-6f1b1b2b9c34", loading_status: "partial" },
                    ],
                  },
                },
              },
              undo: { summary: "Undo the shipment", value: { status: "preloading" } },
            },
          },
        },
      },
      responses: {
        200: { description: "The PL after the change.", content: json({ type: "object", properties: { data: ref("Shipment") } }) },
        400: R400Body("Set the loading status for every line."),
        401: R401,
        403: R403,
        404: R404("Pre-loading"),
        409: R409(
          "Already shipped / not shipped, checklist steps still open, every line `none` in a batch, or the undo is not possible.",
          "Complete all checklist steps before shipping — still open: Shipping docs."
        ),
        500: R500,
      },
    },
    delete: {
      tags: ["Shipments"],
      operationId: "deleteShipment",
      summary: "Delete a PL",
      description: "Only a PL that is not shipped (undo the shipment first). Its batches go back to `in_production`.",
      responses: {
        200: { description: "Deleted.", content: json(deleted) },
        401: R401,
        403: R403,
        404: R404("Pre-loading"),
        409: R409("The PL was already shipped.", "This pre-loading was already shipped. Undo the shipment first (PATCH status 'preloading')."),
        500: R500,
      },
    },
  },
  "/api/shipments/{id}/steps/{step}": {
    parameters: [
      shipmentKey,
      {
        name: "step",
        in: "path",
        required: true,
        schema: { type: "string", enum: [...PL_STEPS, ...SHIP_STEPS] },
        description: `Pre-loading steps: ${PL_STEPS.join(", ")}. Shipment steps (only after Confirm Shipping): ${SHIP_STEPS.join(", ")}.`,
      },
    ],
    patch: {
      tags: ["Shipments"],
      operationId: "patchShipmentStep",
      summary: "Update a checklist step",
      description: [
        "Same rules as the SOTWISE screens:",
        "- `completed_on` is never in the future and needs `estimated_date`.",
        "- Step-specific fields are only accepted on their step: `consolidation_point` (consolidation_point), `city` (city), `pol` (port_of_loading), " +
          "`carrier`/`agent_brazil`/`agent_china`/`contact_brazil`/`contact_china` (agents), `booking_number`/`cutoff_date` (booking).",
        "- A step that gets everything it needs (+ an estimated date) closes by itself.",
        "- Completing `delivered` sets the shipment and its batches to `delivered`; clearing it reopens them (`in_transit`).",
        "- Attachments (Shipping Docs, BL, Original Docs) are uploaded in SOTWISE only.",
        "",
        "Returns the PL (`GET /api/shipments/{id}` shape).",
      ].join("\n"),
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: ref("ShipmentStepPatch"),
            examples: {
              dates: { summary: "Dates", value: { estimated_date: du("2026-09-05"), completed_on: du("2026-09-06") } },
              booking: { summary: "Booking", value: { booking_number: "BK123456", cutoff_date: du("2026-07-05"), estimated_date: du("2026-07-04") } },
              reopen: { summary: "Reopen", value: { completed_on: null } },
            },
          },
        },
      },
      responses: {
        200: { description: "The PL after the change.", content: json({ type: "object", properties: { data: ref("Shipment") } }) },
        400: R400Body("Fill in the estimated date before setting the completion date."),
        401: R401,
        403: R403,
        404: err("Pre-loading or step not found.", "Unknown step 'xpto'."),
        409: R409("Shipment step before Confirm Shipping, or a Pre-loading step after it (admin only).", "Shipment steps open after Confirm Shipping (PATCH status 'in_transit')."),
        500: R500,
      },
    },
  },
};

export const restSchemas = {
  OrderPatch: {
    type: "object",
    description: "Any subset; at least one key. Unknown keys → 400.",
    properties: {
      schedule_requested: inDayNullable,
      client_reference: { type: ["string", "null"], maxLength: 200 },
      date_po: inDayNullable,
      client_gss_id: { type: ["string", "null"] },
      order_type_gss_id: { type: ["string", "null"] },
      business_unit_gss_id: { type: ["string", "null"] },
      exporter_gss_id: { type: ["string", "null"] },
      leader_email: emailInNullable,
      requester_email: emailInNullable,
      operational_responsible_email: emailInNullable,
    },
  },
  OrderItemRow: {
    type: "object",
    properties: {
      id: uuid,
      po_number: { type: ["string", "null"] },
      order_gss_id: { type: ["string", "null"] },
      batch_id: { type: ["string", "null"], format: "uuid" },
      batch: { type: ["string", "null"], description: "`.NN`; null = no batch." },
      batch_status: { type: ["string", "null"], enum: [...BATCH_STATUSES, null] },
      factory: { type: ["string", "null"] },
      factory_gss_id: { type: ["string", "null"] },
      category: { type: ["string", "null"] },
      category_gss_id: { type: ["string", "null"] },
      supplier_category_gss_id: { type: ["string", "null"] },
      ship_requirement: nullableDate,
      loading_status: { type: ["string", "null"], enum: ["total", "partial", "none", null] },
      created_at: instant,
      updated_at: instant,
    },
  },
  OrderItemCreate: {
    type: "object",
    required: ["supplier_category_gss_id", "ship_requirement"],
    description: "Exactly one of `order_gss_id` / `po_number`.",
    properties: {
      order_gss_id: { type: ["string", "integer"] },
      po_number: { type: "string" },
      supplier_category_gss_id: { type: ["string", "integer"] },
      ship_requirement: inDay,
      batch_id: { type: "string", description: "Batch UUID or `full_number` (`1230.02`)." },
    },
  },
  OrderItemUpdate: {
    type: "object",
    properties: {
      batch_id: { type: ["string", "null"], description: "Batch UUID or `full_number`; `null` = take out of its batch." },
      ship_requirement: inDay,
    },
  },
  EtdPatch: {
    type: "object",
    description: "At least one of `initial_date`, `current_date`, `ready_parts`.",
    properties: {
      initial_date: inDay,
      current_date: inDay,
      ready_parts: { type: "boolean" },
      remarks: { type: "string", maxLength: 2000, description: "Reason — required for a correction." },
    },
  },
  Shipment: {
    type: "object",
    properties: {
      id: { ...uuid, description: "Pre-loading id." },
      gss_id: { type: ["string", "null"], description: "GSS Shipment id." },
      pl_number: { type: ["integer", "null"] },
      status: { type: "string", enum: ["preloading", "in_transit", "delivered"] },
      batches: { type: "array", items: ref("PlBatchRef") },
      estimated_loading_date: { ...nullableDate, description: "Estimated date of the Loading Date step." },
      loading_date: { ...nullableDate, description: "Actual date of the Loading Date step." },
      ETD: { ...nullableDate, description: "Estimated date of the Shipping Date step." },
      ETA_Brazil: { ...nullableDate, description: "Estimated date of the ETA Brazil step." },
      ATA_Brazil: { ...nullableDate, description: "Actual date of the ATA Brazil step." },
      DELIVERED_DATE: { ...nullableDate, description: "Actual date of the Delivered step." },
      shipping_date: { ...nullableDate, description: "Actual date of the Shipping Date step." },
      created_at: instant,
      updated_at: { ...instant, description: "Latest of the PL and its shipment." },
    },
  },
  ShipmentCreate: {
    type: "object",
    required: ["clients", "client_reference", "pod", "leader_email"],
    properties: {
      gss_id: { type: ["string", "integer"], description: "GSS Shipment id — idempotency key." },
      clients: { type: "array", minItems: 1, items: ref2 },
      client_reference: { type: "string", maxLength: 200 },
      pod: ref2,
      leader_email: emailIn,
      responsible_signer_email: emailInNullable,
      batch_ids: { type: "array", items: { type: "string" }, description: "Batch UUIDs or `full_number`s." },
    },
  },
  ShipmentConfirm: {
    type: "object",
    required: [
      "container_number",
      "seal_number",
      "estimated_date",
      "loading_date_completed_on",
      "carrier",
      "shipment_model",
      "shipment_leader_email",
      "signer_email",
      "lines",
    ],
    properties: {
      container_number: { type: "string" },
      seal_number: { type: "string" },
      estimated_date: inDay,
      loading_date_completed_on: { ...inDay, description: "Completed on of the Loading Date step." },
      carrier: ref2,
      shipment_model: ref2,
      shipment_leader_email: emailIn,
      signer_email: emailIn,
      preloading_leader_email: { ...emailIn, description: "Default: the PL leader." },
      lines: {
        type: "array",
        description: "One entry per line of the PL's batches.",
        items: {
          type: "object",
          required: ["item_id", "loading_status"],
          properties: { item_id: uuid, loading_status: { type: "string", enum: ["total", "partial", "none"] } },
        },
      },
    },
  },
  ShipmentPatch: {
    type: "object",
    description: "Header keys, OR `status` (+ `confirm` for `in_transit`) alone.",
    properties: {
      gss_id: { type: ["string", "integer", "null"] },
      clients: { type: "array", minItems: 1, items: ref2 },
      client_reference: { type: "string", maxLength: 200 },
      pod: ref2,
      leader_email: emailIn,
      responsible_signer_email: emailInNullable,
      batch_ids: { type: "array", items: { type: "string" }, description: "The full set of batches." },
      status: { type: "string", enum: ["in_transit", "preloading"] },
      confirm: ref("ShipmentConfirm"),
    },
  },
  ShipmentStepPatch: {
    type: "object",
    description: "At least one key; step-specific keys only on their step.",
    properties: {
      estimated_date: inDayNullable,
      completed_on: inDayNullable,
      notes: { type: ["string", "null"] },
      responsible_email: emailInNullable,
      consolidation_point: refNullable,
      city: refNullable,
      pol: refNullable,
      carrier: refNullable,
      agent_brazil: refNullable,
      agent_china: refNullable,
      contact_brazil: refNullable,
      contact_china: refNullable,
      booking_number: { type: ["string", "null"], maxLength: 100 },
      cutoff_date: inDayNullable,
    },
  },
};
