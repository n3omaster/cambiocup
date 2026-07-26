import { supabase } from '@/lib/supabase'

const PAGE_SIZE = 1000
const MAX_PAGES = 150 // tope de seguridad: hasta 150k filas crudas
const CONCURRENCY = 10
const TARGET_POINTS = 2000

// Historia completa para el terreno del juego: cuenta las filas, pagina en
// paralelo más allá del tope implícito de 1000, y bucketiza a ~TARGET_POINTS
// promediados. Compartida por /api/game-history (que la cachea en el edge) y
// por el verificador de replays de /api/game-score.
//
// `asOf` (ms) reconstruye EXACTAMENTE el dataset que existía en ese momento:
// las filas de exchange son append-only con updated_at monotónico, así que
// filtrar updated_at <= asOf devuelve el mismo snapshot que vio el cliente.
// `rev` en el resultado es el updated_at crudo (ms) de la última fila usada —
// el cliente lo devuelve con su score para fijar el mapa contra el que se
// verifica su replay.
const getBucketedHistory = async (coinId, asOf = null) => {

	// rev viaja truncado a ms pero updated_at tiene microsegundos: el corte es
	// "< rev + 1ms" para incluir la propia fila que definió el rev (no hay dos
	// filas del mismo coin en el mismo ms — el cron escribe cada 10 min)
	const cutoff = asOf ? new Date(asOf + 1).toISOString() : null

	let countQuery = supabase
		.from('exchange')
		.select('*', { count: 'exact', head: true })
		.eq('coin_id', coinId)
	if (cutoff) countQuery = countQuery.lt('updated_at', cutoff)
	const { count, error: countError } = await countQuery

	if (countError || !count) {
		if (countError) console.error('Error counting game history:', countError)
		return { points: [], rev: null }
	}

	const totalPages = Math.min(Math.ceil(count / PAGE_SIZE), MAX_PAGES)
	const fetchPage = (page) => {
		let q = supabase
			.from('exchange')
			.select('value, updated_at')
			.eq('coin_id', coinId)
			.order('updated_at', { ascending: true })
			.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
		if (cutoff) q = q.lt('updated_at', cutoff)
		return q
	}

	const rows = []
	for (let start = 0; start < totalPages; start += CONCURRENCY) {
		const batch = Array.from(
			{ length: Math.min(CONCURRENCY, totalPages - start) },
			(_, i) => fetchPage(start + i),
		)
		const results = await Promise.all(batch)
		for (const { data, error } of results) {
			if (error) { console.error('Error fetching game history page:', error); continue }
			if (data?.length) rows.push(...data)
		}
	}

	if (!rows.length) return { points: [], rev: null }

	const first = new Date(rows[0].updated_at).getTime()
	const last = new Date(rows[rows.length - 1].updated_at).getTime()
	const span = Math.max(last - first, 1)
	const bucketMs = Math.max(Math.ceil(span / TARGET_POINTS), 10 * 60 * 1000)

	const buckets = new Map()
	for (const row of rows) {
		const key = Math.floor((new Date(row.updated_at).getTime() - first) / bucketMs)
		const bucket = buckets.get(key) || { sum: 0, count: 0 }
		bucket.sum += row.value
		bucket.count++
		buckets.set(key, bucket)
	}

	const points = [...buckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([key, bucket]) => ({
			time: Math.floor((first + key * bucketMs + bucketMs / 2) / 1000),
			value: Number((bucket.sum / bucket.count).toFixed(4)),
		}))

	return { points, rev: last }
}

export { getBucketedHistory }
