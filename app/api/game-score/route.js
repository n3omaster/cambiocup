import { NextResponse } from 'next/server'
import { saveGameScore, getTopScores, countScoresAbove, countGameRuns } from '@/lib/supabase'

// Telegram username: 5-32 chars, letters/digits/underscore, starts with a letter
const TG_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/
const MAX_SCORE = 500000
const MAX_DAY = 10000

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

// POST {name, score, day} → save a run, return the global rank
export async function POST(request) {

	try {

		const body = await request.json()
		const rawUser = String(body.name || '').trim().replace(/^@+/, '')
		const score = Math.round(Number(body.score))
		const day = Math.round(Number(body.day))

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

		const { error } = await saveGameScore(name, score, day)
		if (error) { console.error('Error saving score:', error); return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 }) }

		const { count } = await countScoresAbove(score)

		return NextResponse.json({ rank: (count ?? 0) + 1 })

	} catch (err) {
		console.error('Error in game-score POST:', err)
		return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
	}
}
