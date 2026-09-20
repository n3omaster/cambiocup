import { NextResponse } from 'next/server'
import { saveGameScore, getTopScores, getTopScoresForDay, countScoresAbove, countGameRuns, getOffersByIds } from '@/lib/supabase'
import { verifyToken } from '@/lib/gameToken'
import { decodePayload } from '@/app/utils/gameCodec'
import { buildCourse, simulateRun, STEP_HZ } from '@/app/utils/gameSim'
import { getBucketedHistory } from '@/lib/gameHistory'
import { currentMapCutoff } from '@/lib/gameDay'

// Telegram username: 5-32 chars, letters/digits/underscore, starts with a letter
const TG_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/

// Techos de cordura, NO de juego: el replay verifica el score exacto, así que
// estos números solo existen para no re-simular reclamos absurdos. El máximo
// teórico de la pista es ~2,6M de base y hasta ~4× con los multiplicadores de
// ETECSA/TROPICAL, así que cualquier tope por debajo de eso tira runs legítimos
// a la basura (era el bug: MAX_SCORE valía 500.000 y el #1 real quedaba fuera).
const MAX_SCORE = 15000000
const MAX_DAY = 20000

// Ventana del run token: mínimo para descartar submits instantáneos, máximo
// holgado para que quepa un run completo (~6 min hasta la meta) más compartir
// la tarjeta y escribir el @ de Telegram antes de enviar
const MIN_ELAPSED_S = 3
const MAX_TOKEN_AGE_S = 60 * 60

// Límites del replay: el snapshot del mapa (rev) no puede ser más viejo que el
// edge-cache + margen, la sim no puede durar más que la vida real del token, y
// la traza tiene topes de tamaño generosos para runs humanos.
//
// SIM_SLACK_S absorbe la latencia entre que arranca el run y que el server
// firma el token: ese tiempo NO cuenta como `elapsed`, así que en una conexión
// lenta un run legítimo parecía durar más que su propio token. 5 s se quedaban
// cortos en móvil cubano — de ahí buena parte de los runs honesty-flagged.
// El mapa se congela a medianoche de La Habana, así que al final del día su rev
// ya tiene ~24 h (y hasta 25 h la noche del cambio de horario). 36 h deja
// margen para eso más el edge-cache, sin abrir la puerta a revivir mapas viejos.
const REV_MAX_AGE_MS = 36 * 3600 * 1000
const SIM_SLACK_S = 20
const OFFER_WINDOW_MS = 5 * 60 * 1000
const MAX_JUMPS = 5000
const MAX_OFFERS = 400
const MAX_RESIZES = 400
const MIN_DIM = 200
const MAX_DIM = 6000

const isStep = (v) => Number.isInteger(v) && v >= 0
const isDim = (v) => Number.isFinite(v) && v >= MIN_DIM && v <= MAX_DIM

const fail = (reason) => ({ ok: false, reason })

// Re-simula el run completo con el motor compartido (gameSim) sobre el MISMO
// mapa que vio el cliente (reconstruido con rev) y los MISMOS eventos en vivo
// (leídos de la tabla offers, no del cliente). El score solo es válido si la
// física lo reproduce exactamente: inyectar un número en el cliente ya no sirve
// — haría falta una secuencia de saltos que de verdad lo logre, jugando.
//
// Devuelve {ok:true} o {ok:false, reason}; el motivo se guarda en la fila
// flagged para poder distinguir un tramposo de un bug de verificación.
const verifyRun = async (params) => {
	// Cualquier traza que reviente la sim es trampa malformada: al honeypot, no a un 400
	try { return await verifyRunInner(params) } catch { return fail('sim-crash') }
}

