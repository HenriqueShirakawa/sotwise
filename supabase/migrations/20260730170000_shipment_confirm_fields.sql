-- Campos coletados no modal "Confirm Shipping" (PL → Shipment) que a tabela
-- shipments ainda não tinha. Espelham os campos do header do shipment no Bubble
-- ([Header] Responsible, [Header] Signer, [Header] Estimated).
alter table public.shipments
  add column if not exists leader_id     uuid references public.profiles(id),  -- "Leader's Shipment"
  add column if not exists signer_id     uuid references public.profiles(id),  -- "Signer"
  add column if not exists estimated_date date;                                -- "Estimated"

-- Marca o momento em que o PL foi confirmado e virou Shipment. PL confirmado
-- some da lista de Pre-loading (é acessível só pela tela de Shipments). 1:1 com
-- shipments, mas um flag explícito simplifica o filtro da listagem.
alter table public.pre_loadings
  add column if not exists shipping_confirmed_at timestamptz;
