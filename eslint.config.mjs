import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Mini Program do WeChat: outro runtime (globais wx/App/Page), compilado
    // pelo 微信开发者工具, não pelo Next.
    "miniprogram/**",
  ]),
  // Tooling de migração (Bubble → Supabase): já cumpriu o papel e lida com
  // payloads dinâmicos do Bubble — `any` é tolerado aqui, não no código do app.
  {
    files: ["scripts/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
