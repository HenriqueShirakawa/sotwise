import type { BatchStatus, OrderStatus } from "@/types/database";

/**
 * Textos do portal do cliente em 4 línguas (Portal v2, bloco D — card Notion
 * "Fase 2.3 - Portal do Cliente"). Só o PORTAL; as telas internas seguem em
 * inglês. Dado digitado (categoria, tipo de pedido, referência) não é
 * traduzido — é texto do banco.
 *
 * Idioma inicial = o mesmo dos e-mails do cliente (`clients.language` →
 * `country_language_defaults` → en); a escolha no seletor fica salva no
 * usuário (`profiles.ui_preferences.portal_locale`). Ver domain/client/locale.ts.
 *
 * Arquivo sem "server-only": o mesmo dicionário serve às telas de servidor e às
 * de cliente.
 */

export const PORTAL_LOCALES = ["en", "pt-BR", "es", "zh"] as const;
export type PortalLocale = (typeof PORTAL_LOCALES)[number];

export const PORTAL_LOCALE_NAMES: Record<PortalLocale, string> = {
  en: "English",
  "pt-BR": "Português",
  es: "Español",
  zh: "中文",
};

export function isPortalLocale(v: unknown): v is PortalLocale {
  return typeof v === "string" && (PORTAL_LOCALES as readonly string[]).includes(v);
}

