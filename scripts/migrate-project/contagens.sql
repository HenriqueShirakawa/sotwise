-- Contagem EXATA de linhas de tudo que interessa na virada de projeto Supabase.
-- Rodar nos DOIS projetos (origem e destino) e comparar as saídas — devem ser
-- idênticas, linha a linha.
--
--   psql "$SRC_DB_URL" -f scripts/migrate-project/contagens.sql > origem.txt
--   psql "$DST_DB_URL" -f scripts/migrate-project/contagens.sql > destino.txt
--   diff origem.txt destino.txt
--
-- Usa query_to_xml para contar sem precisar montar o SQL na mão tabela a tabela
-- (count(*) de verdade, não a estimativa de pg_stat_user_tables).

\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'

select tabela, contagem
from (
  select
    format('%s.%s', table_schema, table_name) as tabela,
    (xpath(
      '/row/c/text()',
      query_to_xml(
        format('select count(*) as c from %I.%I', table_schema, table_name),
        false, true, ''
      )
    ))[1]::text::bigint as contagem
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and (
      table_schema = 'public'
      or (table_schema = 'auth'    and table_name in ('users', 'identities'))
      or (table_schema = 'storage' and table_name in ('buckets', 'objects'))
    )
) t
order by tabela;
