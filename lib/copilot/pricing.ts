/**
 * Preço de tabela da Anthropic para o modelo da SIA (`claude-haiku-5-5`), em
 * US$ por milhão de tokens, para pergunta de até 100 mil tokens — sempre o caso
 * da SIA; acima disso o preço sobe 5x. Mostrado na tela /access/sia (pedido do
 * usuário em 04/11/2026). Trocar aqui se o modelo ou o preço mudar.
 */
export const COPILOT_PRICE_PER_MILLION = {
  input: 0.1,
  output: 0.5,
  cacheRead: 0.01,
  cacheWrite: 0.125,
} as const;

/** Faixa medida em 03/11/2026: 10 mil tokens de pergunta real da SIA. */
export const COPILOT_TYPICAL_PER_10K = { min: 0.0003, max: 0.0008 } as const;

/** Câmbio só de referência para a coluna em reais. */
export const BRL_PER_USD = 5.5;
