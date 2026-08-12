"use client";

import { useCallback } from "react";

/**
 * Faz a roda do mouse rolar ESTE container mesmo quando ele está dentro de um
 * Radix Dialog.
 *
 * O scroll-lock do diálogo (`react-remove-scroll`) escuta `wheel` no documento
 * e chama `preventDefault` sempre que o alvo está fora da árvore do diálogo — e
 * o conteúdo de Popover/Select abre num portal no `body`, justamente fora dela.
 * Resultado: a listinha de busca não rolava com o mouse. Aqui a gente rola na
 * mão (setar `scrollTop` não é bloqueado por `preventDefault`) e barra o evento
 * antes que o lock o descarte.
 *
 * Devolve um callback ref: o listener entra quando o nó monta e sai quando
 * desmonta (limpeza de ref callback do React 19), então serve pra conteúdo que
 * abre e fecha, como o do Popover.
 */
export function useWheelScroll<T extends HTMLElement>() {
  return useCallback((node: T | null) => {
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      // Nada a rolar? Deixa o evento seguir (a página rola normalmente).
      if (node.scrollHeight <= node.clientHeight) return;
      node.scrollTop += e.deltaY;
      e.preventDefault();
      e.stopPropagation();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
}
