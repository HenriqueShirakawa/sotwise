# SOTWISE — Purchase Orders API (read-only)

Reference for consuming **Purchase Order (PO)** data from SOTWISE.

This integration is **read-only**. Your token can only **read** purchase orders. It cannot create, change or delete anything, and every other part of the API returns `403 Forbidden`.

| | |
|---|---|
| **Base URL** | `https://sot.gssdatahub.com` |
| **Endpoint** | `GET /api/orders` |
| **Format** | JSON (UTF-8) |
| **Transport** | Server-to-server over HTTPS. There is no CORS, so browser calls from another origin are blocked. |

---

## 1. Authentication

Send your token in the `Authorization` header on every request. It must start with `Bearer` followed by a space:

```
Authorization: Bearer <YOUR_TOKEN>
```

- The SOTWISE team gives you the token through a private channel. Keep it on your server only. Never put it in front-end code, a URL or a public repository.
- If the token leaks, tell the SOTWISE team. We will revoke it and issue a new one.
- A missing or wrong token returns `401` with a JSON body. The API never redirects to a login page.

---

## 2. Reading purchase orders — `GET /api/orders`

```
GET https://sot.gssdatahub.com/api/orders
Authorization: Bearer <YOUR_TOKEN>
```

The response is **always a list**, even when you filter down to one order, so the shape never changes with the filter.

### 2.1. Query parameters (all optional)

| Parameter | Values | Default | Purpose |
|---|---|---|---|
| `po_number` | PO number (exact) | — | Read one specific order |
| `status` | see [§3.1](#31-order-status) | — | Filter by order phase |
| `updated_since` | ISO 8601 with timezone, e.g. `2026-09-01T00:00:00Z` | — | Only orders changed since that moment (incremental sync) |
| `order` | `asc` \| `desc` (sorted by `updated_at`) | `desc` | Use `asc` to walk forward in time |
| `limit` | 1–200 | 50 | Page size |
| `offset` | ≥ 0 | 0 | Page offset |
| `include` | `items` | empty | Also return the order lines (Factory × Category). See [§2.4](#24-includeitems--order-lines) |
| `gss_id` | GSS order id | — | Read an order by its GSS id. Only needed if you already work with GSS ids |

Unknown parameters are ignored. An invalid value returns `400`, and `issues[]` names the parameter.

> `include=checklist` is **not available** for this token and returns `403`.

### 2.2. Recommended usage — incremental sync

1. **Initial load:** page through everything, oldest first:
   `GET /api/orders?order=asc&limit=200&offset=0`, then `offset=200`, `offset=400`, … Stop when `pagination.returned < limit`.
2. **Store the highest `updated_at`** you received.
3. **Afterwards, fetch only what changed:**
   `GET /api/orders?updated_since=<stored updated_at>&order=asc&limit=200`
   Page with `offset` the same way, then update the stored value.

Results are sorted by `updated_at` and then by `id`. The `id` breaks ties, so no order is skipped or repeated across pages.

`updated_since` includes the boundary, so the last order from the previous run can come back once. Upsert by `id` and the duplicate is harmless.

> **Important: `updated_since` tracks the order itself, not its lines.** An order's `updated_at` changes when a header field or the order `status` changes. It does **not** change when only a line changes: a batch is assigned, `loading_status` changes, a line is added, or a batch changes status without changing the order status. If you use `include=items`, also run a **periodic full refresh of the lines**, for example once a day, walking all orders with `include=items`. To keep it small, run it once per active status (`status=in_production`, `status=pre_loading`, …) and skip `delivered` and `canceled`.

Please keep polling reasonable. Every 15–30 minutes is plenty for this data.

### 2.3. Response `200`

```jsonc
{
  "data": [
    {
      "id": "93cc8b37-1ace-43ca-a391-009e0640ffd0",   // SOTWISE internal id (UUID) — stable, use as primary key
      "gss_id": null,                                 // GSS order id (null if the order was created in SOTWISE)
      "po_number": "1530",
      "status": "partially_shipped",
      "asap": false,
      "schedule_requested": "2026-08-24",
      "client_reference": "113-26",
      "date_po": "2026-08-03",
      "order_type":    { "id": "1364838b-…", "name": "Sales",      "gss_id": "1"  },
      "client":        { "id": "d23e27e0-…", "name": "Impacto",    "gss_id": "28" },
      "business_unit": { "id": "f706396a-…", "name": "Moto Parts", "gss_id": "4"  },
      "exporter":      { "id": "bb07d9fa-…", "name": "Zenya",      "gss_id": "4"  },
      "leader":    { "id": "4b2b1608-…", "name": "Leonardo Pacce" },
      "requester": { "id": "4b2b1608-…", "name": "Leonardo Pacce" },
      "created_at": "2026-08-03T05:39:27.561+00:00",
      "updated_at": "2026-09-17T18:45:00.771298+00:00"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "returned": 1, "total": 71 }
}
```

#### Order fields

| Field | Type | Description |
|---|---|---|
| `id` | UUID | SOTWISE internal id. Stable and unique. **Use it as your primary key.** |
| `gss_id` | string \| null | Order id in GSS (the master-data system). `null` when the order was created directly in SOTWISE. |
| `po_number` | string | Purchase order number. Unique in SOTWISE. |
| `status` | enum | Current phase of the order. See [§3.1](#31-order-status). |
| `asap` | boolean | Urgency flag ("as soon as possible"). |
| `schedule_requested` | date \| null | Requested schedule date. |
| `client_reference` | string \| null | Customer's own reference for the order. |
| `date_po` | date \| null | PO issue date. |
| `order_type` | object \| null | `{ id, name, gss_id }`, e.g. Sales. |
| `client` | object \| null | `{ id, name, gss_id }`, the customer. |
| `business_unit` | object \| null | `{ id, name, gss_id }` |
| `exporter` | object \| null | `{ id, name, gss_id }` |
| `leader` | object \| null | `{ id, name }`, the SOTWISE user who leads the order. |
| `requester` | object \| null | `{ id, name }`, the SOTWISE user who requested it. |
| `created_at` | timestamp | When the order was created in SOTWISE (ISO 8601, UTC). |
| `updated_at` | timestamp | Last change to the order. This is the field `updated_since` filters on. |

- Master-data objects (`order_type`, `client`, `business_unit`, `exporter`, and `factory`/`category` in the lines) carry the SOTWISE `id`, the display `name` and the `gss_id`. `gss_id: null` means that record is not linked to GSS yet.
- Any field can be `null` when it has not been filled in.
- `total` counts every order that matches the filter, ignoring pagination. `returned` is the size of this page.

### 2.4. `include=items` — order lines

`GET /api/orders?include=items` adds an `items` array to each order. Each line is one **Factory × Category** product of the order:

```jsonc
"items": [
  {
    "id": "18bd96d0-dd15-41a3-9f87-983603eeb8e3",
    "factory":  { "id": "a40b67d9-…", "name": "Pengjie", "gss_id": "453" },
    "category": { "id": "28a8872e-…", "name": "Sealing", "gss_id": "34"  },
    "ship_requirement": "2026-08-24",
    "loading_status": null,
    "batch": { "id": "0a69b3c4-…", "batch_number": ".02", "status": "in_production" }
  }
]
```

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Line id. |
| `factory` | object \| null | `{ id, name, gss_id }`, the supplier factory. |
| `category` | object \| null | `{ id, name, gss_id }`, the product category. |
| `ship_requirement` | date \| null | Required ship date for this line. |
| `loading_status` | enum \| null | How much of the line was loaded: `total`, `partial`, `none`, or `null` (not informed yet). |
| `batch` | object \| null | The batch the line was grouped into: `{ id, batch_number, status }`. `null` means no batch yet. See [§3.2](#32-batch-status). |

- `batch_number` (format `.NN`) is **only unique inside its order**, because numbering restarts for each order. To identify a batch globally, use `batch.id` or the pair `po_number` + `batch_number`.
- `items` adds extra database work. For a light sync, request it only when you need the lines. It is also always safe to fetch the lines of one order with `?po_number=…&include=items`.

---

## 3. Reference values

### 3.1. Order status

Listed in the normal lifecycle order:

| Value | Meaning |
|---|---|
| `in_negotiation` | Order opened and under negotiation. |
| `in_production` | Confirmed; the factories are producing. |
| `partially_preloading` | Some of the order's batches are in pre-loading. |
| `pre_loading` | All batches are in pre-loading (being prepared for shipping). |
| `partially_shipped` | Some batches have shipped. |
| `shipped` | All batches have shipped. |
| `partially_delivered` | Some batches have been delivered. |
| `delivered` | Fully delivered. |
| `canceled` | Order canceled. |

The order status is derived from the statuses of its batches.

### 3.2. Batch status

| Value | Meaning |
|---|---|
| `in_negotiation` | Under negotiation. |
| `in_production` | In production. |
| `preloading` | In pre-loading. |
| `in_transit` | Shipped and in transit. |
| `delivered` | Delivered. |
| `canceled` | Canceled. |

### 3.3. Data formats

| Kind | Format | Example |
|---|---|---|
| Date | `YYYY-MM-DD` | `2026-08-24` |
| Timestamp | ISO 8601 with offset (UTC) | `2026-09-17T18:45:00.771298+00:00` |
| Id | UUID v4 | `93cc8b37-1ace-43ca-a391-009e0640ffd0` |

---

## 4. Errors

Every error returns a JSON body `{ "error": "message" }`. Validation errors also include `issues[]`, which lists each problem and the field it affects.

| Code | When | What to do |
|---|---|---|
| `200` | Success, including when nothing matches (`data: []`, `total: 0`). There is no `404` for an empty filter. | — |
| `400` | Invalid query parameter: `status` not in the list, unknown `include`, `limit > 200`, `updated_since` not ISO 8601, etc. | Fix the request. |
| `401` | Missing token, wrong token, or missing `Bearer ` prefix. | Check the header. |
| `403` | Your token is valid but not allowed to do this, e.g. `include=checklist`, a `POST`, or any endpoint other than `GET /api/orders`. | Stick to the scope of this document. |
| `500` | Unexpected error on the SOTWISE side. | Retry later with backoff. If it keeps happening, report it to the SOTWISE team with the `error` message. |

Examples:

```jsonc
// 400
{ "error": "Invalid 'status': Invalid option: expected one of \"in_negotiation\"|…", "issues": [ … ] }

// 401
{ "error": "Invalid token" }

// 403
{ "error": "include=checklist is not available for this token." }
```

> General rule: a **4xx** means review what you sent, and repeating the same call will not help. A **5xx** means the problem is on our side.

---

## 5. Quick test (cURL)

```bash
# Latest 5 orders
curl -s "https://sot.gssdatahub.com/api/orders?limit=5" \
  -H "Authorization: Bearer $SOTWISE_TOKEN"

# One PO with its lines
curl -s "https://sot.gssdatahub.com/api/orders?po_number=1530&include=items" \
  -H "Authorization: Bearer $SOTWISE_TOKEN"

# Incremental: what changed since a given moment
curl -s "https://sot.gssdatahub.com/api/orders?updated_since=2026-09-01T00:00:00Z&order=asc&limit=200" \
  -H "Authorization: Bearer $SOTWISE_TOKEN"
```

---

## 6. Notes

- **Deleted orders do not appear.** If an order you synced stops coming back when you query it directly by `po_number`, it was removed in SOTWISE.
- **Scope may grow.** Other data, such as pre-loadings and shipments, may be opened later on the same base URL with the same token. The fields documented here will not change meaning. New fields may be added, so ignore any field you do not recognize.
- **Contact:** questions, a new token, or incident reports go to the SOTWISE team.
