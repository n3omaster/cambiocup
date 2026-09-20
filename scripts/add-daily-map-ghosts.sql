-- ─────────────────────────────────────────────────────────────────────────────
-- Mapa diario congelado + fantasmas + presencia en vivo.
-- Correr DESPUÉS de scripts/fix-score-caps.sql. Pegar en el SQL editor de Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- Día de juego (La Habana) del mapa sobre el que se corrió la partida. El mapa
-- se congela a medianoche, así que dos runs con el mismo map_day corrieron
-- EXACTAMENTE la misma pista — que es lo que hace comparable el ranking del día.
alter table game_scores add column if not exists map_day date;

-- Traza de inputs del run (saltos/ofertas/resizes por paso). Solo se guarda en
-- runs verificados. Pesa ~700 B comprimida incluso en una partida ganadora de
-- 6 minutos, y con ella + el mapa del día se reproduce el run exacto: es lo que
-- permite correr contra el fantasma del mejor del día.
alter table game_scores add column if not exists trace jsonb;

-- Ranking del día y búsqueda del fantasma
create index if not exists game_scores_map_day_score_idx
  on game_scores (map_day, score desc) where flagged = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Presencia: quién está corriendo ahora mismo. Una fila por cliente, refrescada
-- con un latido cada 20 s; se considera vivo lo visto en los últimos 45 s.
-- No lleva RLS por el mismo motivo que game_scores: todo pasa por el API con
-- service_role (ver scripts/harden-game-rls.sql).
create table if not exists presence (
  id          text primary key,
  last_seen   timestamptz not null default now(),
  day         int,
  score       int
);

create index if not exists presence_last_seen_idx on presence (last_seen desc);

alter table presence enable row level security;
-- sin políticas = solo service_role puede tocarla

-- Limpieza: las filas muertas se borran solas en cada lectura del API, pero
-- esto recorta cualquier resto si el endpoint estuvo caído.
--   delete from presence where last_seen < now() - interval '10 minutes';
