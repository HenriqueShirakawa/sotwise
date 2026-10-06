import type { NextRequest } from "next/server";

import { requireApiFeature, requireApiSession } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastOrderStatusPing } from "@/lib/orders-realtime";
import { gssOrderSchema } from "@/domain/orders/gss-schema";
import { listGssOrders, parseGssOrderQuery } from "@/domain/orders/gss-read";
import { applyOrderItems, buildOrderFields } from "@/domain/orders/api-write";

/**
 * Via GSS ↔ SOTWISE de ORDERS. Mesmo path, mesmo token, dois sentidos:
 *
 *   POST /api/orders   → o GSS cria/atualiza uma order (push)
 *   GET  /api/orders   → o GSS lê as orders e o que virou delas (pull)
 *
 *   Authorization: Bearer $API_TOKEN
 *
 * Mesma auth do resto da API (`requireApiSession()`, lib/api-auth.ts): aceita
 * o token de serviço OU sessão de cookie de um usuário com permissão na
 * feature `orders`. Até 2026-09-10 isso vivia num secret dedicado
 * (`GSS_INBOUND_SECRET`), num path só do GSS (`/api/gss/orders`) — unificado
 * porque o GSS ainda não tinha implementado a chamada de Orders do lado
 * deles, então não havia tráfego de produção em risco na troca.
 *
 * O POST é a primeira via inbound da integração (o resto é pull: o SOTWISE puxa
 * as bibliotecas). Fluxo:
 *   1. Autoriza (token de serviço ou sessão + permissão `orders`).
 *   2. Valida o payload (domain/orders/gss-schema.ts).
 *   3. Resolve cada `*_gss_id` para o UUID interno da biblioteca.
 *   4. Upsert por `orders.gss_id` (idempotente: retry do GSS não duplica).
 *   5. O checklist NÃO é semeado aqui — o trigger `trg_orders_seed_checklist`
 *      (migration 20260824120000) cria as 10 etapas em todo INSERT de order.
 *   6. `items[]` (opcional) vira as linhas Factory×Category em
 *      `order_factory_category`: cada item traz o `gss_id` do supplier-category
 *      (→ `factory_products` → fábrica+categoria). As linhas nascem SEM lote
 *      (o usuário atribui depois). Não destrutivo: reenvio só ADICIONA pares
 *      novos, preservando o lote que o usuário já atribuiu.
 *
 * `po_number` vem do GSS e é unique no banco: colisão com um número já usado
 * (pela app ou por outra order) responde 409. `requester_id`/`leader_id`
 * apontam para `profiles` (usuários do SOTWISE, sem `gss_id`); o GSS os manda
 * por e-mail (`leader_email`/`requester_email`/`operational_responsible_email`),
 * resolvido para o id do profile via a função `public.profile_id_by_email`.
 * Ausentes → NULL. Os helpers moram em domain/orders/api-write.ts (também
 * usados pelo item REST, app/api/orders/[id]/route.ts).
 */

