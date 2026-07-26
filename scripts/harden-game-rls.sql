-- Endurecer RLS de game_scores (pegar TAL CUAL en Supabase → SQL Editor y ejecutar).
--
-- El backend accede con service_role, que BYPASSA RLS siempre, así que eliminar
-- todas las políticas de esta tabla NO rompe el juego: el leaderboard y el guardado
-- siguen pasando por /api/game-score (que ya verifica el replay). Lo que cierra es
-- la puerta trasera de insertar/leer directo con el anon key saltándose el anti-cheat.

-- (Opcional) Inspeccionar las políticas actuales antes de borrarlas:
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'game_scores';

-- Eliminar TODAS las políticas de public.game_scores (sin nombres hardcodeados):
DO $$
DECLARE p record;
BEGIN
	FOR p IN
		SELECT policyname FROM pg_policies
		WHERE schemaname = 'public' AND tablename = 'game_scores'
	LOOP
		EXECUTE format('DROP POLICY %I ON public.game_scores;', p.policyname);
	END LOOP;
END $$;

-- Mantener RLS activo: sin políticas, ningún rol (anon/authenticated) puede tocar
-- la tabla; solo service_role la usa, y ese bypassa RLS.
ALTER TABLE public.game_scores ENABLE ROW LEVEL SECURITY;

-- Verificar que no queda ninguna política:
SELECT count(*) AS politicas_restantes FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'game_scores';
