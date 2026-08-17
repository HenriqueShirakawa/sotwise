/**
 * A lista de recursos do GSS mudou de casa: agora vive em `lib/gss/recursos.ts`
 * (imports relativos) para ser compartilhada com `scripts/sync-gss/snapshot.ts`,
 * que o `tsx` roda sem resolver o alias `@/`. Este arquivo só re-exporta para
 * não quebrar o import `./recursos` do painel.
 */
export { RECURSOS, type Recurso, type RecursoKey } from "@/lib/gss/recursos";
