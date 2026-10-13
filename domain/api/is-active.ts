import { z } from "zod";

/**
 * `is_active` (2026-10-13) nos recursos operacionais da API (lotes, linhas
 * Factory×Category, ETD, PL/Shipment). É SÓ uma marca: inativo continua
 * listado e nas telas, nenhuma regra muda — exclusão segue sendo o DELETE /
 * `deleted_at`. As bibliotecas usam o equivalente em domain/api/registry.ts.
 */

/** No corpo de POST/PATCH: opcional; ausente = coluna intocada (no insert, default true). */
export const isActiveBody = z.boolean({ error: "is_active must be a boolean." });

/** Filtro `?is_active=true|false` dos GET de coleção; ausente = sem filtro. */
export const isActiveQuery = z
  .enum(["true", "false"], { error: "is_active must be 'true' or 'false'." })
  .transform((v) => v === "true");
