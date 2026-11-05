/**
 * Aviso por template (模板消息) — o que vai quando a pessoa está fora da janela
 * de 48h e o WeChat não aceita texto livre.
 *
 * O template é escolhido no painel da Service Account (广告与服务 → 模板消息),
 * e cada um tem seus campos (`thing1`, `character_string2`, `time3`...). Por
 * isso o mapeamento vem de env, sem deploy para trocar:
 *
 *   WECHAT_TEMPLATE_FIELDS="thing1=author,character_string2=record,thing3=body,time4=time"
 *
 * Valores disponíveis: author, record, client, body, reply, time.
 *
 * Os campos do template têm limite pelo tipo (thing ≤ 20 caracteres etc.) e o
 * WeChat recusa o envio se passar. O aviso é só uma chamada — o texto inteiro
 * está no link "abrir no SOT" e chega completo assim que a pessoa responde
 * (abre a janela de 48h). Por isso aqui o valor é encurtado com "…".
 */

export type TemplateValues = {
  author: string;
  record: string;
  client: string;
  body: string;
  reply: string;
  time: string;
};

const VALUE_KEYS = new Set<keyof TemplateValues>(["author", "record", "client", "body", "reply", "time"]);

/** Limite por tipo de campo do WeChat. Campo sem tipo conhecido (测试号): sem corte. */
const LIMITS: [RegExp, number][] = [
  [/^thing\d+$/, 20],
  [/^character_string\d+$/, 32],
  [/^number\d+$/, 32],
  [/^letter\d+$/, 32],
  [/^name\d+$/, 10],
  [/^phrase\d+$/, 5],
];

function fit(key: string, value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  const limit = LIMITS.find(([re]) => re.test(key))?.[1];
  if (!limit) return oneLine;
  const chars = [...oneLine];
  return chars.length <= limit ? oneLine : `${chars.slice(0, limit - 1).join("")}…`;
}

/** "thing1=author,character_string2=record" → [["thing1","author"], ...]. Inválido → null. */
export function parseTemplateFields(spec: string | undefined): [string, keyof TemplateValues][] | null {
  if (!spec?.trim()) return null;
  const pairs: [string, keyof TemplateValues][] = [];
  for (const part of spec.split(",")) {
    const [key, value] = part.split("=").map((s) => s.trim());
    if (!key || !value || !VALUE_KEYS.has(value as keyof TemplateValues)) return null;
    pairs.push([key, value as keyof TemplateValues]);
  }
  return pairs.length ? pairs : null;
}

export function templateData(
  fields: [string, keyof TemplateValues][],
  values: TemplateValues
): Record<string, string> {
  return Object.fromEntries(fields.map(([key, value]) => [key, fit(key, values[value] || "—")]));
}
