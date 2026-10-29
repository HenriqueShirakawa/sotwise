-- Lista de Pre-Loading enxuta (2026-10-29).
--
-- A tela /pre-loading mostra só os PLs ABERTOS (~50), mas baixava as etapas,
-- lotes, orders e shipments de TODOS os PLs (~15 mil linhas com o histórico do
-- Bubble) para descartar quase tudo no app. Esta view já devolve só os abertos,
-- com o que a lista usa agregado por PL.
--
-- Regra da lista (mesma da página): o PL só sai quando as DUAS coisas
-- acontecem — etapa "Loading Date" concluída E um embarque vivo criado.
--
-- security_invoker + sem grant para anon/authenticated: só o service role lê.

create or replace view public.pre_loadings_list
with (security_invoker = true) as
select
  p.id,
  p.pl_number,
  p.created_date,
  p.client_reference,
  p.pod_id,
  p.leader_id,
  p.responsible_signer_id,
  -- etapa → linha da etapa (só as que a lista usa)
  coalesce((
    select jsonb_object_agg(s.step, to_jsonb(s))
    from public.pre_loading_checklist_steps s
    where s.pre_loading_id = p.id
      and s.step in ('consolidation_point', 'port_of_loading', 'loading_date', 'booking', 'agents')
  ), '{}'::jsonb) as steps,
  -- clientes vivos do PL
  coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
    from public.pre_loading_clients pc
    join public.clients c on c.id = pc.client_id and c.deleted_at is null
    where pc.pre_loading_id = p.id
  ), '[]'::jsonb) as clients,
  coalesce((
    select array_agg(pb.batch_id)
    from public.pre_loading_batches pb
    where pb.pre_loading_id = p.id
  ), '{}') as batch_ids,
  coalesce((
    select array_agg(distinct b.order_id)
    from public.pre_loading_batches pb
    join public.batches b on b.id = pb.batch_id
    where pb.pre_loading_id = p.id
  ), '{}') as order_ids
from public.pre_loadings p
where p.deleted_at is null
  and not (
    exists (
      select 1 from public.shipments sh
      where sh.pre_loading_id = p.id and sh.deleted_at is null
    )
    and exists (
      select 1 from public.pre_loading_checklist_steps s
      where s.pre_loading_id = p.id and s.step = 'loading_date' and s.completed_on is not null
    )
  );

revoke all on public.pre_loadings_list from public, anon, authenticated;
grant select on public.pre_loadings_list to service_role;
