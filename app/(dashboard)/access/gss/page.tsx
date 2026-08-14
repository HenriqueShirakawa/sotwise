import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireOwner } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { PageHeader } from "@/components/page-header";
import { gssGet } from "@/lib/gss/client";

import { GssClient, type GssRow, type LocalRow } from "./gss-client";
import { RECURSOS, type Recurso, type RecursoKey } from "./recursos";

/**
 * Painel de leitura do GSS — owner-only, mesma porta do /access
 * (`requireOwner`, não `requireFeature`: é ferramenta de diagnóstico da
 * integração, não função de operação).
 *
 * Mostra, lado a lado, o que existe no GSS e o que já está pareado aqui. Serve
 * para responder sem Postman as perguntas que aparecem toda hora: "isso está
 * chegando?", "por que a coluna gss_id está vazia?", "quantos casaram?".
 *
 * Busca só o recurso selecionado — ler os 14 de uma vez leva ~4s e a tela não
 * precisa disso.
 */
export default async function GssPanelPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  await requireOwner();
  const { r } = await searchParams;

  const key = (RECURSOS.some((x) => x.key === r) ? r : "city") as RecursoKey;
  // anotado como `Recurso`: o `as const` da lista estreita cada item ao seu
  // literal, e aí os opcionais somem do tipo da união.
  const recurso: Recurso = RECURSOS.find((x) => x.key === key)!;

  const admin = createAdminClient();

  // 1) o lado do GSS
  const resposta = await gssGet<Record<string, unknown>[]>(recurso.endpoint);
  const erro = resposta.ok ? null : resposta.error;
  const itens = resposta.ok ? resposta.data : [];

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

  const linhas: GssRow[] = itens.map((item) => {
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
  });

  // o nosso lado, cru — cada linha vira uma entrada da coluna direita
  const localRows: LocalRow[] = locais.map((l) => ({
    id: l.id,
    name: l.name,
    gssId: l.gss_id,
  }));

  return (
    <div>
      <PageHeader
        title="GSS — dados da origem"
        description="O que a API do GSS devolve agora, e o que já está pareado no nosso banco."
      >
        <Link
          href="/access"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
          Access
        </Link>
      </PageHeader>

      <GssClient
        recursoAtual={key}
        recursos={RECURSOS.map((x) => ({ key: x.key, label: x.label }))}
        rows={linhas}
        localRows={localRows}
        detalheLabel={recurso.detalheLabel}
        erro={erro}
      />
    </div>
  );
}
