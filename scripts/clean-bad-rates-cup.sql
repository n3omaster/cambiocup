-- ─────────────────────────────────────────────────────────────────────────────
-- Limpieza de tasas corruptas: CUP.
-- Pegar en el SQL editor de Supabase (proyecto iscanqcymuirrlddnscn).
--
-- CORRER A LAS 00:00 DE LA HABANA, justo después del corte del mapa. El terreno de CUP Runner sale de
-- estas filas: borrarlas a mitad del día cambia el mapa que el verificador reconstruye, y todos los
-- runs de ese día terminan marcados como trampa. Algún run en curso en ese momento puede perderse.
--
-- Borra 13 filas con el valor a la mitad y 1 sin valor. El cron de entonces aceptaba un
-- promedio en 0 de QvaPay, y (compra + 0) / 2 guardaba la tasa partida a la mitad. Las filas van
-- listadas una a una, con su timestamp exacto, y salieron de comparar cada fila con la mediana
-- de sus 300 vecinas (entre 0,4 y 0,6 veces esa mediana). No incluye las 6 filas atípicas que no
-- son una mitad (CUP en diciembre de 2023, MLC el 2025-12-30), porque no se puede afirmar que sean
-- errores.
--
-- Copia antes de borrar: las filas pasan a `exchange_removed`. Si el conteo no es 14 (o 0, si
-- el script ya corrió), lanza un error y no cambia nada.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists exchange_removed as select * from exchange with no data;
alter table exchange_removed enable row level security; -- sin políticas: solo service_role

do $$
declare
  halved int;
  empty int;
begin
  with targets (coin_id, updated_at) as (
    values
      (1, '2023-12-26T23:33:52.246Z'::timestamptz),
      (1, '2025-08-29T19:00:08.114477Z'::timestamptz),
      (1, '2025-09-11T13:00:08.812664Z'::timestamptz),
      (1, '2025-09-11T13:30:08.622238Z'::timestamptz),
      (1, '2025-09-11T14:00:09.022669Z'::timestamptz),
      (1, '2025-09-11T14:30:08.491183Z'::timestamptz),
      (1, '2025-09-11T15:00:09.566472Z'::timestamptz),
      (1, '2025-09-11T15:30:08.50567Z'::timestamptz),
      (1, '2025-09-11T16:00:09.581923Z'::timestamptz),
      (1, '2025-09-11T16:30:08.821463Z'::timestamptz),
      (1, '2025-09-11T17:00:10.909385Z'::timestamptz),
      (1, '2025-09-11T17:30:09.896487Z'::timestamptz),
      (1, '2025-09-11T18:00:09.611622Z'::timestamptz)
  ),
  deleted as (
    delete from exchange e
    using targets t
    where e.coin_id = t.coin_id and e.updated_at = t.updated_at
    returning e.*
  )
  insert into exchange_removed select * from deleted;
  get diagnostics halved = row_count;

  with deleted as (
    delete from exchange where value is null and coin_id = 1 returning *
  )
  insert into exchange_removed select * from deleted;
  get diagnostics empty = row_count;

  if halved + empty not in (0, 14) then
    raise exception 'Se esperaban 14 filas y salieron % a la mitad y % sin valor. No se borró nada.', halved, empty;
  end if;

  raise notice 'Borradas % filas a la mitad y % sin valor', halved, empty;
end
$$;
