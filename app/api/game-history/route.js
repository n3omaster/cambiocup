import { NextResponse } from 'next/server'
import { COIN_IDS } from '@/lib/supabase'
import { getBucketedHistory } from '@/lib/gameHistory'

// Historia completa para el terreno del juego (lógica compartida en
// lib/gameHistory.js). `rev` identifica el snapshot exacto: el cliente lo
// devuelve junto a su score y el server reconstruye el mismo mapa para
// verificar el replay. Cacheado en el edge por una hora.
export async function GET(request) {

	const { searchParams } = new URL(request.url)
	const coin = (searchParams.get('coin') || 'CUP').toUpperCase()
	const coinId = COIN_IDS[coin] || 1

	const { points, rev } = await getBucketedHistory(coinId)

	if (!points.length) return NextResponse.json({ data: [], coin })

	return NextResponse.json(
		{ data: points, coin, rev },
		{ headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
	)
}
