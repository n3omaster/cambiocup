-- ─────────────────────────────────────────────────────────────────────────────
-- Identidad verificada de QvaPay en CUP Runner (cambiocup como mini-app de QvaPay).
-- Pegar en el SQL editor de Supabase. Idempotente.
--
-- Dentro de la app de QvaPay el jugador puede "Entrar con QvaPay": el server verifica el
-- init_data firmado por QvaPay (lib/qvapay.js) y el run se guarda con el @usuario
-- VERIFICADO en `name`, más estas dos columnas. Fuera de la app nada cambia (@ de Telegram
-- tecleado, verified = false).
--
-- El código ya está preparado para correr ANTES de este script: saveGameScore reintenta sin
-- estas columnas (PGRST204/42703) y las lecturas del ranking se repiten sin `verified`, así
-- que hasta correrlo solo faltan las insignias de verificado.
-- ─────────────────────────────────────────────────────────────────────────────

-- uuid de la cuenta de QvaPay que jugó (identidad estable aunque cambie de @). No se expone
-- en ninguna respuesta pública: solo `verified`.
alter table game_scores add column if not exists qvapay_uuid text;

-- true = el nombre salió de una sesión de QvaPay, no de un @ tecleado
alter table game_scores add column if not exists verified boolean not null default false;

-- Récords de una cuenta de QvaPay (premios semanales, soporte)
create index if not exists game_scores_qvapay_uuid_idx
  on game_scores (qvapay_uuid, score desc) where qvapay_uuid is not null and flagged = false;
