import "server-only";

import type { BatchStatus } from "@/types/database";

/**
 * E-mail de avanço de lote para o cliente (Fase 2.1).
 *
 * Vocabulário travado com o negócio em 2026-08-18 — é PT-BR mesmo com a UI do
 * app em inglês, porque o destinatário aqui é o cliente brasileiro da AGK, não
 * o operador. E o texto fala de PRODUTO + número do pedido, nunca de "lote 04":
 * lote é unidade interna, e o cliente não tem como saber o que é.
 */
export const CLIENT_STATUS_LABEL: Partial<Record<BatchStatus, string>> = {
  in_production: "Em produção",
  preloading: "Pré-carregamento",
  in_transit: "Em trânsito",
  delivered: "Entregue",
};

/** Uma linha de contexto por estágio — o rótulo sozinho não diz o que mudou. */
const STATUS_BLURB: Partial<Record<BatchStatus, string>> = {
  in_production: "A fabricação foi iniciada.",
  preloading: "A carga está sendo preparada para embarque.",
  in_transit: "A carga embarcou e está a caminho.",
  delivered: "A entrega foi concluída.",
};

export type BatchAdvanceEmail = {
  clientName: string;
  poNumber: string;
  /** Produtos do lote (categorias). Vazio cai no texto genérico. */
  products: string[];
  status: BatchStatus;
  /** Link do portal. Sem ele o e-mail não ganha botão. */
  portalUrl?: string;
};

export function batchAdvanceSubject({ poNumber, status }: BatchAdvanceEmail): string {
  const label = CLIENT_STATUS_LABEL[status] ?? status;
  return `Pedido ${poNumber} — ${label}`;
}

export function batchAdvanceEmailHtml(data: BatchAdvanceEmail): string {
  const label = CLIENT_STATUS_LABEL[data.status] ?? data.status;
  const blurb = STATUS_BLURB[data.status] ?? "";

  // "os produtos X, Y e Z" / "o produto X" / "os itens" quando o lote não tem
  // entrada Factory × Category nenhuma (pedido em montagem).
  const names = data.products.filter((p) => p.trim()).map(escapeHtml);
  const subject =
    names.length === 0
      ? "Os itens"
      : names.length === 1
        ? `O produto <strong>${names[0]}</strong>`
        : `Os produtos <strong>${names.slice(0, -1).join("</strong>, <strong>")}</strong> e <strong>${names.at(-1)}</strong>`;

  const cta = data.portalUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:8px;background:#640BB7;">
                      <a href="${data.portalUrl}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Acompanhar meus pedidos
                      </a>
                    </td>
                  </tr>
                </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f4f2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2f8;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
            <tr>
              <td style="background:#640BB7;padding:24px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.5px;">SOTWISE</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#8b8698;">
                  Pedido ${escapeHtml(data.poNumber)}
                </p>
                <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1a1523;">${escapeHtml(label)}</p>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#4a4458;">
                  ${subject} do seu pedido ${escapeHtml(data.poNumber)} ${
                    names.length === 1 ? "avançou" : "avançaram"
                  } para <strong>${escapeHtml(label)}</strong>. ${escapeHtml(blurb)}
                </p>
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #eceaf1;">
                <p style="margin:0;font-size:12px;color:#a8a4b3;">
                  Você recebe este aviso porque acompanha os pedidos da
                  ${escapeHtml(data.clientName)} no portal da AGK.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
