-- ─────────────────────────────────────────────────────────────────────────────
-- API pública de historial (/api/v1/history). Pegar en el SQL editor de Supabase. Idempotente.
--
-- La ruta se puede desplegar antes de correr esto: mientras falte, interval=1d responde 503
-- y interval=raw funciona igual (solo va más lento sin el índice). El resto del sitio no
-- depende de nada de este script.
--
-- `create index` sin `concurrently` bloquea las escrituras en `exchange` mientras se construye
-- (el SQL editor corre en una transacción, donde `concurrently` no se puede usar). Con unas
-- 330k filas tarda segundos y el cron solo escribe cada 10 minutos.
-- ─────────────────────────────────────────────────────────────────────────────

-- Rango por moneda ordenado por tiempo: lo usan el agregado diario y la paginación de raw
create index if not exists exchange_coin_id_updated_at_idx
  on exchange (coin_id, updated_at);

-- Una fila por día de La Habana, en un solo JSON: así el tope de 1000 filas de PostgREST no
-- corta el resultado y el server no tiene que traer las filas crudas para agregarlas.
--
-- p_from y p_to son días de La Habana, ambos incluidos. `date at time zone` resuelve bien la
-- noche del cambio de hora: las 00:00 inexistentes caen en el primer instante real del día.
create or replace function exchange_daily(
  p_coin_id int,
  p_from date default null,
  p_to date default null
)
returns json
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(json_agg(d order by d."date"), '[]'::json)
  from (
    select
      (updated_at at time zone 'America/Havana')::date as "date",
      (array_agg(value order by updated_at asc))[1] as open,
      max(value) as high,
      min(value) as low,
      (array_agg(value order by updated_at desc))[1] as close,
      round(avg(value)::numeric, 4) as avg,
      count(*)::int as samples
    from exchange
    where coin_id = p_coin_id
      and (p_from is null or updated_at >= (p_from::timestamp at time zone 'America/Havana'))
      and (p_to is null or updated_at < ((p_to + 1)::timestamp at time zone 'America/Havana'))
    group by 1
  ) d
$$;