const verifyRunInner = async ({ run, rev, score, day, tok, elapsed }) => {

	if (!run || typeof run !== 'object') return fail('no-trace')
	if (!isDim(run.w) || !isDim(run.h)) return fail('bad-dims')

	const jumps = Array.isArray(run.jumps) ? run.jumps : null
	const offers = Array.isArray(run.offers) ? run.offers : null
	const resizes = Array.isArray(run.resizes) ? run.resizes : null
	if (!jumps || !offers || !resizes) return fail('bad-trace')
	if (jumps.length > MAX_JUMPS || offers.length > MAX_OFFERS || resizes.length > MAX_RESIZES) return fail('trace-too-big')
	if (!jumps.every(isStep)) return fail('bad-jumps')
	if (!resizes.every((r) => Array.isArray(r) && r.length === 3 && isStep(r[0]) && isDim(r[1]) && isDim(r[2]))) return fail('bad-resizes')
	if (!offers.every((o) => Array.isArray(o) && o.length === 2 && isStep(o[0]))) return fail('bad-offers')

	const now = Date.now()
	if (!Number.isFinite(rev) || rev > now + 60 * 1000 || rev < now - REV_MAX_AGE_MS) return fail('rev-window')

	// Los eventos EN VIVO de la traza son solo IDs: la moneda, el valor y el
	// estado salen de la tabla `offers`, así que el cliente no puede fabricar
	// una dinámica (ni convertir un cráter de CUP en un escudo de CLASICA)
	const offerData = new Map()
	if (offers.length) {
		const ids = [...new Set(offers.map((o) => o[1]))]
		const { data: rows, error } = await getOffersByIds(ids)
		if (error) return fail('offers-db')
		for (const row of rows || []) {
			const at = new Date(row.created_at).getTime()
			if (at < tok.t - OFFER_WINDOW_MS || at > now) return fail('offer-window')
			offerData.set(String(row.id), { value: Number(row.value) || 0, coin: row.coin, status: row.status })
		}
		if (offerData.size !== ids.length) return fail('offer-missing')
	}

	const { points } = await getBucketedHistory(1, rev) // 1 = CUP, la única moneda del juego
	if (points.length < 50) return fail('map-short')

	const maxSteps = Math.min(Math.ceil((elapsed + SIM_SLACK_S) * STEP_HZ), MAX_TOKEN_AGE_S * STEP_HZ)
	const result = simulateRun(buildCourse(points), run, maxSteps, offerData)

	// El run termina muriendo O cruzando la meta (la bandera de "hoy") — ambos
	// finales los reproduce la sim; un run que no terminó no puntúa
	if (!result.died && !result.won) return fail('never-ended')
	if (result.score !== score) return fail(`score-mismatch:${result.score}`)
	if (result.day !== day) return fail(`day-mismatch:${result.day}`)
	// Mínimo simbólico: solo descarta trazas degeneradas. Un run honesto puede
	// durar un segundo — medido en producción, 14 de 15 rechazos de un día eran
	// jugadores reales muriendo en el día 3 con 0 puntos. Contra el submit
	// instantáneo protege la edad del token (MIN_ELAPSED_S), no esto.
	if (result.steps < 30) return fail('too-short')
	if (result.steps / STEP_HZ > elapsed + SIM_SLACK_S) return fail('too-long')

	return { ok: true }
}

// Mejor marca por jugador, en orden
const bestPerPlayer = (rows, max = 10) => {
	const seen = new Set()
	const top = []
	for (const row of rows || []) {
		const key = row.name.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		top.push(row)
		if (top.length === max) break
	}
	return top
}

// GET → leaderboard: histórico (todos los tiempos) + el del DÍA de hoy.
// El del día es el único estrictamente justo: el mapa se congela a medianoche,
// así que todas esas partidas corrieron la misma pista. El histórico se queda
// porque nadie debe perder su récord, pero mezcla mapas distintos.
export async function GET() {

	const { day } = currentMapCutoff()
	const [allTime, today, { count }] = await Promise.all([
		getTopScores(100),
		getTopScoresForDay(day, 100),
		countGameRuns(),
	])

	if (allTime.error) { console.error('Error fetching leaderboard:', allTime.error); return NextResponse.json({ top: [], today: [], runs: 0, mapDay: day }) }

	return NextResponse.json({
		top: bestPerPlayer(allTime.data),
		today: bestPerPlayer(today.data),
		mapDay: day,
		runs: count || 0,
	})
}

