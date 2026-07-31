"use server";

import {
  createSimpleNames,
  updateSimpleName,
  deleteSimple,
} from "@/domain/registration/simple-crud";
import type { ActionResult } from "@/domain/registration/schema";

const TABLE = "carriers" as const;
const PATH = "/registration/carriers";

export async function createCarriers(names: string[]): Promise<ActionResult> {
  return createSimpleNames(TABLE, PATH, names);
}

export async function updateCarrier(id: string, name: string): Promise<ActionResult> {
  return updateSimpleName(TABLE, PATH, id, name);
}

export async function deleteCarrier(id: string): Promise<ActionResult> {
  return deleteSimple(TABLE, PATH, id);
}
