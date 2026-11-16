import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Testes unitários das regras PURAS (sem banco, sem rede): `npm test`.
 *
 * - `@/` aponta para a raiz, igual ao `paths` do tsconfig.
 * - `server-only` vira um módulo vazio: fora do runtime do Next ele lança erro
 *   no import, e vários módulos de regra o importam só para garantir que não
 *   vão parar no bundle do browser.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      { find: /^server-only$/, replacement: `${root}/test/server-only-stub.ts` },
    ],
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "miniprogram/**"],
    environment: "node",
    // As regras de data usam "hoje em São Paulo"; fixa o fuso do processo para
    // o resultado não depender da máquina (CI roda em UTC).
    env: { TZ: "America/Sao_Paulo" },
  },
});
