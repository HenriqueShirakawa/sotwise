/**
 * `business_units.icon_path` convive com dois formatos:
 *  - **legado da migração** — URL absoluta do CDN do Bubble (`//...cdn.bubble.io/...`),
 *    que ainda não foi trazida para o Storage (pendência §12.8);
 *  - **novo** — path dentro do bucket `business-units`, que precisa de URL assinada.
 * Editar a BU e subir uma imagem nova converte o registro do primeiro para o segundo.
 */
export function isExternalIcon(iconPath: string): boolean {
  return iconPath.startsWith("http://") || iconPath.startsWith("https://") || iconPath.startsWith("//");
}

/** URL exibível para o ícone legado (o Bubble serve protocol-relative). */
export function externalIconUrl(iconPath: string): string {
  return iconPath.startsWith("//") ? `https:${iconPath}` : iconPath;
}
