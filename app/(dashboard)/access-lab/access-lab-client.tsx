"use client";

import { useState } from "react";
import { Check, Eye, FlaskConical, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

/* ------------------------------ Mock (dados fake) ---------------------------- *
 * Nada aqui vem do banco. É só a estrutura pra desenhar o modelo de 3 camadas
 * (Role → Company → User) com a Company modificando o CRUD. Quando o desenho
 * travar com o cliente, isto migra pro catálogo real (domain/access/features.ts)
 * + role_features/user_features.
 * ---------------------------------------------------------------------------- */

type Id = string;

type CatalogItem = { key: Id; label: string; note?: string };
type Company = { key: Id; label: string; sub: string };

const TELAS: CatalogItem[] = [
  { key: "orders", label: "Orders" },
  { key: "pre_loading", label: "Pre-Loading" },
  { key: "shipments", label: "Shipments" },
  { key: "etd_factories", label: "ETD factories" },
  { key: "todo", label: "To-do list" },
  { key: "registration", label: "Registration", note: "11 sub-rotas" },
  { key: "users", label: "Users" },
];

const CAPACIDADES: CatalogItem[] = [
  { key: "lote.split", label: "Split de lote" },
  { key: "preloading.confirm", label: "Confirmar embarque" },
  { key: "export.xls", label: "Download XLS" },
  { key: "registration.api", label: "Registro via API (GSS)" },
];

const COMPANIES: Company[] = [
  { key: "agk", label: "AGK", sub: "Brasil" },
  { key: "zenchun", label: "Zenchun", sub: "China" },
];

const ROLES: CatalogItem[] = [
  { key: "admin", label: "admin" },
  { key: "user", label: "user" },
];

const CRUD = ["view", "create", "edit", "delete"] as const;
type Crud = (typeof CRUD)[number];
const CRUD_ICON: Record<Crud, LucideIcon> = {
  view: Eye,
  create: Plus,
  edit: Pencil,
  delete: Trash2,
};
const CRUD_TITLE: Record<Crud, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

const gkey = (role: Id, company: Id, scope: Id, action: string) =>
  `${role}|${company}|${scope}|${action}`;

/**
 * Semente que conta a história do "Company modifica o CRUD": o papel `user`
 * opera a esteira inteira na AGK (sem delete), mas na Zenchun só enxerga. O
 * `admin` faz tudo nas duas. `owner` fica fora — bypass total, como no real.
 */
function seed(): Record<string, boolean> {
  const g: Record<string, boolean> = {};
  for (const role of ROLES) {
    for (const c of COMPANIES) {
      for (const t of TELAS) {
        for (const a of CRUD) {
          let v: boolean;
          if (role.key === "admin") v = true;
          else if (t.key === "users") v = false;
          else if (c.key === "agk") v = a !== "delete";
          else v = a === "view";
          g[gkey(role.key, c.key, t.key, a)] = v;
        }
      }
      for (const cap of CAPACIDADES) {
        let v: boolean;
        if (role.key === "admin") v = true;
        else v = c.key === "agk" ? cap.key !== "registration.api" : cap.key === "export.xls";
        g[gkey(role.key, c.key, cap.key, "allow")] = v;
      }
    }
  }
  return g;
}

/* --------------------------------- Tela ------------------------------------- */

export function AccessLabClient() {
  const [grants, setGrants] = useState<Record<string, boolean>>(seed);
  const [role, setRole] = useState<Id>("user");

  const get = (company: Id, scope: Id, action: string) =>
    grants[gkey(role, company, scope, action)] ?? false;

  const toggle = (company: Id, scope: Id, action: string) =>
    setGrants((g) => {
      const k = gkey(role, company, scope, action);
      return { ...g, [k]: !g[k] };
    });

  return (
    <div>
      <PageHeader
        title="Controle de acesso — protótipo"
        description="Três camadas: o Role define o que faz, a Company modifica o CRUD, o User abre exceção. Desenho para validar com o cliente."
      />

      <Banner />

      <div className="grid gap-8">
        <section className="rounded-lg border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Papel × Company</h2>
              <p className="text-xs text-muted-foreground">
                O mesmo papel pode fazer coisas diferentes em cada company — a Company como
                modificador de CRUD. Compare AGK e Zenchun no papel <em>user</em>.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <RoleTabs role={role} onChange={setRole} />
              <button
                type="button"
                onClick={() => setGrants(seed())}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-slate-50"
              >
                <RotateCcw className="size-3.5" /> Restaurar exemplo
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
            <span className="font-medium">Ações:</span>
            {CRUD.map((a) => {
              const Icon = CRUD_ICON[a];
              return (
                <span key={a} className="inline-flex items-center gap-1.5">
                  <Icon className="size-3.5" /> {CRUD_TITLE[a]}
                </span>
              );
            })}
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-2">
            {COMPANIES.map((c) => (
              <CompanyCard key={c.key} company={c} get={get} toggle={toggle} />
            ))}
          </div>

          <p className="border-t bg-slate-50 px-4 py-2 text-xs text-muted-foreground">
            O papel <strong>owner</strong> fica fora da matriz — acesso total por código, nunca
            por dado (não dá pra um owner se trancar fora do painel).
          </p>
        </section>

        <CatalogReference />
        <UserOverrideNote />
      </div>
    </div>
  );
}

/* ------------------------------ Subcomponentes ------------------------------ */

function Banner() {
  return (
    <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <FlaskConical className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium">Protótipo.</span> Dados fake e locais — nada é salvo,
        nenhuma migration. É pra desenhar e validar o modelo com o cliente; quando travar,
        vira o <code className="rounded bg-amber-100 px-1 py-0.5">/access</code> de verdade.
      </p>
    </div>
  );
}

function RoleTabs({ role, onChange }: { role: Id; onChange: (r: Id) => void }) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {ROLES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChange(r.key)}
          className={cn(
            "rounded px-3 py-1 text-sm transition-colors",
            role === r.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-slate-100"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

type Getter = (company: Id, scope: Id, action: string) => boolean;
type Toggler = (company: Id, scope: Id, action: string) => void;

function CompanyCard({
  company,
  get,
  toggle,
}: {
  company: Company;
  get: Getter;
  toggle: Toggler;
}) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-baseline justify-between border-b bg-slate-50 px-3 py-2">
        <span className="text-sm font-semibold">{company.label}</span>
        <span className="text-xs text-muted-foreground">{company.sub}</span>
      </div>

      {/* A matriz rola sozinha no X — a página nunca rola horizontalmente. */}
      <div className="overflow-x-auto">
        <div className="min-w-[300px] p-3">
          <div className="grid grid-cols-[minmax(120px,1fr)_repeat(4,1.75rem)] items-center pb-1.5 text-xs text-muted-foreground">
            <span>Tela</span>
            {CRUD.map((a) => {
              const Icon = CRUD_ICON[a];
              return (
                <span key={a} className="flex justify-center" title={CRUD_TITLE[a]}>
                  <Icon className="size-3.5" aria-label={CRUD_TITLE[a]} />
                </span>
              );
            })}
          </div>

          {TELAS.map((t) => (
            <div
              key={t.key}
              className="grid grid-cols-[minmax(120px,1fr)_repeat(4,1.75rem)] items-center py-1"
            >
              <span className="text-sm">
                {t.label}
                {t.note ? (
                  <span className="ml-1 text-[11px] text-muted-foreground">({t.note})</span>
                ) : null}
              </span>
              {CRUD.map((a) => (
                <div key={a} className="flex justify-center">
                  <CrudCell
                    on={get(company.key, t.key, a)}
                    onToggle={() => toggle(company.key, t.key, a)}
                    label={`${CRUD_TITLE[a]} ${t.label} (${company.label})`}
                  />
                </div>
              ))}
            </div>
          ))}

          <div className="mt-3 border-t pt-2">
            <div className="pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              Capacidades
            </div>
            {CAPACIDADES.map((cap) => (
              <div key={cap.key} className="flex items-center justify-between py-1">
                <span className="text-sm">{cap.label}</span>
                <CrudCell
                  on={get(company.key, cap.key, "allow")}
                  onToggle={() => toggle(company.key, cap.key, "allow")}
                  label={`${cap.label} (${company.label})`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CrudCell({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={label}
      className={cn(
        "flex size-6 items-center justify-center rounded border transition-colors",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-slate-300 bg-white text-transparent hover:border-slate-400"
      )}
    >
      <Check className="size-3.5" />
    </button>
  );
}

function CatalogReference() {
  return (
    <section className="rounded-lg border bg-white">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          Catálogo
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
            referência · read-only
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          O que existe pra dar acesso. No app real, fixo no código
          (domain/access/features.ts) — feature nova nasce sem acesso até o owner ligar.
        </p>
      </div>
      <div className="grid gap-6 p-4 sm:grid-cols-3">
        <CatalogGroup title="Telas (rotas)" items={TELAS} />
        <CatalogGroup title="Capacidades (transversais)" items={CAPACIDADES} />
        <div>
          <div className="pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Ações (em cada tela)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CRUD.map((a) => (
              <code
                key={a}
                className="rounded bg-slate-100 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {a}
              </code>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CatalogGroup({ title, items }: { title: string; items: CatalogItem[] }) {
  return (
    <div>
      <div className="pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="grid gap-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between gap-2">
            <span className="text-sm">{it.label}</span>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {it.key}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserOverrideNote() {
  return (
    <section className="rounded-lg border bg-white">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          Exceção por usuário
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            camada 3 · o detalhe fino
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Sobrepõe o papel para uma pessoa específica, nos dois sentidos (libera ou revoga).
          Herda quando não mexe.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        <OverrideChip who="João · user · Zenchun" what="+ delete em Orders" tone="allow" />
        <OverrideChip who="Maria · user · AGK" what="− edit em Registration" tone="deny" />
        <OverrideChip who="Resto do time" what="herda do papel" tone="inherit" />
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Resolução efetiva: <strong className="font-medium text-foreground">Owner</strong> (tudo)
        → <strong className="font-medium text-foreground">User</strong> (exceção) →{" "}
        <strong className="font-medium text-foreground">Role</strong> (base), sempre dentro do
        escopo da <strong className="font-medium text-foreground">Company</strong>.
      </p>
    </section>
  );
}

function OverrideChip({
  who,
  what,
  tone,
}: {
  who: string;
  what: string;
  tone: "allow" | "deny" | "inherit";
}) {
  const toneCls =
    tone === "allow"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : tone === "deny"
        ? "border-red-300 bg-red-50 text-red-800"
        : "border-slate-300 bg-slate-50 text-slate-600";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
        toneCls
      )}
    >
      <span className="font-medium">{who}</span>
      <span className="opacity-80">{what}</span>
    </span>
  );
}
