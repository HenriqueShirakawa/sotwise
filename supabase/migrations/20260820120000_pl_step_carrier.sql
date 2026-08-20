-- Etapa "Agents" do Pre-loading: o campo passa a apontar direto para um Carrier,
-- não mais para o agente que o representava. Antes o "Carrier" era DERIVADO do
-- `carrier_agent_id` via `carrier_agents` (M-N) — tanto na lista de Pre-loading
-- quanto no detalhe do Shipment. Agora é uma escolha direta.
--
-- `carrier_agent_id` NÃO é removida (preserva o dado migrado do Bubble); apenas
-- deixa de ser editada na UI. O novo `carrier_id` é retrocompatível: nasce nulo
-- e é backfillado a partir do agente que já estava gravado.

alter table public.pre_loading_checklist_steps
  add column carrier_id uuid references public.carriers(id);

-- Backfill: herda o carrier do agente gravado, quando esse agente mapeia para um
-- carrier em `carrier_agents` (mesmo valor que a lista/detalhe já exibiam). Se o
-- agente carrega mais de um carrier, pega o menor id (determinístico).
update public.pre_loading_checklist_steps s
set carrier_id = (
  select ca.carrier_id
  from public.carrier_agents ca
  where ca.agent_id = s.carrier_agent_id
  order by ca.carrier_id
  limit 1
)
where s.carrier_agent_id is not null
  and s.carrier_id is null;

create index if not exists idx_plcs_carrier_id
  on public.pre_loading_checklist_steps(carrier_id)
  where carrier_id is not null;
