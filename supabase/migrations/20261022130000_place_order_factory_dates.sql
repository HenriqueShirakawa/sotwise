-- Place the Order: data por fábrica no lugar do anexo (2026-10-22, decisão do usuário).
--
--  - cada fábrica da Order ganha a sua data "Placed on", informada pelo usuário;
--    a 1ª gravação é livre, trocar depois exige motivo (vai pro History da etapa);
--  - a etapa conclui quando TODAS as fábricas têm data; o Completed on é o dia
--    da última atualização (imutável);
--  - o anexo por fábrica continua, mas OPCIONAL.
--
-- Carga: até aqui o "Placed on" era a data do 1º documento de cada fábrica —
-- ela vira a data gravada, pra tela e a conclusão não mudarem nas Orders antigas.
--
-- Só aditiva: main e dev usam o mesmo banco.

create table if not exists public.order_factory_placed_dates (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  factory_id  uuid not null references public.factories(id) on delete cascade,
  placed_on   date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint order_factory_placed_dates_unique unique (order_id, factory_id)
);

-- Só o service role lê/escreve (RLS ligada, sem policy) — a tela usa server action.
alter table public.order_factory_placed_dates enable row level security;

insert into public.order_factory_placed_dates (order_id, factory_id, placed_on)
select s.order_id, a.factory_id, (min(a.created_at) at time zone 'America/Sao_Paulo')::date
  from public.step_attachments a
  join public.order_checklist_steps s on s.id = a.checklist_step_id
 where s.step = 'place_the_order'
   and a.factory_id is not null
 group by s.order_id, a.factory_id
on conflict (order_id, factory_id) do nothing;
