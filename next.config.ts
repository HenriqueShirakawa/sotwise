import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita a inferência errada de workspace root (há um package-lock.json solto
  // no diretório home do usuário). Fixa a raiz neste projeto.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
