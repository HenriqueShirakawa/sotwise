"use server";

import { revalidatePath } from "next/cache";

import { requireFeature } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  clientSchema,
  type ActionResult,
  type ClientInput,
} from "@/domain/registration/schema";

const PATH = "/registration/clients";

export async function createClientRecord(
  input: ClientInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await requireFeature("registration", "create");

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  // `.select().single()` devolve o id novo — o form precisa dele para amarrar
  // usuários de portal ao cliente recém-criado (ver setClientUsers).
  const { data, error } = await admin
    .from("clients")
    .insert({
      name: parsed.data.name,
      country_id: parsed.data.country_id,
      language: parsed.data.language ?? null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create the client." };
  }

  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

export async function updateClientRecord(
  id: string,
  input: ClientInput
): Promise<ActionResult> {
  await requireFeature("registration", "edit");

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("clients")
    .update({
      name: parsed.data.name,
      country_id: parsed.data.country_id,
      language: parsed.data.language ?? null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Amarra/desamarra usuários de portal (papel `client`) a este cliente — a
 * mesma escrita em `profiles.client_id` que a tela Users já faz por lá
 * (`resolveRoleScope`), só que disparada do modal de Clients (§3.2.1). Por
 * isso a guarda é `users`/`edit`, não `registration`: quem não pode reatribuir
 * cliente na tela Users também não pode fazer isso por aqui.
 *
 * `userIds` é o estado final desejado — a diff contra quem hoje aponta para
 * este cliente decide quem entra (`client_id = clientId`) e quem sai
 * (`client_id = null`). Mover alguém de outro cliente para este também é
 * válido (é o mesmo efeito de trocar o Client no formulário de Users).
 */
export async function setClientUsers(
  clientId: string,
  userIds: string[]
): Promise<ActionResult> {
  await requireFeature("users", "edit");

  const admin = createAdminClient();

  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("name", "client")
    .maybeSingle();
  if (!role) return { ok: false, error: "Client role not found." };

  const { data: current, error: currentError } = await admin
    .from("profiles")
    .select("id")
    .eq("client_id", clientId);
  if (currentError) return { ok: false, error: currentError.message };

  const currentIds = new Set((current ?? []).map((p) => p.id));
  const nextIds = new Set(userIds);
  const toLink = userIds.filter((id) => !currentIds.has(id));
  const toUnlink = [...currentIds].filter((id) => !nextIds.has(id));

  if (toLink.length) {
    // Só papel `client` pode carregar client_id (mesma regra do resolveRoleScope)
    // — o picker do form já só oferece esses, isto cobre quem chamar a action direto.
    const { data: invalid, error: checkError } = await admin
      .from("profiles")
      .select("id")
      .in("id", toLink)
      .neq("role_id", role.id);
    if (checkError) return { ok: false, error: checkError.message };
    if (invalid?.length) {
      return { ok: false, error: "Only portal (client) users can be linked here." };
    }

    const { error } = await admin
      .from("profiles")
      .update({ client_id: clientId })
      .in("id", toLink);
    if (error) return { ok: false, error: error.message };
  }

  if (toUnlink.length) {
    const { error } = await admin
      .from("profiles")
      .update({ client_id: null })
      .in("id", toUnlink);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(PATH);
  revalidatePath("/users");
  return { ok: true };
}

export async function deleteClientRecord(id: string): Promise<ActionResult> {
  await requireFeature("registration", "delete");

  const admin = createAdminClient();
  const { error } = await admin
    .from("clients")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}
