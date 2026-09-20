import { NextResponse } from 'next/server'
import { touchPresence, countPresence, sweepPresence, getRecentRuns } from '@/lib/supabase'

// Presencia en vivo: cuánta gente está corriendo ahora mismo, y las últimas
// caídas. No es multiplayer de verdad, pero es lo que hace que el juego se
// sienta acompañado — y cuesta un latido cada 20 s.

// POST {id, day, score} → latido de un cliente jugando
export async function POST(request) {
	try {
		const { id, day, score } = await request.json()
		// El id lo genera el cliente y solo sirve para contar sesiones distintas
		if (typeof id !== 'string' || id.length < 8 || id.length > 64) {
			return NextResponse.json({ error: 'id inválido' }, { status: 400 })
		}
		await touchPresence(id, Number.isFinite(Number(day)) ? Math.round(Number(day)) : null, Number.isFinite(Number(score)) ? Math.round(Number(score)) : null)
		return NextResponse.json({ ok: true })
	} catch {
		return NextResponse.json({ error: 'Solicitud inválida' }, { status: 400 })
	}
}

// GET → {live, recent: [{name, score, day}]}
export async function GET() {
	const [{ count }, { data }] = await Promise.all([countPresence(), getRecentRuns(6)])
	sweepPresence().catch(() => { /* limpieza best-effort */ })
	return NextResponse.json({ live: count || 0, recent: data || [] })
}
