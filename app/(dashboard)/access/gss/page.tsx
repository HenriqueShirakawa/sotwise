
import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/page-header";

import Link from "next/link";

import { GssClient, type GssRow, type LocalRow } from "./gss-client";
import { RECURSOS, type Recurso, type RecursoKey } from "./recursos";
import { SyncClient, type SyncTab } from "./sync-client";
import { loadSyncLog } from "./sync-log";

const TABS: { value: "cadastros" | SyncTab; label: string; href: string }[] = [
  { value: "cadastros", label: "Cadastros", href: "/access/gss" },
  { value: "orders", label: "Orders", href: "/access/gss?v=orders" },
  { value: "batches", label: "Lotes", href: "/access/gss?v=batches" },
];

/** Abas do topo: os cadastros (snapshot) e o log do cron de Orders e Lotes. */
function ParityTabs({ current }: { current: "cadastros" | SyncTab }) {
  return (
    <div className="mb-4 flex gap-1 border-b">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2 text-sm ${
            current === t.value
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

const HEADER = {
  title: "GSS parity",
  description: "Espelho da resposta da API do GSS (snapshot), lado a lado com o que já está pareado no nosso banco.",
};

/**
 * Painel de leitura do GSS — owner-only, mesma porta do /access
 * (`requireOwner`, não `requireFeature`: é ferramenta de diagnóstico da
 * integração, não função de operação).
 *
 * Mostra, lado a lado, o que existe no GSS e o que já está pareado aqui. Serve
 * para responder sem Postman as perguntas que aparecem toda hora: "isso está
 * chegando?", "por que a coluna gss_id está vazia?", "quantos casaram?".
 *
 * Lê o SNAPSHOT (`gss_snapshot`), não o GSS ao vivo: o Cloudflare do GSS
 * desafia o IP da Vercel (§9.9). O espelho é gerado de máquina allowlistada por
 * `scripts/sync-gss/snapshot.ts`. Por isso a tela mostra o carimbo de quando a
 * foto foi tirada.
 *
 * As abas Orders e Lotes (`?v=`) mostram o log do cron de Orders e Lotes
 * (`gss_sync_log`, ver ./sync-log.ts).
 */
export default async function GssPanelPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; v?: string; f?: string; q?: string }>;
}) {
  await requireOwner();
  const { r, v, f, q } = await searchParams;

  if (v === "orders" || v === "batches") {
    const log = await loadSyncLog(createAdminClient(), {
      tab: v,
      onlyProblems: f === "problemas",
      search: (q ?? "").trim(),
    });
    return (
      <div>
        <PageHeader {...HEADER} />
        <ParityTabs current={v} />
        <SyncClient {...log} />
      </div>
    );
  }

  const key = (RECURSOS.some((x) => x.key === r) ? r : "city") as RecursoKey;
  // anotado como `Recurso`: o `as const` da lista estreita cada item ao seu
  // literal, e aí os opcionais somem do tipo da união.
  const recurso: Recurso = RECURSOS.find((x) => x.key === key)!;

  const admin = createAdminClient();

  // 1) o lado do GSS — lido do SNAPSHOT, não ao vivo (§9.9: Cloudflare barra a
  //    Vercel). O carimbo e o resultado da última geração vêm de gss_snapshot_runs.
  const snapRows = await fetchAll<{ gss_id: number; payload: Record<string, unknown> }>(
    (from, to) =>
      admin
        .from("gss_snapshot")
        .select("gss_id, payload")
        .eq("resource", key)
        .order("gss_id")
        .range(from, to)
        .returns<{ gss_id: number; payload: Record<string, unknown> }[]>()
  );
  const itens = snapRows.map((s) => s.payload);

  const { data: run } = await admin
    .from("gss_snapshot_runs")
    .select("fetched_at, ok, error")
    .eq("resource", key)
    .maybeSingle();

  // Erro "duro" (banner + coluna vazia) só quando NUNCA houve snapshot deste
  // recurso: aí não há o que mostrar e o operador precisa rodar o gerador. Se já
  // existe espelho, mostramos ele mesmo que a última tentativa tenha falhado — o
  // aviso de falha vai no carimbo (prop `snapshot`).
  const erro =
    !run && snapRows.length === 0
      ? "Snapshot ainda não foi gerado. Rode `npx tsx scripts/sync-gss/snapshot.ts` de uma máquina allowlistada — o Cloudflare do GSS bloqueia a Vercel (ver INTEGRACAO_GSS §9.9)."
      : null;
  const snapshot = run
    ? { fetchedAt: run.fetched_at, ok: run.ok, error: run.error }
    : null;

  // 2) o nosso lado, para dizer quem já está pareado
  const locais = await fetchAll<{ id: string; name: string; gss_id: string | null }>(
    (from, to) =>
      admin
        .from(recurso.table)
        .select("id, name, gss_id")
        .is("deleted_at", null)
        .order("name")
        .range(from, to)
        .returns<{ id: string; name: string; gss_id: string | null }[]>()
  );
  const porGssId = new Map(locais.filter((l) => l.gss_id).map((l) => [l.gss_id!, l]));

  const linhas: GssRow[] = itens
    .map((item) => {
      const id = String(item.id ?? "");
      const par = porGssId.get(id);
      return {
        gssId: id,
        nome: String(item[recurso.campoNome] ?? "—"),
        detalhe: recurso.campoDetalhe
          ? (item[recurso.campoDetalhe] as string | null) || null
          : null,
        pareadoCom: par?.name ?? null,
      };
    })
    // Ordena por nome (igual ao lado direito, que vem `.order("name")` do banco);
    // o snapshot chega por gss_id. `base`: ignora acento e caixa.
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

  // o nosso lado, cru — cada linha vira uma entrada da coluna direita
  const localRows: LocalRow[] = locais.map((l) => ({
    id: l.id,
    name: l.name,
    gssId: l.gss_id,
  }));

  return (
    <div>
      <PageHeader {...HEADER} />
      <ParityTabs current="cadastros" />

      <GssClient
        recursoAtual={key}
        recursos={RECURSOS.map((x) => ({ key: x.key, label: x.label })).sort((a, b) =>
          a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" })
        )}
        rows={linhas}
        localRows={localRows}
        detalheLabel={recurso.detalheLabel}
        erro={erro}
        snapshot={snapshot}
      />
    </div>
  );
}
