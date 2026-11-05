import { NextResponse } from 'next/server'
import { COIN_IDS, getDailyHistory, getRawHistory } from '@/lib/supabase'
import { TZ, havanaDay, havanaMidnightMs } from '@/lib/gameDay'

// API pública y de solo lectura del historial completo (contrato en el README).
//
// Es una ruta aparte a propósito: /api/history es el contrato de la gráfica y getBucketedHistory
// el del anti-cheat. A diferencia de esas dos, aquí una moneda desconocida es un 400: caer en CUP
// en silencio le daría a un tercero datos de otra moneda con la etiqueta equivocada.

const COINS = Object.keys(COIN_IDS).filter((coin) => coin !== 'GAS') // GAS es una constante, no mercado
const ALIASES = { BANDECPREPAGO: 'TROPICAL' }
const INTERVALS = ['1d', 'raw']
const FORMATS = ['json', 'csv']
const MAX_LIMIT = 1000
const DAY_MS = 24 * 60 * 60 * 1000
const FIRST_DAY = '2000-01-01'
const LAST_DAY = '2100-12-31'
const DAILY_COLUMNS = ['date', 'open', 'high', 'low', 'close', 'avg', 'samples']
const RAW_COLUMNS = ['time', 'value']

const NOTE = 'Cada valor es el punto medio entre average_buy y average_sell de las operaciones P2P completadas en QvaPay, calculado sobre una ventana móvil. No es el precio de una operación: la serie va suavizada y con retraso. Con interval=1d, open, high, low y close resumen esa serie, no operaciones reales.'

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Expose-Headers': 'X-Next-Cursor',
}

// Vercel consume s-maxage y Cloudflare nunca lo vería, así que el TTL de los CDN viaja en
// CDN-Cache-Control, que leen los dos. Cache-Control queda para el navegador.
// Un rango cerrado no cambia: `exchange` es append-only. Lo abierto sigue al cron de 10 minutos.
const cacheHeaders = (settled) => settled
	? { 'Cache-Control': 'public, max-age=86400', 'CDN-Cache-Control': 'public, max-age=7776000' }
	: { 'Cache-Control': 'public, max-age=60', 'CDN-Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' }

const fail = (status, code, message, extra = {}) => NextResponse.json(
	{ error: { code, message, ...extra } },
	{ status, headers: { ...CORS, 'Cache-Control': 'no-store' } },
)

const isDay = (value) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < FIRST_DAY || value > LAST_DAY) return false
	const parsed = new Date(`${value}T00:00:00Z`)
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) // descarta 02-31
}

const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)

// base64url para que el `+00:00` del timestamp sobreviva si alguien pega el cursor en una URL
const encodeCursor = (updatedAt) => Buffer.from(updatedAt).toString('base64url')

const decodeCursor = (cursor) => {
	const value = Buffer.from(cursor, 'base64url').toString()
	const isTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?\+00:00$/.test(value)
	return isTimestamp && !Number.isNaN(Date.parse(value)) ? value : null
}

const toCsv = (columns, rows) => [
	columns.join(','),
	...rows.map((row) => columns.map((column) => row[column]).join(',')),
].join('\n') + '\n'

const respond = ({ coin, interval, format, columns, rows, nextCursor = null, settled }) => {

	const headers = { ...CORS, ...cacheHeaders(settled) }
	if (nextCursor) headers['X-Next-Cursor'] = nextCursor

	if (format === 'csv') {
		headers['Content-Type'] = 'text/csv; charset=utf-8'
		headers['Content-Disposition'] = `attachment; filename="cambiocup-${coin}-${interval}.csv"`
		return new Response(toCsv(columns, rows), { headers })
	}

	return NextResponse.json(
		{ coin, pair: `${coin}/QUSD`, interval, timezone: TZ, note: NOTE, data: rows, next_cursor: nextCursor },
		{ headers },
	)
}

export async function GET(request) {

	const params = new URL(request.url).searchParams

	const requestedCoin = (params.get('coin') || 'CUP').toUpperCase()
	const coin = ALIASES[requestedCoin] || requestedCoin
	if (!COINS.includes(coin)) return fail(400, 'INVALID_COIN', `Moneda desconocida: ${requestedCoin}`, { valid: COINS })

	const interval = (params.get('interval') || '1d').toLowerCase()
	if (!INTERVALS.includes(interval)) return fail(400, 'INVALID_INTERVAL', `Intervalo desconocido: ${interval}`, { valid: INTERVALS })

	const format = (params.get('format') || 'json').toLowerCase()
	if (!FORMATS.includes(format)) return fail(400, 'INVALID_FORMAT', `Formato desconocido: ${format}`, { valid: FORMATS })

	const from = params.get('from')
	const to = params.get('to')
	if ((from !== null && !isDay(from)) || (to !== null && !isDay(to))) {
		return fail(400, 'INVALID_DATE', `from y to deben ser fechas YYYY-MM-DD reales entre ${FIRST_DAY} y ${LAST_DAY}`)
	}
	if (from !== null && to !== null && from > to) return fail(400, 'INVALID_RANGE', 'from no puede ser posterior a to')

	const limitParam = params.get('limit')
	const cursorParam = params.get('cursor')
	if (interval !== 'raw' && (limitParam !== null || cursorParam !== null)) {
		return fail(400, 'INVALID_PARAM', 'limit y cursor solo aplican con interval=raw')
	}

	const limit = limitParam === null ? MAX_LIMIT : Number(limitParam)
	if (limitParam !== null && (!/^\d+$/.test(limitParam) || limit < 1 || limit > MAX_LIMIT)) {
		return fail(400, 'INVALID_LIMIT', `limit debe ser un entero entre 1 y ${MAX_LIMIT}`)
	}

	const after = cursorParam === null ? null : decodeCursor(cursorParam)
	if (cursorParam !== null && !after) return fail(400, 'INVALID_CURSOR', 'Usa el next_cursor de la respuesta anterior')

	const closedRange = to !== null && to < havanaDay()

	if (interval === '1d') {
		const { data, error } = await getDailyHistory(COIN_IDS[coin], from, to)
		if (error) { console.error('Error fetching daily history:', error); return fail(503, 'HISTORY_UNAVAILABLE', 'El historial no está disponible ahora mismo') }
		return respond({ coin, interval, format, columns: DAILY_COLUMNS, rows: data, settled: closedRange })
	}

	const { data, error } = await getRawHistory(COIN_IDS[coin], {
		from: from && new Date(havanaMidnightMs(from)).toISOString(),
		before: to && new Date(havanaMidnightMs(nextDay(to))).toISOString(),
		after,
		limit,
	})
	if (error) { console.error('Error fetching raw history:', error); return fail(503, 'HISTORY_UNAVAILABLE', 'El historial no está disponible ahora mismo') }

	const rows = data.map(({ value, updated_at }) => ({ time: updated_at.replace('+00:00', 'Z'), value }))
	const nextCursor = data.length === limit ? encodeCursor(data[data.length - 1].updated_at) : null

	// Una página completa tampoco cambia: lo nuevo siempre cae después de su última fila
	return respond({ coin, interval, format, columns: RAW_COLUMNS, rows, nextCursor, settled: closedRange || nextCursor !== null })
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } })
