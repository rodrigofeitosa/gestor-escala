-- Cover foreign keys used by tenant-scoped queries and referential checks.
do $$ declare c record; cols text; begin
 for c in select con.oid,con.conrelid,con.conname,con.conkey,n.nspname,t.relname
 from pg_constraint con join pg_class t on t.oid=con.conrelid join pg_namespace n on n.oid=t.relnamespace
 where con.contype='f' and n.nspname='public'
 and not exists(select 1 from pg_index i where i.indrelid=con.conrelid and i.indisvalid and i.indpred is null
 and (select array_agg(attnum order by ord) from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord) where ord<=cardinality(con.conkey))=con.conkey)
 loop
 select string_agg(quote_ident(a.attname),',' order by k.ord) into cols from unnest(c.conkey) with ordinality k(attnum,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum;
 execute format('create index %I on %I.%I(%s)',left('fk_'||c.conname,63),c.nspname,c.relname,cols);
 end loop;
end $$;
