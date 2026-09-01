/**
 * Copia o STORAGE de um projeto Supabase para outro (origem → destino).
 *
 * Por que existe: o `pg_dump` leva o banco, mas os ARQUIVOS do Storage moram no
 * object storage (S3), fora do Postgres. As linhas de `storage.objects` sozinhas
 * apontariam para arquivos que não existem no destino. Então aqui copiamos pela
 * API: baixa da origem, sobe no destino. As linhas de `storage.objects` são
 * criadas pelo próprio upload — por isso o dump do banco NÃO deve incluir o
 * schema `storage` (ver docs/MIGRACAO_SUPABASE_CLIENTE.md).
 *
 * Seguro de repetir: usa `upsert`, então rodar de novo só sobrescreve.
 * O app referencia arquivo por PATH (`step_attachments.file_path`,
 * `business_units.icon_path`), nunca pelo id da linha em `storage.objects` —
 * por isso ids/owner diferentes no destino não quebram nada.
 *
 *   npx tsx scripts/migrate-project/copy-storage.ts             # copia tudo
 *   npx tsx scripts/migrate-project/copy-storage.ts --dry-run   # só lista
 *   npx tsx scripts/migrate-project/copy-storage.ts order-documents
 *
 * Lê as credenciais dos DOIS projetos de `.env.migracao` (gitignored):
 *   SRC_SUPABASE_URL / SRC_SERVICE_ROLE_KEY
 *   DST_SUPABASE_URL / DST_SERVICE_ROLE_KEY
 */
import { config } from "dotenv";
config({ path: ".env.migracao" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name} (ver .env.migracao)`);
  return v;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const somenteBuckets = args.filter((a) => !a.startsWith("--"));

const src = createClient(required("SRC_SUPABASE_URL"), required("SRC_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

// No --dry-run só olhamos a origem — dá para inventariar antes de o destino existir.
const dst: SupabaseClient = dryRun
  ? src
  : createClient(required("DST_SUPABASE_URL"), required("DST_SERVICE_ROLE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

const PAGINA = 100;

/** Lista recursiva de um bucket: o Storage devolve "pastas" como entradas sem id. */
async function listarArquivos(
  client: SupabaseClient,
  bucket: string,
  prefixo = ""
): Promise<string[]> {
  const encontrados: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefixo, { limit: PAGINA, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefixo}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const item of data) {
      const caminho = prefixo ? `${prefixo}/${item.name}` : item.name;
      if (item.id === null) {
        encontrados.push(...(await listarArquivos(client, bucket, caminho)));
      } else {
        encontrados.push(caminho);
      }
    }

    if (data.length < PAGINA) break;
    offset += PAGINA;
  }

  return encontrados;
}

async function main() {
  const { data: buckets, error } = await src.storage.listBuckets();
  if (error) throw new Error(`listBuckets (origem): ${error.message}`);
  if (!buckets?.length) {
    console.log("Origem não tem nenhum bucket. Nada a fazer.");
    return;
  }

  const alvo = somenteBuckets.length
    ? buckets.filter((b) => somenteBuckets.includes(b.name))
    : buckets;

  const { data: existentes } = dryRun ? { data: [] } : await dst.storage.listBuckets();
  const jaExiste = new Set((existentes ?? []).map((b) => b.name));

  let totalArquivos = 0;
  let totalErros = 0;

  for (const bucket of alvo) {
    // 1) o bucket em si (público/privado e limites precisam bater com a origem)
    if (!jaExiste.has(bucket.name)) {
      console.log(`\n[bucket] criando "${bucket.name}" (public=${bucket.public})`);
      if (!dryRun) {
        const { error: errCriar } = await dst.storage.createBucket(bucket.name, {
          public: bucket.public,
          fileSizeLimit: bucket.file_size_limit ?? undefined,
          allowedMimeTypes: bucket.allowed_mime_types ?? undefined,
        });
        if (errCriar) throw new Error(`createBucket ${bucket.name}: ${errCriar.message}`);
      }
    } else {
      console.log(`\n[bucket] "${bucket.name}" já existe no destino`);
    }

    // 2) os arquivos
    const arquivos = await listarArquivos(src, bucket.name);
    console.log(`[bucket] ${bucket.name}: ${arquivos.length} arquivo(s)`);

    for (const [i, caminho] of arquivos.entries()) {
      if (dryRun) {
        console.log(`  · ${caminho}`);
        continue;
      }

      const { data: blob, error: errDownload } = await src.storage
        .from(bucket.name)
        .download(caminho);
      if (errDownload || !blob) {
        console.error(`  ✗ download ${bucket.name}/${caminho}: ${errDownload?.message}`);
        totalErros++;
        continue;
      }

      const { error: errUpload } = await dst.storage
        .from(bucket.name)
        .upload(caminho, blob, { upsert: true, contentType: blob.type || undefined });
      if (errUpload) {
        console.error(`  ✗ upload ${bucket.name}/${caminho}: ${errUpload.message}`);
        totalErros++;
        continue;
      }

      totalArquivos++;
      if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${arquivos.length}`);
    }
  }

  console.log(
    `\nFim. ${totalArquivos} arquivo(s) copiado(s)${totalErros ? `, ${totalErros} erro(s)` : ""}.`
  );
  if (totalErros) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
