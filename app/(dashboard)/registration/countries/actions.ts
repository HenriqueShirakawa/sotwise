"use server";

import {
  createSimpleNames,
  updateSimpleName,
  deleteSimple,
} from "@/domain/registration/simple-crud";
import type { ActionResult } from "@/domain/registration/schema";

const TABLE = "countries" as const;
const PATH = "/registration/countries";

export async function createCountries(names: string[]): Promise<ActionResult> {
  return createSimpleNames(TABLE, PATH, names);
}

export async function updateCountry(id: string, name: string): Promise<ActionResult> {
  return updateSimpleName(TABLE, PATH, id, name);
}

export async function deleteCountry(id: string): Promise<ActionResult> {
  return deleteSimple(TABLE, PATH, id);
}
