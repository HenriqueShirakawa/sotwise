/**
 * Dispara o download de uma URL no browser sem abrir uma aba em branco.
 *
 * O `window.open(url, "_blank")` que usávamos abria uma aba nova e, para os
 * tipos que o browser não renderiza inline (a maioria dos anexos), ela ficava
 * em branco em vez de baixar. Um `<a>` clicado programaticamente baixa na
 * própria aba. Para isso funcionar, a URL PRECISA vir com
 * `Content-Disposition: attachment` — as signed URLs do Storage recebem isso
 * via a opção `{ download }` no `createSignedUrl` (o atributo `download` do
 * anchor é ignorado em URLs de outra origem).
 */
export function triggerDownload(url: string, fileName?: string | null) {
  const a = document.createElement("a");
  a.href = url;
  if (fileName) a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
