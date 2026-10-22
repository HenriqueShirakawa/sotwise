-- PI status vira boolean (2026-10-22, decisão do usuário).
--
--  - o GSS manda `pi_status: true` (PI emitida) ou `false` (ainda não);
--  - `true` conclui a etapa PI com Completed on = `pi_status_date` (nunca futura);
--  - `false` só grava (fica no histórico) — não conclui e não reabre;
--  - o texto livre de antes vira `true` (só havia "Issued" na order 1706, teste).
--
-- ⚠️ Não é aditiva: troca o tipo da coluna. Aplicar junto com o deploy de main e
-- dev (os dois usam este banco).

alter table public.orders
  alter column pi_status type boolean
  using (case when nullif(btrim(pi_status), '') is null then null else true end);

-- Histórico da PI: mesmo formato (status/previous_status booleanos).
update public.checklist_step_revisions
set payload = jsonb_build_object(
  'status', case when payload->>'status' is null then null else true end,
  'previous_status', case when payload->>'previous_status' is null then null else true end
)
where kind = 'pi_status'
  and (jsonb_typeof(payload->'status') = 'string' or jsonb_typeof(payload->'previous_status') = 'string');
