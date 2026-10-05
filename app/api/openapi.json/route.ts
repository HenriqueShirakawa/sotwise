import { openApiSpec } from "@/domain/api/openapi";

/**
 * GET /api/openapi.json — contrato OpenAPI 3.1 da API (domain/api/openapi.ts).
 *
 * Público de propósito: é documentação, não dado. Tudo que ele descreve
 * continua exigindo o token. O Swagger UI (/api/docs) lê daqui, e o GSS pode
 * importar a URL direto no Postman/Insomnia ou num gerador de client.
 */

export function GET(): Response {
  return Response.json(openApiSpec, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
