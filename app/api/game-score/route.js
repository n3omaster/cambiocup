import { NextResponse } from 'next/server'
import { saveGameScore, getTopScores, countScoresAbove, countGameRuns } from '@/lib/supabase'
import { verifyToken } from '@/lib/gameToken'
import { decodePayload } from '@/app/utils/gameCodec'

// Telegram username: 5-32 chars, letters/digits/underscore, starts with a letter
const TG_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/
const MAX_SCORE = 500000
const MAX_DAY = 10000

// Plausibility bounds vs the run token's age (the run's real duration):
// - the engine tops out at ~470 px/s ≈ 5.2 course points/s ≈ 2.5 game-days/s
//   with today's history span; 6 leaves margin as the history grows
// - score grows ~quadratically with combo: ≤ ~12.5·(coins/s·t)² ≈ 50·t²
const MIN_ELAPSED_S = 3
const MAX_TOKEN_AGE_S = 6 * 3600
const MAX_DAYS_PER_SEC = 6
const SCORE_QUAD_PER_SEC = 50

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
// Real clients send {t: runToken, d: scrambled payload}; anything else — the
// plain {name, score, day} JSON people curl by hand — is the honeypot: it gets
// saved with flagged=true (never shown on the leaderboard) and answered with a
// believable rank so the cheater thinks it worked.
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
				claimedDay <= elapsed * MAX_DAYS_PER_SEC &&
				claimedScore <= SCORE_QUAD_PER_SEC * elapsed * elapsed + 5000
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