export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/**
 * Leitura das orders pelo GSS (pull). Sempre devolve uma LISTA — filtrar por
 * `?gss_id=` é o jeito de ler uma order específica, e a forma da resposta não
 * muda com o filtro (uma lista de 0 ou 1 item), o que simplifica o lado do GSS.
 *
 *   GET /api/orders?gss_id=&po_number=&status=&updated_since=&order=&limit=&offset=&include=items,checklist
 *
 * `updated_since` + `order=asc` é a varredura incremental: o GSS guarda o maior
 * `updated_at` que viu e pede só o que mudou desde então. Os blocos pesados
 * (`items`, `checklist`) só vêm se pedidos em `include`. Ver domain/orders/gss-read.ts.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const denied = requireApiFeature(auth.session, "orders", "view");
  if (denied) return denied;

  const parsed = parseGssOrderQuery(request.nextUrl.searchParams);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".");
    return json(
      {
        error: where ? `Invalid '${where}': ${issue?.message}` : (issue?.message ?? "Invalid query."),
        issues: parsed.error.issues,
      },
      400
    );
  }
  const query = parsed.data;

  // O token só-leitura de PO (consumidor externo) vê cabeçalho + items; o
  // checklist é operação interna e fica de fora.
  if (auth.session.tokenScope === "po_read" && query.include.includes("checklist")) {
    return json({ error: "include=checklist is not available for this token." }, 403);
  }

  const admin = createAdminClient();
  try {
    const { data, total } = await listGssOrders(admin, query);
    return json(
      {
        data,
        pagination: {
          limit: query.limit,
          offset: query.offset,
          returned: data.length,
          total,
        },
      },
      200
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Failed to list orders." }, 500);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  const denied = requireApiFeature(auth.session, "orders", "create");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = gssOrderSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input.", issues: parsed.error.issues },
      400
    );
  }
  const input = parsed.data;

  const admin = createAdminClient();

  const built = await buildOrderFields(admin, input);
  if (!built.ok) return json({ error: built.error }, 400);

  // Idempotência: existe order com esse gss_id? Reenvio atualiza; senão insere.
  const { data: existing, error: lookupError } = await admin
    .from("orders")
    .select("id")
    .eq("gss_id", input.gss_id)
    .maybeSingle();
  if (lookupError) return json({ error: lookupError.message }, 500);

  if (existing) {
    const updateRow: Record<string, unknown> = { ...built.fields };
    if (input.po_number !== undefined) updateRow.po_number = input.po_number;

    // Se o reenvio só trouxe itens (nada de cabeçalho nem po_number), não há
    // coluna para o SET — busca a order para devolver id/po_number sem um UPDATE
    // vazio (que o PostgREST rejeitaria).
    const { data, error } =
      Object.keys(updateRow).length > 0
        ? await admin
            .from("orders")
            .update(updateRow as never)
            .eq("id", existing.id)
            .select("id, po_number")
            .single()
        : await admin
            .from("orders")
            .select("id, po_number")
            .eq("id", existing.id)
            .single();
    if (error) {
      // Colisão de po_number com OUTRA order.
      if (error.code === "23505") {
        return json({ error: `po_number '${input.po_number}' is already in use.` }, 409);
      }
      return json({ error: error.message }, 500);
    }
    // Reenvio pode adicionar linhas Factory×Category novas (sem apagar as antigas).
    const items = await applyOrderItems(admin, data.id, input.items);
    if (!items.ok) return json({ error: items.error }, items.status);
    // Ping realtime: a lista Orders aberta atualiza sozinha (ex.: a order passa a
    // ser visível quando ganha a 1ª linha Factory×Category).
    await broadcastOrderStatusPing({ order_ids: [data.id] });
    return json({ data, created: false }, 200);
  }

  // A partir daqui é CRIAÇÃO: po_number é obrigatório para nascer a order.
  if (!input.po_number) {
    return json({ error: "po_number is required to create an order." }, 400);
  }

  // date_po default = hoje SÓ na criação (a UI de ETD mostra "—" sem ela).
  const createRow: Record<string, unknown> = {
    ...built.fields,
    gss_id: input.gss_id,
    po_number: input.po_number,
  };
  if (createRow.date_po === undefined) {
    createRow.date_po = new Date().toISOString().slice(0, 10);
  }
  const { data, error } = await admin
    .from("orders")
    .insert(createRow as never)
    .select("id, po_number")
    .single();
  if (error) {
    // Já checamos que o gss_id não existia; um 23505 aqui é colisão de po_number
    // (ou corrida de dois POSTs com o mesmo gss_id ao mesmo tempo).
    if (error.code === "23505") {
      return json(
        { error: `Conflict: po_number '${input.po_number}' or gss_id '${input.gss_id}' already exists.` },
        409
      );
    }
    return json({ error: error.message }, 500);
  }

  // O trigger trg_orders_seed_checklist já semeou as 10 etapas do checklist.
  // Agora as linhas Factory×Category (sem lote — o usuário atribui depois).
  const items = await applyOrderItems(admin, data.id, input.items);
  if (!items.ok) return json({ error: items.error }, items.status);

  // Ping realtime: se a order já nasceu com Factory×Category, aparece na lista
  // aberta sem F5 (a visibilidade da lista exige ≥1 linha — ver orders/page.tsx).
  await broadcastOrderStatusPing({ order_ids: [data.id] });

  return json({ data, created: true }, 201);
}
