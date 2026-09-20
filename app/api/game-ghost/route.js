import { NextResponse } from 'next/server'
import { getGhostRun, getPersonalGhost, getOffersByIds } from '@/lib/supabase'
import { currentMapCutoff } from '@/lib/gameDay'

// El fantasma contra el que corres: la mejor partida VERIFICADA del mapa de hoy.
//
// Funciona porque el mapa está congelado (lib/gameDay.js): esa traza y la tuya
// corren la misma pista, así que re-simularla en tu cliente reproduce el run
// exacto de la otra persona. Solo cuesta ~700 B.
//
// Las ofertas en vivo que ESA persona enfrentó no existen en tu partida, así
// que van resueltas en la respuesta: el cliente las aplica a la simulación del
// fantasma (y dibuja sus cráteres y dólares en translúcido) para que se entienda
// por qué salta donde salta.
export async function GET(request) {

	const { searchParams } = new URL(request.url)
	const self = searchParams.get('self') // "@usuario" → su propio récord del día
	const exclude = searchParams.get('exclude')

	const { day: mapDay } = currentMapCutoff()

	const { data, error } = self
		? await getPersonalGhost(mapDay, self.toLowerCase())
		: await getGhostRun(mapDay, exclude ? exclude.toLowerCase() : null)

	if (error) { console.error('Error fetching ghost:', error); return NextResponse.json({ ghost: null, mapDay }) }
	if (!data?.trace) return NextResponse.json({ ghost: null, mapDay })

	// Resuelve las ofertas de esa partida para que el cliente reproduzca sus
	// dinámicas idénticas (imán, escudo, turbo…)
	const offers = {}
	const ids = [...new Set((data.trace.offers || []).map((o) => o[1]))]
	if (ids.length) {
		const { data: rows } = await getOffersByIds(ids)
		for (const row of rows || []) offers[String(row.id)] = { value: Number(row.value) || 0, coin: row.coin, status: row.status }
	}

	return NextResponse.json({
		ghost: { name: data.name, score: data.score, day: data.day, run: data.trace, offers },
		mapDay,
	})
}