// POST → save a run, return the global rank.
// Real clients send {t: runToken, d: scrambled payload} where the payload
// carries the full input trace of the run. Anything else — plain JSON, a valid
// token whose trace doesn't reproduce the claimed score, offers that never
// happened — is the honeypot: saved with flagged=true (never shown on the
// leaderboard) and answered with a believable rank so the cheater thinks it
// worked and stops digging. `flag_reason` guarda POR QUÉ falló, que es lo único
// que permite distinguir después un tramposo de un fallo de verificación.
export async function POST(request) {

	try {

		const body = await request.json()

		let raw = body
		let envelope = false

		if (typeof body.t === 'string' && typeof body.d === 'string') {
			raw = decodePayload(body.d, body.t) // throws on tampered blobs → 400 below
			envelope = true
		}

		// Validación de forma ANTES de re-simular: un submit basura no merece
		// que el server le reconstruya el mapa entero y le corra la física
		const rawUser = String(raw.name || '').trim().replace(/^@+/, '')
		const score = Math.round(Number(raw.score))
		const day = Math.round(Number(raw.day))

		if (!TG_RE.test(rawUser)) {
			return NextResponse.json({ error: 'Usuario de Telegram inválido (5-32 caracteres, letras/números/_)' }, { status: 400 })
		}
		const name = `@${rawUser.toLowerCase()}`
		if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
			return NextResponse.json({ error: 'Puntuación inválida' }, { status: 400 })
		}
		if (!Number.isFinite(day) || day < 1 || day > MAX_DAY) {
			return NextResponse.json({ error: 'Día inválido' }, { status: 400 })
		}

		let flagged = true
		let reason = 'plain-body'
		let nonce = null
		let trace = null

		if (envelope) {
			const tok = verifyToken(body.t)
			const elapsed = tok ? (Date.now() - tok.t) / 1000 : -1
			if (!tok) reason = 'bad-token'
			else if (elapsed < MIN_ELAPSED_S) reason = 'too-fast'
			else if (elapsed > MAX_TOKEN_AGE_S) reason = 'token-expired'
			// Cotas groseras para no re-simular reclamos imposibles. El turbo de
			// TROPICAL sube hasta 1,35× los días/segundo (peor caso real medido:
			// 3,95) y los multiplicadores hasta 4× el score, así que van holgadas.
			else if (day > elapsed * 15) reason = 'day-rate'
			else if (score > 500 * elapsed * elapsed + 20000) reason = 'score-rate'
			else {
				const verdict = await verifyRun({ run: raw.run, rev: Number(raw.rev), score, day, tok, elapsed })
				if (verdict.ok) {
					flagged = false
					reason = null
					nonce = tok.n
					// La traza verificada es el fantasma: ~700 B comprimida, y con el
					// mapa del día reproduce la partida exacta
					trace = raw.run
				} else reason = verdict.reason
			}
		}

		if (flagged) console.warn(`[game-score] flagged ${name} score=${score} day=${day} reason=${reason}`)

		const { day: mapDay } = currentMapCutoff()
		const { error } = await saveGameScore(name, score, day, flagged, nonce, reason, mapDay, trace)
		// 23505 = nonce already used (a replayed request): skip the save but keep
		// the fake success so replays learn nothing
		if (error && error.code !== '23505') {
			// 23514 = CHECK de la tabla (score_cap/day_cap). Si aparece, falta correr
			// scripts/fix-score-caps.sql: los topes viejos de la base siguen puestos
			// y están tirando runs legítimos igual que antes.
			if (error.code === '23514') console.error('¡Falta correr scripts/fix-score-caps.sql! Los CHECK viejos de game_scores están rechazando runs:', error.message)
			else console.error('Error saving score:', error)
			return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
		}

		// Rank against the clean board only — flagged runs still get a plausible
		// number back, they just never appear anywhere
		const { count } = await countScoresAbove(score)

		return NextResponse.json({ rank: (count ?? 0) + 1 })

	} catch (err) {
		console.error('Error in game-score POST:', err)
		return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
	}
}
