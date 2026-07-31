import { NextResponse } from 'next/server'
import { saveGameScore, getTopScores, countScoresAbove, countGameRuns, getOffersByIds } from '@/lib/supabase'
import { verifyToken } from '@/lib/gameToken'
import { decodePayload } from '@/app/utils/gameCodec'
import { buildCourse, simulateRun, STEP_HZ } from '@/app/utils/gameSim'
import { getBucketedHistory } from '@/lib/gameHistory'

// Telegram username: 5-32 chars, letters/digits/underscore, starts with a letter
const TG_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/
const MAX_SCORE = 500000
const MAX_DAY = 10000

// Ventana del run token: mínimo para descartar submits instantáneos, máximo
// corto (antes 6 h) para que no se puedan pre-cosechar tokens y "envejecerlos"
const MIN_ELAPSED_S = 3
const MAX_TOKEN_AGE_S = 30 * 60

// Límites del replay: el snapshot del mapa (rev) no puede ser más viejo que el
// edge-cache + margen, la sim no puede durar más que la vida real del token, y
// la traza tiene topes de tamaño generosos para runs humanos
const REV_MAX_AGE_MS = 26 * 3600 * 1000
const SIM_SLACK_S = 5
const OFFER_WINDOW_MS = 5 * 60 * 1000
const MAX_JUMPS = 5000
const MAX_OFFERS = 300
const MAX_RESIZES = 200
const MIN_DIM = 200
const MAX_DIM = 6000

const isStep = (v) => Number.isInteger(v) && v >= 0
const isDim = (v) => Number.isFinite(v) && v >= MIN_DIM && v <= MAX_DIM

// Re-simula el run completo con el motor compartido (gameSim) sobre el MISMO
// mapa que vio el cliente (reconstruido con rev) y los MISMOS eventos en vivo
// (verificados contra la tabla offers). El score solo es válido si la física
// lo reproduce exactamente: inyectar un número en el cliente ya no sirve —
// haría falta una secuencia de saltos que de verdad lo logre, jugando.
const verifyRun = async (params) => {
	// Cualquier traza que reviente la sim es trampa malformada: al honeypot, no a un 400
	try { return await verifyRunInner(params) } catch { return false }
}

const verifyRunInner = async ({ run, rev, score, day, tok, elapsed }) => {

	if (!run || typeof run !== 'object') return false
	if (!isDim(run.w) || !isDim(run.h)) return false

	const jumps = Array.isArray(run.jumps) ? run.jumps : null
	const offers = Array.isArray(run.offers) ? run.offers : null
	const resizes = Array.isArray(run.resizes) ? run.resizes : null
	if (!jumps || !offers || !resizes) return false
	if (jumps.length > MAX_JUMPS || offers.length > MAX_OFFERS || resizes.length > MAX_RESIZES) return false
	if (!jumps.every(isStep)) return false
	if (!resizes.every((r) => Array.isArray(r) && r.length === 3 && isStep(r[0]) && isDim(r[1]) && isDim(r[2]))) return false
	if (!offers.every((o) => Array.isArray(o) && o.length === 3 && isStep(o[0]) && Number.isFinite(o[2]))) return false

	const now = Date.now()
	if (!Number.isFinite(rev) || rev > now + 60 * 1000 || rev < now - REV_MAX_AGE_MS) return false

	// Las ofertas EN VIVO de la traza deben existir y haber ocurrido durante el run
	if (offers.length) {
		const ids = [...new Set(offers.map((o) => o[1]))]
		const { data: rows, error } = await getOffersByIds(ids)
		if (error) return false
		const byId = new Map((rows || []).map((r) => [String(r.id), r]))
		for (const [, id, value] of offers) {
			const row = byId.get(String(id))
			if (!row || (Number(row.value) || 0) !== value) return false
			const at = new Date(row.created_at).getTime()
			if (at < tok.t - OFFER_WINDOW_MS || at > now) return false
		}
	}

	const { points } = await getBucketedHistory(1, rev) // 1 = CUP, la única moneda del juego
	if (points.length < 50) return false

	const maxSteps = Math.min(Math.ceil((elapsed + SIM_SLACK_S) * STEP_HZ), MAX_TOKEN_AGE_S * STEP_HZ)
	const result = simulateRun(buildCourse(points), run, maxSteps)

	// El run termina muriendo O cruzando la meta (la bandera de "hoy") — ambos
	// finales los reproduce la sim; un run que no terminó no puntúa
	return (
		(result.died || result.won) &&
		result.score === score &&
		result.day === day &&
		result.steps >= MIN_ELAPSED_S * STEP_HZ &&
		result.steps / STEP_HZ <= elapsed + SIM_SLACK_S
	)
}

// GET → leaderboard: top 10 (best score per player) + total runs
export async function GET() {

	const [{ data, error }, { count }] = await Promise.all([getTopScores(100), countGameRuns()])

	if (error) { console.error('Error fetching leaderboard:', error); return NextResponse.json({ top: [], runs: 0 }) }

	const seen = new Set()
	const top = []
	for (const row of data || []) {
		const key = row.name.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		top.push(row)
		if (top.length === 10) break
	}

	return NextResponse.json({ top, runs: count || 0 })
}

// POST → save a run, return the global rank.
// Real clients send {t: runToken, d: scrambled payload} where the payload
// carries the full input trace of the run. Anything else — plain JSON, a valid
// token whose trace doesn't reproduce the claimed score, offers that never
// happened — is the honeypot: saved with flagged=true (never shown on the
// leaderboard) and answered with a believable rank so the cheater thinks it
// worked and stops digging.
export async function POST(request) {

	try {

		const body = await request.json()

		let raw = body
		let flagged = true
		let nonce = null

		if (typeof body.t === 'string' && typeof body.d === 'string') {
			raw = decodePayload(body.d, body.t) // throws on tampered blobs → 400 below
			const tok = verifyToken(body.t)
			const elapsed = tok ? (Date.now() - tok.t) / 1000 : -1
			const claimedScore = Math.round(Number(raw.score))
			const claimedDay = Math.round(Number(raw.day))
			if (
				tok &&
				elapsed >= MIN_ELAPSED_S && elapsed <= MAX_TOKEN_AGE_S &&
				claimedDay <= elapsed * 6 &&
				claimedScore <= 50 * elapsed * elapsed + 5000 &&
				await verifyRun({ run: raw.run, rev: Number(raw.rev), score: claimedScore, day: claimedDay, tok, elapsed })
			) {
				flagged = false
				nonce = tok.n
			}
		}

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

		const { error } = await saveGameScore(name, score, day, flagged, nonce)
		// 23505 = nonce already used (a replayed request): skip the save but keep
		// the fake success so replays learn nothing
		if (error && error.code !== '23505') {
			console.error('Error saving score:', error)
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
