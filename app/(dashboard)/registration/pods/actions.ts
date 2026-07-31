"use server";

import {
  createSimpleNames,
  updateSimpleName,
  deleteSimple,
} from "@/domain/registration/simple-crud";
import type { ActionResult } from "@/domain/registration/schema";

const TABLE = "pods" as const;
const PATH = "/registration/pods";

export async function createPods(names: string[]): Promise<ActionResult> {
  return createSimpleNames(TABLE, PATH, names);
}

export async function updatePod(id: string, name: string): Promise<ActionResult> {
  return updateSimpleName(TABLE, PATH, id, name);
}

export async function deletePod(id: string): Promise<ActionResult> {
  return deleteSimple(TABLE, PATH, id);
}
