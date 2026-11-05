/**
 * Vínculo usuário do SOT ↔ WeChat. Na Service Account a pessoa é um OpenID
 * (opaco, por conta), que ninguém sabe digitar — então o vínculo é por QR:
 * o admin gera em Users → Edit um QR temporário com `scene = "bind:<profile>"`,
 * a pessoa escaneia com o WeChat e o callback grava o OpenID dela no profile.
 *
 * Só o SOT consegue gerar QR desta conta (precisa do access_token), então o
 * scene não é forjável; o QR vence em `BIND_QR_SECONDS`.
 */

export const BIND_QR_SECONDS = 600;

const PREFIX = "bind:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bindScene(profileId: string): string {
  return `${PREFIX}${profileId}`;
}

/**
 * EventKey do callback → profile a vincular. Quem ainda não segue a conta chega
 * por `subscribe` com "qrscene_<scene>"; quem já segue, por `SCAN` com "<scene>".
 */
export function profileIdFromEventKey(eventKey: string | null): string | null {
  if (!eventKey) return null;
  const scene = eventKey.startsWith("qrscene_") ? eventKey.slice("qrscene_".length) : eventKey;
  if (!scene.startsWith(PREFIX)) return null;
  const id = scene.slice(PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}
