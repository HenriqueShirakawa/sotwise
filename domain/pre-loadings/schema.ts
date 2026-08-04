import { z } from "zod";

/** UUID de FK opcional — aceita string uuid ou null (campo não preenchido). */
const optionalFk = z.string().uuid().nullable();

/**
 * Schema do Pre-loading (Create/Edit — o modal é o MESMO nos dois casos, ver
 * docs/regras_de_negocio.md §3.9.2/§3.9.3). `pl_number` e `created_date` são
 * auto-gerados e read-only no form, por isso não entram aqui: o número é
 * calculado no servidor na criação (unique no banco) e é imutável depois.
 *
 * Obrigatórios pelo Bubble: Client(s), Client(s) Reference, POD e Leader.
 */
export const preLoadingSchema = z.object({
  client_ids: z.array(z.string().uuid()).min(1, "Select at least one client."),
  client_reference: z
    .string()
    .trim()
    .min(1, "Client reference is required.")
    .max(200, "Reference is too long."),
  pod_id: z.string().uuid("Port of destination is required."),
  responsible_signer_id: optionalFk,
  leader_id: z.string().uuid("Leader is required."),
  batch_ids: z.array(z.string().uuid()),
});

export type PreLoadingInput = z.infer<typeof preLoadingSchema>;

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Como o ActionResult, mas devolve o id do registro criado — o form usa esse
 * id pra mandar o usuário direto pro checklist do novo PL. */
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };
