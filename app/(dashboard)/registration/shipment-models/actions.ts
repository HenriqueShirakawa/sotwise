"use server";

import {
  createSimpleNames,
  updateSimpleName,
  deleteSimple,
} from "@/domain/registration/simple-crud";
import type { ActionResult } from "@/domain/registration/schema";

const TABLE = "shipment_models" as const;
const PATH = "/registration/shipment-models";

export async function createShipmentModels(names: string[]): Promise<ActionResult> {
  return createSimpleNames(TABLE, PATH, names);
}

export async function updateShipmentModel(id: string, name: string): Promise<ActionResult> {
  return updateSimpleName(TABLE, PATH, id, name);
}

export async function deleteShipmentModel(id: string): Promise<ActionResult> {
  return deleteSimple(TABLE, PATH, id);
}
