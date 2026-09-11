import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita a inferência errada de workspace root (há um package-lock.json solto
  // no diretório home do usuário). Fixa a raiz neste projeto.
  turbopack: {
    root: import.meta.dirname,
  },
  experimental: {
    // ⚠️ Estes dois limites NÃO governam o upload de anexo: o arquivo vai
    // direto do browser pro Supabase Storage (lib/attachments.ts), porque a
    // Vercel corta o corpo de qualquer Serverless Function em 4,5MB
    // (FUNCTION_PAYLOAD_TOO_LARGE) — limite que nenhum config do Next altera.
    // Ficam com folga só pra Server Actions comuns não esbarrarem no default
    // (1MB / 10MB) por acidente.
    serverActions: {
      bodySizeLimit: "21mb",
    },
    proxyClientMaxBodySize: "21mb",
  },
};

export default nextConfig;
