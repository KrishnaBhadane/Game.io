-- Run in Supabase SQL Editor. Read-only; returns metadata for four tables only.
with target as (
  select c.oid, c.relname as table_name, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('games', 'game_players', 'questions', 'submissions')
    and c.relkind in ('r', 'p')
)
select t.table_name,
  t.relrowsecurity as rls_enabled,
  t.relforcerowsecurity as rls_forced,
  (select jsonb_agg(jsonb_build_object(
    'name', a.attname,
    'type', format_type(a.atttypid, a.atttypmod),
    'not_null', a.attnotnull,
    'default', pg_get_expr(d.adbin, d.adrelid)
  ) order by a.attnum)
   from pg_attribute a
   left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  ) as columns,
  (select jsonb_agg(jsonb_build_object(
    'name', c.conname, 'type', c.contype,
    'definition', pg_get_constraintdef(c.oid), 'validated', c.convalidated
  ) order by c.conname)
   from pg_constraint c where c.conrelid = t.oid
  ) as constraints,
  (select jsonb_agg(jsonb_build_object(
    'name', i.indexrelid::regclass::text,
    'definition', pg_get_indexdef(i.indexrelid),
    'valid', i.indisvalid
  ) order by i.indexrelid::regclass::text)
   from pg_index i where i.indrelid = t.oid
  ) as indexes,
  (select jsonb_agg(jsonb_build_object(
    'name', p.policyname, 'command', p.cmd, 'roles', p.roles,
    'permissive', p.permissive, 'using', p.qual, 'with_check', p.with_check
  ) order by p.policyname)
   from pg_policies p where p.schemaname = 'public' and p.tablename = t.table_name
  ) as policies
from target t
order by t.table_name;
