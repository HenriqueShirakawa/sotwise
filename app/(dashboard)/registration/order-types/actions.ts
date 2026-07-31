"use server";

import {
  createSimpleNames,
  updateSimpleName,
  deleteSimple,
} from "@/domain/registration/simple-crud";
import type { ActionResult } from "@/domain/registration/schema";

const TABLE = "order_types" as const;
const PATH = "/registration/order-types";

export async function createOrderTypes(names: string[]): Promise<ActionResult> {
  return createSimpleNames(TABLE, PATH, names);
}

export async function updateOrderType(id: string, name: string): Promise<ActionResult> {
  return updateSimpleName(TABLE, PATH, id, name);
}

export async function deleteOrderType(id: string): Promise<ActionResult> {
  return deleteSimple(TABLE, PATH, id);
}
