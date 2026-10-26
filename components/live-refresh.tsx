"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useEtdRealtime } from "@/lib/use-etd-realtime";
import { useOrdersRealtime } from "@/lib/use-orders-realtime";
import { usePreLoadingRealtime } from "@/lib/use-preloading-realtime";
import { useShipmentsRealtime } from "@/lib/use-shipments-realtime";

/**
 * Tela de DETALHE (Order, Pre-loading, Shipment) atualizada em tempo real
 * (26/10/2026, pedido do usuário: "as trocas de status deveriam ser real time —
 * eles ficam com essas telas abertas a tempos"). Até aqui só as listas
 * escutavam o Realtime; a tela de uma Order seguia mostrando o lote em
 * Pre-Loading depois que outro usuário confirmou o embarque.
 *
 * Escuta os quatro canais de ping (Orders, Pre-loading, Shipments, ETD), porque
 * um status de lote muda por qualquer um deles — o Confirm Shipping, por
 * exemplo, só avisa Shipments e Pre-loading quando o status da Order não muda.
 * Os pings não dizem o suficiente para filtrar com segurança (alguns vêm sem
 * id), então qualquer um refaz a página, com debounce: uma rajada de pings vira
 * um `router.refresh()` só. O refresh mantém o estado do cliente (popup aberto,
 * campo sendo digitado) — só os dados do servidor são relidos.
 */
export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 500);
  };

  useOrdersRealtime(schedule);
  usePreLoadingRealtime(schedule);
  useShipmentsRealtime(schedule);
  useEtdRealtime(schedule);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return null;
}
