import { NextResponse } from 'next/server'
import { COIN_IDS } from '@/lib/supabase'
import { getBucketedHistory } from '@/lib/gameHistory'
import { currentMapCutoff, secondsUntilNextMap } from '@/lib/gameDay'

// Terreno del juego: la historia real del CUP, CONGELADA a la medianoche de La
// Habana. Todo el que juegue hoy corre exactamente la misma pista — de eso
// dependen el ranking del día, los fantasmas y los duelos (ver lib/gameDay.js).
//
// `rev` identifica el snapshot exacto: el cliente lo devuelve junto a su score
// y el server reconstruye el mismo mapa para verificar el replay. `mapDay` es
// el día de juego ("2026-09-20"), con el que se agrupa el ranking diario.
export async function GET(request) {

	const { searchParams } = new URL(request.url)
	const coin = (searchParams.get('coin') || 'CUP').toUpperCase()
	const coinId = COIN_IDS[coin] || 1

	const { day, cutoff } = currentMapCutoff()
	const { points, rev } = await getBucketedHistory(coinId, cutoff)

	if (!points.length) return NextResponse.json({ data: [], coin })

	// Se cachea justo hasta el próximo corte: el mapa no cambia en todo el día
	return NextResponse.json(
		{ data: points, coin, rev, mapDay: day },
		{ headers: { 'Cache-Control': `s-maxage=${secondsUntilNextMap()}, stale-while-revalidate=3600` } },
	)
}