export type PortalMessages = {
  nav: {
    menu: string;
    dashboard: string;
    myOrders: string;
    support: string;
    overview: string;
    openMenu: string;
    signOut: string;
    searchPlaceholder: string;
    searchLabel: string;
    language: string;
  };
  orderStatus: Record<OrderStatus, string>;
  batchStatus: Record<BatchStatus, string>;
  stageState: { done: string; current: string; upcoming: string };
  location: Record<OrderStatus, string>;
  common: {
    toBeConfirmed: string;
    products: (n: number) => string;
    batches: (n: number) => string;
    days: (n: number) => string;
    expected: string;
  };
  dashboard: {
    hi: (name: string) => string;
    summary: string;
    activeOrders: string;
    ofTotal: (total: number, delivered: number) => string;
    nextDelivery: string;
    noUpcomingEta: string;
    attentionTitle: string;
    attentionSubtitle: string;
    allOnSchedule: string;
    daysLate: (n: number) => string;
    recentTitle: string;
    viewAll: string;
    noInProgress: string;
  };
  orders: {
    tabsLabel: string;
    tabInProgress: string;
    tabDelivered: string;
    tabAll: string;
    resultsFor: string;
    emptyNone: string;
    emptySearch: string;
    emptyTab: string;
    colOrder: string;
    colReference: string;
    colCategory: string;
    colItems: string;
    colStatus: string;
    colProgress: string;
    colEta: string;
    pageOf: (page: number, count: number) => string;
    total: (n: number) => string;
    previous: string;
    next: string;
  };
  detail: {
    yourReference: string;
    productLines: (n: number) => string;
    scheduleReq: string;
    delayed: (days: number) => string;
    expectedDelivery: string;
    deliveredOn: string;
    orderProgress: string;
    currentLocation: string;
    tabBatches: string;
    tabDocuments: string;
    tabHistory: string;
    tabMessages: string;
    byBatch: string;
    allProducts: string;
    noProductsOrder: string;
    notInProductionYet: string;
    batchFootnote: string;
    batch: string;
    eta: string;
    delivered: string;
    product: string;
    shipReq: string;
    batchNo: string;
    status: string;
    noProductsBatch: string;
    comingSoon: string;
    documentsTitle: string;
    documentsText: string;
    historyTitle: string;
    historyText: string;
    messagesTitle: string;
    messagesText: string;
  };
  support: { comingSoon: string; text: string };
  bell: {
    title: string;
    open: (unread: number) => string;
    markAllRead: string;
    empty: string;
    item: (po: string, batch: string) => string;
    movedTo: string;
  };
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const en: PortalMessages = {
  nav: {
    menu: "Menu",
    dashboard: "Dashboard",
    myOrders: "My orders",
    support: "Support",
    overview: "Overview",
    openMenu: "Open menu",
    signOut: "Sign out",
    searchPlaceholder: "Search order or reference",
    searchLabel: "Search orders",
    language: "Language",
  },
  orderStatus: {
    in_negotiation: "In Negotiation",
    in_production: "In Production",
    pre_loading: "Pre-Loading",
    partially_shipped: "Partially Shipped",
    shipped: "Shipped",
    partially_delivered: "Partially Delivered",
    delivered: "Delivered",
    canceled: "Canceled",
  },
  batchStatus: {
    in_negotiation: "In Negotiation",
    in_production: "In Production",
    preloading: "Pre-Loading",
    in_transit: "In Transit",
    delivered: "Delivered",
    canceled: "Canceled",
  },
  stageState: { done: "Completed", current: "In progress", upcoming: "Pending" },
  location: {
    in_negotiation: "Under negotiation",
    in_production: "In production at the factory in China",
    pre_loading: "Being prepared for shipment in China",
    partially_shipped: "Partially shipped — part of the order is on the way to Brazil",
    shipped: "In transit — on the way to Brazil",
    partially_delivered: "Partially delivered in Brazil",
    delivered: "Delivered in Brazil",
    canceled: "Order canceled",
  },
  common: {
    toBeConfirmed: "To be confirmed",
    products: (n) => plural(n, "product", "products"),
    batches: (n) => plural(n, "batch", "batches"),
    days: (n) => plural(n, "day", "days"),
    expected: "Expected",
  },
  dashboard: {
    hi: (name) => (name ? `Hi, ${name}` : "Hi"),
    summary: "Here's a summary of your orders with AGK.",
    activeOrders: "Active orders",
    ofTotal: (total, delivered) => `of ${total} total · ${delivered} delivered`,
    nextDelivery: "Next delivery",
    noUpcomingEta: "No upcoming ETA for your active orders.",
    attentionTitle: "Orders that need attention",
    attentionSubtitle: "Orders past their expected arrival date in Brazil.",
    allOnSchedule: "All your orders are on schedule.",
    daysLate: (n) => `${plural(n, "day", "days")} late`,
    recentTitle: "Recent orders in progress",
    viewAll: "View all →",
    noInProgress: "You have no orders in progress.",
  },
  orders: {
    tabsLabel: "Order status",
    tabInProgress: "In progress",
    tabDelivered: "Delivered",
    tabAll: "All",
    resultsFor: "Results for",
    emptyNone: "You have no orders yet.",
    emptySearch: "No orders match this search.",
    emptyTab: "No orders here.",
    colOrder: "Order",
    colReference: "Your reference",
    colCategory: "Category",
    colItems: "Items",
    colStatus: "Status",
    colProgress: "Progress",
    colEta: "ETA Brazil",
    pageOf: (p, c) => `Page ${p} of ${c}`,
    total: (n) => `Total: ${plural(n, "record", "records")}`,
    previous: "Previous page",
    next: "Next page",
  },
  detail: {
    yourReference: "Your reference",
    productLines: (n) => plural(n, "product line", "product lines"),
    scheduleReq: "Schedule req.",
    delayed: (d) => `Delayed · ${plural(d, "day", "days")}`,
    expectedDelivery: "Expected delivery",
    deliveredOn: "Delivered on",
    orderProgress: "Order progress",
    currentLocation: "Current location:",
    tabBatches: "Batches",
    tabDocuments: "Documents",
    tabHistory: "History",
    tabMessages: "Messages",
    byBatch: "By batch",
    allProducts: "All products",
    noProductsOrder: "No products to show for this order yet.",
    notInProductionYet: "Not in production yet",
    batchFootnote:
      "A batch moves as one block. If part of it doesn't load, that quantity moves to the next batch and you see it here.",
    batch: "Batch",
    eta: "ETA",
    delivered: "Delivered",
    product: "Product",
    shipReq: "Ship req.",
    batchNo: "Batch No.",
    status: "Status",
    noProductsBatch: "No products in this batch yet.",
    comingSoon: "Coming soon",
    documentsTitle: "Documents",
    documentsText:
      "Invoices, packing lists and other files for this order will show up here. For now, your AGK contact sends them by e-mail.",
    historyTitle: "Change history",
    historyText: "A timeline of every movement on this order will live here — newest first.",
    messagesTitle: "Messages",
    messagesText:
      "Updates from the AGK team about this order will appear here. For now, replies go through your AGK contact by e-mail.",
  },
  bell: {
    title: "Notifications",
    open: (n) => (n > 0 ? `Notifications (${n} unread)` : "Notifications"),
    markAllRead: "Mark all as read",
    empty: "No notifications yet. You'll see here every time a batch moves forward.",
    item: (po, batch) => `Order #${po}${batch ? ` · Batch ${batch}` : ""}`,
    movedTo: "Moved to",
  },
  support: {
    comingSoon: "Support is coming soon",
    text: "In the meantime, reach out to your AGK contact as usual.",
  },
};

const ptBR: PortalMessages = {
  nav: {
    menu: "Menu",
    dashboard: "Painel",
    myOrders: "Meus pedidos",
    support: "Suporte",
    overview: "Visão geral",
    openMenu: "Abrir menu",
    signOut: "Sair",
    searchPlaceholder: "Buscar pedido ou referência",
    searchLabel: "Buscar pedidos",
    language: "Idioma",
  },
  orderStatus: {
    in_negotiation: "Em negociação",
    in_production: "Em produção",
    pre_loading: "Pré-carregamento",
    partially_shipped: "Parcialmente embarcado",
    shipped: "Embarcado",
    partially_delivered: "Parcialmente entregue",
    delivered: "Entregue",
    canceled: "Cancelado",
  },
  batchStatus: {
    in_negotiation: "Em negociação",
    in_production: "Em produção",
    preloading: "Pré-carregamento",
    in_transit: "Em trânsito",
    delivered: "Entregue",
    canceled: "Cancelado",
  },
  stageState: { done: "Concluído", current: "Em andamento", upcoming: "Pendente" },
  location: {
    in_negotiation: "Em negociação",
    in_production: "Em produção na fábrica, na China",
    pre_loading: "Em preparação para embarque, na China",
    partially_shipped: "Parcialmente embarcado — parte do pedido está a caminho do Brasil",
    shipped: "Em trânsito — a caminho do Brasil",
    partially_delivered: "Parcialmente entregue no Brasil",
    delivered: "Entregue no Brasil",
    canceled: "Pedido cancelado",
  },
  common: {
    toBeConfirmed: "A confirmar",
    products: (n) => plural(n, "produto", "produtos"),
    batches: (n) => plural(n, "lote", "lotes"),
    days: (n) => plural(n, "dia", "dias"),
    expected: "Previsto",
  },
  dashboard: {
    hi: (name) => (name ? `Olá, ${name}` : "Olá"),
    summary: "Este é o resumo dos seus pedidos com a AGK.",
    activeOrders: "Pedidos ativos",
    ofTotal: (total, delivered) => `de ${total} no total · ${delivered} entregues`,
    nextDelivery: "Próxima entrega",
    noUpcomingEta: "Nenhuma previsão de chegada para os pedidos ativos.",
    attentionTitle: "Pedidos que precisam de atenção",
    attentionSubtitle: "Pedidos que passaram da data prevista de chegada ao Brasil.",
    allOnSchedule: "Todos os seus pedidos estão no prazo.",
    daysLate: (n) => `${plural(n, "dia", "dias")} de atraso`,
    recentTitle: "Pedidos recentes em andamento",
    viewAll: "Ver todos →",
    noInProgress: "Você não tem pedidos em andamento.",
  },
  orders: {
    tabsLabel: "Situação do pedido",
    tabInProgress: "Em andamento",
    tabDelivered: "Entregues",
    tabAll: "Todos",
    resultsFor: "Resultados para",
    emptyNone: "Você ainda não tem pedidos.",
    emptySearch: "Nenhum pedido corresponde à busca.",
    emptyTab: "Nenhum pedido aqui.",
    colOrder: "Pedido",
    colReference: "Sua referência",
    colCategory: "Categoria",
    colItems: "Itens",
    colStatus: "Status",
    colProgress: "Progresso",
    colEta: "Chegada ao Brasil",
    pageOf: (p, c) => `Página ${p} de ${c}`,
    total: (n) => `Total: ${plural(n, "registro", "registros")}`,
    previous: "Página anterior",
    next: "Próxima página",
  },
  detail: {
    yourReference: "Sua referência",
    productLines: (n) => plural(n, "linha de produto", "linhas de produto"),
    scheduleReq: "Embarque solicitado",
    delayed: (d) => `Atrasado · ${plural(d, "dia", "dias")}`,
    expectedDelivery: "Entrega prevista",
    deliveredOn: "Entregue em",
    orderProgress: "Andamento do pedido",
    currentLocation: "Localização atual:",
    tabBatches: "Lotes",
    tabDocuments: "Documentos",
    tabHistory: "Histórico",
    tabMessages: "Mensagens",
    byBatch: "Por lote",
    allProducts: "Todos os produtos",
    noProductsOrder: "Ainda não há produtos para mostrar neste pedido.",
    notInProductionYet: "Ainda não entrou em produção",
    batchFootnote:
      "Um lote viaja como um bloco. Se parte dele não for carregada, essa quantidade passa para o próximo lote e aparece aqui.",
    batch: "Lote",
    eta: "Previsão",
    delivered: "Entregue",
    product: "Produto",
    shipReq: "Embarque req.",
    batchNo: "Lote nº",
    status: "Status",
    noProductsBatch: "Ainda não há produtos neste lote.",
    comingSoon: "Em breve",
    documentsTitle: "Documentos",
    documentsText:
      "Faturas, packing lists e outros arquivos deste pedido aparecerão aqui. Por enquanto, seu contato na AGK os envia por e-mail.",
    historyTitle: "Histórico de alterações",
    historyText: "Aqui ficará a linha do tempo de cada movimentação do pedido — da mais recente para a mais antiga.",
    messagesTitle: "Mensagens",
    messagesText:
      "As atualizações da equipe AGK sobre este pedido aparecerão aqui. Por enquanto, a conversa segue por e-mail com seu contato na AGK.",
  },
  bell: {
    title: "Notificações",
    open: (n) => (n > 0 ? `Notificações (${n} não lidas)` : "Notificações"),
    markAllRead: "Marcar todas como lidas",
    empty: "Nenhuma notificação ainda. Cada vez que um lote avançar, você verá aqui.",
    item: (po, batch) => `Pedido #${po}${batch ? ` · Lote ${batch}` : ""}`,
    movedTo: "Passou para",
  },
  support: {
    comingSoon: "O suporte chega em breve",
    text: "Enquanto isso, fale com seu contato na AGK como de costume.",
  },
};

const es: PortalMessages = {
  nav: {
    menu: "Menú",
    dashboard: "Panel",
    myOrders: "Mis pedidos",
    support: "Soporte",
    overview: "Resumen",
    openMenu: "Abrir menú",
    signOut: "Cerrar sesión",
    searchPlaceholder: "Buscar pedido o referencia",
    searchLabel: "Buscar pedidos",
    language: "Idioma",
  },
  orderStatus: {
    in_negotiation: "En negociación",
    in_production: "En producción",
    pre_loading: "Precarga",
    partially_shipped: "Enviado parcialmente",
    shipped: "Enviado",
    partially_delivered: "Entregado parcialmente",
    delivered: "Entregado",
    canceled: "Cancelado",
  },
  batchStatus: {
    in_negotiation: "En negociación",
    in_production: "En producción",
    preloading: "Precarga",
    in_transit: "En tránsito",
    delivered: "Entregado",
    canceled: "Cancelado",
  },
  stageState: { done: "Completado", current: "En curso", upcoming: "Pendiente" },
  location: {
    in_negotiation: "En negociación",
    in_production: "En producción en la fábrica, en China",
    pre_loading: "En preparación para el embarque, en China",
    partially_shipped: "Enviado parcialmente — parte del pedido va camino a Brasil",
    shipped: "En tránsito — camino a Brasil",
    partially_delivered: "Entregado parcialmente en Brasil",
    delivered: "Entregado en Brasil",
    canceled: "Pedido cancelado",
  },
  common: {
    toBeConfirmed: "Por confirmar",
    products: (n) => plural(n, "producto", "productos"),
    batches: (n) => plural(n, "lote", "lotes"),
    days: (n) => plural(n, "día", "días"),
    expected: "Previsto",
  },
  dashboard: {
    hi: (name) => (name ? `Hola, ${name}` : "Hola"),
    summary: "Este es el resumen de tus pedidos con AGK.",
    activeOrders: "Pedidos activos",
    ofTotal: (total, delivered) => `de ${total} en total · ${delivered} entregados`,
    nextDelivery: "Próxima entrega",
    noUpcomingEta: "No hay llegadas previstas para tus pedidos activos.",
    attentionTitle: "Pedidos que requieren atención",
    attentionSubtitle: "Pedidos que superaron la fecha prevista de llegada a Brasil.",
    allOnSchedule: "Todos tus pedidos van según lo previsto.",
    daysLate: (n) => `${plural(n, "día", "días")} de retraso`,
    recentTitle: "Pedidos recientes en curso",
    viewAll: "Ver todos →",
    noInProgress: "No tienes pedidos en curso.",
  },
  orders: {
    tabsLabel: "Estado del pedido",
    tabInProgress: "En curso",
    tabDelivered: "Entregados",
    tabAll: "Todos",
    resultsFor: "Resultados para",
    emptyNone: "Todavía no tienes pedidos.",
    emptySearch: "Ningún pedido coincide con la búsqueda.",
    emptyTab: "No hay pedidos aquí.",
    colOrder: "Pedido",
    colReference: "Tu referencia",
    colCategory: "Categoría",
    colItems: "Ítems",
    colStatus: "Estado",
    colProgress: "Progreso",
    colEta: "Llegada a Brasil",
    pageOf: (p, c) => `Página ${p} de ${c}`,
    total: (n) => `Total: ${plural(n, "registro", "registros")}`,
    previous: "Página anterior",
    next: "Página siguiente",
  },
  detail: {
    yourReference: "Tu referencia",
    productLines: (n) => plural(n, "línea de producto", "líneas de producto"),
    scheduleReq: "Embarque solicitado",
    delayed: (d) => `Retrasado · ${plural(d, "día", "días")}`,
    expectedDelivery: "Entrega prevista",
    deliveredOn: "Entregado el",
    orderProgress: "Progreso del pedido",
    currentLocation: "Ubicación actual:",
    tabBatches: "Lotes",
    tabDocuments: "Documentos",
    tabHistory: "Historial",
    tabMessages: "Mensajes",
    byBatch: "Por lote",
    allProducts: "Todos los productos",
    noProductsOrder: "Todavía no hay productos para mostrar en este pedido.",
    notInProductionYet: "Aún no está en producción",
    batchFootnote:
      "Un lote viaja como un bloque. Si una parte no se carga, esa cantidad pasa al siguiente lote y la verás aquí.",
    batch: "Lote",
    eta: "Llegada prevista",
    delivered: "Entregado",
    product: "Producto",
    shipReq: "Embarque sol.",
    batchNo: "Lote n.º",
    status: "Estado",
    noProductsBatch: "Todavía no hay productos en este lote.",
    comingSoon: "Próximamente",
    documentsTitle: "Documentos",
    documentsText:
      "Aquí aparecerán las facturas, packing lists y otros archivos de este pedido. Por ahora, tu contacto en AGK los envía por correo electrónico.",
    historyTitle: "Historial de cambios",
    historyText: "Aquí estará la cronología de cada movimiento del pedido, del más reciente al más antiguo.",
    messagesTitle: "Mensajes",
    messagesText:
      "Aquí aparecerán las novedades del equipo de AGK sobre este pedido. Por ahora, la conversación sigue por correo con tu contacto en AGK.",
  },
  bell: {
    title: "Notificaciones",
    open: (n) => (n > 0 ? `Notificaciones (${n} sin leer)` : "Notificaciones"),
    markAllRead: "Marcar todas como leídas",
    empty: "Aún no hay notificaciones. Cada vez que un lote avance, lo verás aquí.",
    item: (po, batch) => `Pedido #${po}${batch ? ` · Lote ${batch}` : ""}`,
    movedTo: "Pasó a",
  },
  support: {
    comingSoon: "El soporte llegará pronto",
    text: "Mientras tanto, comunícate con tu contacto en AGK como de costumbre.",
  },
};

const zh: PortalMessages = {
  nav: {
    menu: "菜单",
    dashboard: "仪表板",
    myOrders: "我的订单",
    support: "支持",
    overview: "概览",
    openMenu: "打开菜单",
    signOut: "退出登录",
    searchPlaceholder: "搜索订单号或参考号",
    searchLabel: "搜索订单",
    language: "语言",
  },
  orderStatus: {
    in_negotiation: "洽谈中",
    in_production: "生产中",
    pre_loading: "待装柜",
    partially_shipped: "部分已发运",
    shipped: "已发运",
    partially_delivered: "部分已交付",
    delivered: "已交付",
    canceled: "已取消",
  },
  batchStatus: {
    in_negotiation: "洽谈中",
    in_production: "生产中",
    preloading: "待装柜",
    in_transit: "运输中",
    delivered: "已交付",
    canceled: "已取消",
  },
  stageState: { done: "已完成", current: "进行中", upcoming: "待进行" },
  location: {
    in_negotiation: "洽谈中",
    in_production: "在中国工厂生产中",
    pre_loading: "在中国准备装运",
    partially_shipped: "部分已发运——部分货物正在运往巴西",
    shipped: "运输中——正在运往巴西",
    partially_delivered: "已在巴西部分交付",
    delivered: "已在巴西交付",
    canceled: "订单已取消",
  },
  common: {
    toBeConfirmed: "待确认",
    products: (n) => `${n} 个产品`,
    batches: (n) => `${n} 个批次`,
    days: (n) => `${n} 天`,
    expected: "预计",
  },
  dashboard: {
    hi: (name) => (name ? `您好，${name}` : "您好"),
    summary: "以下是您在 AGK 的订单概况。",
    activeOrders: "进行中的订单",
    ofTotal: (total, delivered) => `共 ${total} 个 · 已交付 ${delivered} 个`,
    nextDelivery: "下一次到货",
    noUpcomingEta: "进行中的订单暂无预计到达日期。",
    attentionTitle: "需要关注的订单",
    attentionSubtitle: "已超过预计到达巴西日期的订单。",
    allOnSchedule: "您的所有订单均按计划进行。",
    daysLate: (n) => `延迟 ${n} 天`,
    recentTitle: "最近进行中的订单",
    viewAll: "查看全部 →",
    noInProgress: "您目前没有进行中的订单。",
  },
  orders: {
    tabsLabel: "订单状态",
    tabInProgress: "进行中",
    tabDelivered: "已交付",
    tabAll: "全部",
    resultsFor: "搜索结果：",
    emptyNone: "您还没有订单。",
    emptySearch: "没有符合搜索条件的订单。",
    emptyTab: "此处暂无订单。",
    colOrder: "订单",
    colReference: "您的参考号",
    colCategory: "品类",
    colItems: "项目",
    colStatus: "状态",
    colProgress: "进度",
    colEta: "预计到达巴西",
    pageOf: (p, c) => `第 ${p} / ${c} 页`,
    total: (n) => `共 ${n} 条记录`,
    previous: "上一页",
    next: "下一页",
  },
  detail: {
    yourReference: "您的参考号",
    productLines: (n) => `${n} 条产品明细`,
    scheduleReq: "要求发运日期",
    delayed: (d) => `已延迟 ${d} 天`,
    expectedDelivery: "预计到货",
    deliveredOn: "交付日期",
    orderProgress: "订单进度",
    currentLocation: "当前位置：",
    tabBatches: "批次",
    tabDocuments: "文件",
    tabHistory: "历史",
    tabMessages: "消息",
    byBatch: "按批次",
    allProducts: "全部产品",
    noProductsOrder: "此订单暂无可显示的产品。",
    notInProductionYet: "尚未投产",
    batchFootnote: "一个批次整体运输。如有部分未能装柜，该数量将转入下一个批次，并在此处显示。",
    batch: "批次",
    eta: "预计到达",
    delivered: "已交付",
    product: "产品",
    shipReq: "要求发运",
    batchNo: "批次号",
    status: "状态",
    noProductsBatch: "此批次暂无产品。",
    comingSoon: "即将推出",
    documentsTitle: "文件",
    documentsText: "此订单的发票、装箱单等文件将显示在这里。目前由您的 AGK 联系人通过电子邮件发送。",
    historyTitle: "变更历史",
    historyText: "这里将按时间倒序显示此订单的每一次变动。",
    messagesTitle: "消息",
    messagesText: "AGK 团队关于此订单的更新将显示在这里。目前请通过电子邮件与您的 AGK 联系人沟通。",
  },
  bell: {
    title: "通知",
    open: (n) => (n > 0 ? `通知（${n} 条未读）` : "通知"),
    markAllRead: "全部标为已读",
    empty: "暂无通知。每当批次状态推进时，都会显示在这里。",
    item: (po, batch) => `订单 #${po}${batch ? ` · 批次 ${batch}` : ""}`,
    movedTo: "状态更新为",
  },
  support: {
    comingSoon: "支持功能即将推出",
    text: "在此期间，请照常联系您的 AGK 联系人。",
  },
};

export const PORTAL_MESSAGES: Record<PortalLocale, PortalMessages> = {
  en,
  "pt-BR": ptBR,
  es,
  zh,
};

export function portalMessages(locale: PortalLocale): PortalMessages {
  return PORTAL_MESSAGES[locale] ?? en;
}
