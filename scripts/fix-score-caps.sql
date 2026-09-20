-- ─────────────────────────────────────────────────────────────────────────────
-- OBLIGATORIO antes (o a la vez que) el deploy. Sin esto, todo run por encima
-- de 500.000 puntos responde 500 y NO se guarda.
--
-- La tabla tenía dos CHECK espejo de las constantes viejas del API:
--   score_cap  →  score <= 500000
--   day_cap    →  day   <= 10000
-- El máximo real de la pista es ~2,6 M de base (y hasta ~4× con los
-- multiplicadores de ETECSA/TROPICAL), y el día final ronda 1.053 y crece con
-- la historia. Los techos viejos tiraban a la basura los mejores runs: el #1
-- del ranking (484.275) estaba pegado al tope, no era el límite del juego.
--
-- Pegar en el SQL editor de Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

alter table game_scores drop constraint if exists score_cap;
alter table game_scores add constraint score_cap check (score >= 0 and score <= 15000000);

alter table game_scores drop constraint if exists day_cap;
alter table game_scores add constraint day_cap check (day >= 1 and day <= 20000);

-- Motivo por el que un run cayó al honeypot. Sin esto no hay forma de
-- distinguir un tramposo de un fallo de verificación (token lento, mapa
-- irreproducible, deploy a mitad de run…), que era ~40% de los runs.
alter table game_scores add column if not exists flag_reason text;

-- Para revisar qué está fallando de verdad:
--   select flag_reason, count(*), max(score) as peor_caso
--   from game_scores where flagged and created_at > now() - interval '7 days'
--   group by flag_reason order by count(*) desc;
