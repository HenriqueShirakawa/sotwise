/**
 * GET /api/docs — Swagger UI da API, para o time do GSS ler e testar.
 *
 * Página estática que carrega o swagger-ui-dist do CDN (sem dependência no
 * bundle) e lê o contrato de /api/openapi.json. O "Authorize" guarda o token
 * só no navegador de quem testa (persistAuthorization → localStorage); o
 * "Try it out" chama a API DESTE ambiente com esse token — ou seja, escreve
 * de verdade.
 */

const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SOTWISE API</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
    .swagger-ui .info .title small.version-stamp { background: #640bb7; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: "list",
      defaultModelsExpandDepth: 0,
      tryItOutEnabled: false,
    });
  </script>
</body>
</html>`;

export function GET(): Response {
  return new Response(HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
