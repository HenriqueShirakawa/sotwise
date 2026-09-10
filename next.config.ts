import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Evita a inferência errada de workspace root (há um package-lock.json solto
  // no diretório home do usuário). Fixa a raiz neste projeto.
  turbopack: {
    root: import.meta.dirname,
  },
  experimental: {
    serverActions: {
      // Default do Next é 1MB — os uploads de anexo (Order/Pre-loading/
      // Shipment, `MAX_FILE_BYTES`) já validam até 20MB no código, mas sem
      // isto o pedido nem chega na action pra essa validação rodar: falha
      // antes, como erro de rede cru (não um toast). Folga sobre os 20MB
      // cobre o overhead do multipart (boundaries/headers dos campos).
      bodySizeLimit: "21mb",
    },
    // Limite SEPARADO do de cima: o `proxy.ts` (ex-middleware) roda em toda
    // request e o Next bufferiza o corpo pra ele poder lê-lo — default 10MB.
    // Passar disso trunca o multipart ANTES da Server Action, virando "Error:
    // Unexpected end of form" em vez do toast de "File is larger than 20MB".
    // Descoberto testando upload de 11MB (só o bodySizeLimit acima não bastou).
    proxyClientMaxBodySize: "21mb",
  },
};

export default nextConfig;
