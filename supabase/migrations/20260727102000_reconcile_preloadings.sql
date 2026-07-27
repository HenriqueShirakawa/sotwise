-- Reconciliação para o import de Pre-loadings: a origem (Bubble) não traz
-- leader/responsible/POD/reference de forma confiável em todos os registros.
alter table public.pre_loadings alter column client_reference drop not null;
alter table public.pre_loadings alter column pod_id          drop not null;
alter table public.pre_loadings alter column leader_id       drop not null;
