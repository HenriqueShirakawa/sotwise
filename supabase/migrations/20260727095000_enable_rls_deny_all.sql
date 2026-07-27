-- =============================================================================
-- Habilita RLS (Row Level Security) em TODAS as tabelas do schema public,
-- em modo DENY-ALL (sem policies).
--
-- Efeito: remove o aviso "UNRESTRICTED" do dashboard. Ninguém acessa via chave
-- anon/authenticated (fail closed). Acesso continua apenas via service_role
-- (servidor / Management API / importador de migração), que ignora RLS.
-- As policies de leitura/escrita entram numa fase posterior, tabela por tabela.
-- =============================================================================

alter table public.roles                          enable row level security;
alter table public.profiles                        enable row level security;
alter table public.activity_logs                   enable row level security;

alter table public.countries                        enable row level security;
alter table public.pols                             enable row level security;
alter table public.pods                             enable row level security;
alter table public.cities                           enable row level security;
alter table public.city_pols                        enable row level security;
alter table public.factories                        enable row level security;
alter table public.categories                       enable row level security;
alter table public.category_factories               enable row level security;
alter table public.contacts                         enable row level security;
alter table public.agents                           enable row level security;
alter table public.agent_contacts                   enable row level security;
alter table public.carriers                         enable row level security;
alter table public.carrier_agents                   enable row level security;
alter table public.clients                          enable row level security;
alter table public.exporters                        enable row level security;
alter table public.business_units                   enable row level security;
alter table public.order_types                      enable row level security;
alter table public.shipment_models                  enable row level security;

alter table public.orders                           enable row level security;
alter table public.batches                          enable row level security;
alter table public.order_factory_category           enable row level security;
alter table public.etd_info                         enable row level security;
alter table public.etd_history                      enable row level security;
alter table public.order_checklist_steps            enable row level security;
alter table public.step_attachments                 enable row level security;

alter table public.pre_loadings                     enable row level security;
alter table public.pre_loading_clients              enable row level security;
alter table public.pre_loading_batches              enable row level security;
alter table public.pre_loading_checklist_steps      enable row level security;
alter table public.shipments                        enable row level security;
