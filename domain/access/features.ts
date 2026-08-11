/**
 * Catálogo de features — a fonte única de "o que existe para dar acesso".
 *
 * Fica em CÓDIGO (as chaves são a allowlist, mesma filosofia do
 * `domain/api/registry.ts`); o banco guarda só a concessão, em `role_features`
 * e `user_features`. Consequência prática: não existe feature órfã. Feature
 * nova nasce sem linha nenhuma e portanto sem acesso (fail closed) até o owner
 * ligar o toggle, e linha apontando para uma key removida do catálogo é
 * ignorada aqui em vez de virar permissão fantasma.
 *
 * Sem `server-only` de propósito: a sidebar é Client Component e precisa dos
 * rótulos. Nada neste arquivo é segredo — a autorização real acontece no
 * servidor (`lib/dal.ts`); o que atravessa para o cliente é o mapa **já
 * resolvido** da sessão, nunca as regras de resolução aplicadas no browser.
 */

export const FEATURE_ACTIONS = ["view", "create", "edit", "delete"] as const;
export type FeatureAction = (typeof FEATURE_ACTIONS)[number];

type FeatureDef = {
  label: string;
  /** Prefixos de rota cobertos. Usado pelo nav e por `featureForPath`. */
  routes: readonly string[];
  /** Ações que fazem sentido aqui — a matriz de acessos só mostra estas. */
  actions: readonly FeatureAction[];
  /** Exclusiva do owner: fora da matriz, ninguém mais pode receber. */
  ownerOnly?: boolean;
};

const ALL_ACTIONS = FEATURE_ACTIONS;

export const FEATURES = {
  orders: { label: "Orders", routes: ["/orders"], actions: ALL_ACTIONS },
  etd_factories: {
    label: "ETD factories",
    // Tela derivada das Orders: não se cria nem se apaga por aqui, só edita ETD.
    routes: ["/etd-factories"],
    actions: ["view", "edit"],
  },
  pre_loading: { label: "Pre-Loading", routes: ["/pre-loading"], actions: ALL_ACTIONS },
  shipments: { label: "Shipments", routes: ["/shipments"], actions: ALL_ACTIONS },
  todo: {
    // Lista derivada do checklist — só leitura e conclusão de etapa.
    label: "To do list",
    routes: ["/todo"],
    actions: ["view", "edit"],
  },
  registration: {
    label: "Registration",
    routes: ["/registration"],
    actions: ALL_ACTIONS,
  },
  users: { label: "Users", routes: ["/users"], actions: ALL_ACTIONS },
  access: {
    label: "Access control",
    routes: ["/access"],
    actions: ["view", "edit"],
    ownerOnly: true,
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** Features que aparecem na matriz da tela de acessos (tudo menos owner-only). */
export const ASSIGNABLE_FEATURE_KEYS = FEATURE_KEYS.filter(
  (key) => !("ownerOnly" in FEATURES[key] && FEATURES[key].ownerOnly)
);

/** Permissões resolvidas de UMA feature. */
export type FeatureGrant = Record<FeatureAction, boolean>;

/** Mapa completo da sessão — é isto que atravessa para o cliente. */
export type PermissionMap = Record<FeatureKey, FeatureGrant>;

export const NO_ACCESS: FeatureGrant = {
  view: false,
  create: false,
  edit: false,
  delete: false,
};

export const FULL_ACCESS: FeatureGrant = {
  view: true,
  create: true,
  edit: true,
  delete: true,
};

/** Linha de concessão como vem de `role_features` / `user_features`. */
export type GrantRow = {
  feature_key: string;
  can_view: boolean | null;
  can_create: boolean | null;
  can_edit: boolean | null;
  can_delete: boolean | null;
};

/** Ação → coluna correspondente, para não repetir o switch em cada consumidor. */
export const GRANT_COLUMN = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
} as const satisfies Record<FeatureAction, keyof GrantRow>;

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(FEATURES, value);
}

function emptyMap(): PermissionMap {
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, { ...NO_ACCESS }])
  ) as PermissionMap;
}

function fullMap(): PermissionMap {
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, { ...FULL_ACCESS }])
  ) as PermissionMap;
}

/**
 * Monta o mapa efetivo da sessão.
 *
 * Ordem: owner curto-circuita (nunca depende de linha no banco) → exceção do
 * usuário → padrão do papel → negado. O override do usuário vale nos DOIS
 * sentidos: `false` explícito revoga o que o papel concede, e é por isso que as
 * colunas de `user_features` são nullable (null = "não opinei, herda").
 *
 * Ação fora de `actions` da feature nunca é concedida, mesmo com a coluna
 * marcada no banco — o catálogo é quem manda sobre o que faz sentido existir.
 */
export function resolvePermissions({
  isOwner,
  roleGrants,
  userGrants,
}: {
  isOwner: boolean;
  roleGrants: readonly GrantRow[];
  userGrants: readonly GrantRow[];
}): PermissionMap {
  if (isOwner) return fullMap();

  const map = emptyMap();
  const byKey = (rows: readonly GrantRow[]) =>
    new Map(rows.filter((r) => isFeatureKey(r.feature_key)).map((r) => [r.feature_key, r]));

  const role = byKey(roleGrants);
  const user = byKey(userGrants);

  for (const key of FEATURE_KEYS) {
    const def = FEATURES[key];
    // Feature owner-only não é concedível: quem não é owner não recebe, mesmo
    // que alguém tenha inserido a linha na mão.
    if ("ownerOnly" in def && def.ownerOnly) continue;

    for (const action of def.actions) {
      const column = GRANT_COLUMN[action];
      const override = user.get(key)?.[column];
      map[key][action] = override ?? role.get(key)?.[column] ?? false;
    }
  }

  return map;
}

/**
 * Feature que cobre um pathname, pelo prefixo de rota mais longo que casa
 * (`/registration/agents` → `registration`). `null` para rotas fora do
 * catálogo, como `/profile`, que todo usuário autenticado acessa.
 */
export function featureForPath(pathname: string): FeatureKey | null {
  let match: { key: FeatureKey; length: number } | null = null;

  for (const key of FEATURE_KEYS) {
    for (const route of FEATURES[key].routes) {
      const hit = pathname === route || pathname.startsWith(route + "/");
      if (hit && (!match || route.length > match.length)) {
        match = { key, length: route.length };
      }
    }
  }

  return match?.key ?? null;
}
