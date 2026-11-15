// Parámetros de vista de la home (?stream=true, ?offers=false, ?currency=MLC...). Función pura,
// sin React ni `window`: la usa app/page.js y se prueba con `npm test`. El contrato público está
// en README.md ("Parámetros de la URL").

export const DEFAULT_POLL_S = 4 // cada cuánto pide /api la home
export const MIN_POLL_S = 30 // mínimo de ?poll=: el dato real cambia cada 10 min
export const MIN_ROTATE_S = 5
const MAX_SECONDS = 3600

// Lo que deja la página lista para transmitirla sin nadie delante (Telegram Live Story)
const STREAM_PRESET = {
	code: false,
	game: false,
	push: false,
	offers: true, // el feed de ofertas es parte del show
	footer: false,
	theme: 'dark',
	fx: 'low',
	rotate: 10,
}

const BOOL = { true: true, 1: true, false: false, 0: false }

// Acepta URLSearchParams (o el de next/navigation), el objeto `searchParams` de una página de
// servidor, o un query string
function reader(source) {
	if (typeof source === 'string') source = new URLSearchParams(source)
	if (typeof source?.get === 'function') return (key) => source.get(key)
	return (key) => {
		const raw = source?.[key]
		return (Array.isArray(raw) ? raw[0] : raw) ?? null
	}
}

// Segundos enteros. `0`/`false` apagan (hace falta para quitar el rotate del preset), por debajo
// del mínimo se sube al mínimo, y lo que no es un número se ignora (undefined)
function seconds(raw, min, { allowOff = false } = {}) {
	if (raw === null) return undefined
	const text = raw.trim().toLowerCase()
	if (allowOff && (text === '0' || text === 'false' || text === 'off')) return 0
	if (!/^\d+$/.test(text)) return undefined
	return Math.min(MAX_SECONDS, Math.max(min, Number.parseInt(text, 10)))
}

export function parseViewParams(source, { coins = ['CUP'] } = {}) {
	const get = reader(source)
	const bool = (key) => BOOL[(get(key) ?? '').trim().toLowerCase()]

	const view = {
		stream: false,
		code: true,
		game: true,
		push: true,
		offers: true,
		footer: true,
		chart: true,
		currency: coins[0],
		rotate: 0, // segundos; 0 = no rota
		theme: null, // null = el del sistema
		fx: 'full',
		poll: DEFAULT_POLL_S,
	}

	// 1. Preset
	if (bool('stream') === true) Object.assign(view, STREAM_PRESET, { stream: true })

	// 2. Parámetros históricos: solo el valor exacto `true`, como siempre
	if (get('nocode') === 'true') view.code = false
	if (get('nogame') === 'true') view.game = false

	// 3. Parámetros explícitos: ganan siempre
	for (const key of ['code', 'game', 'push', 'offers', 'footer', 'chart']) {
		const value = bool(key)
		if (value !== undefined) view[key] = value
	}

	const currency = (get('currency') ?? '').trim().toUpperCase()
	if (coins.includes(currency)) view.currency = currency

	const rotate = seconds(get('rotate'), MIN_ROTATE_S, { allowOff: true })
	if (rotate !== undefined) view.rotate = rotate

	const poll = seconds(get('poll'), MIN_POLL_S)
	if (poll !== undefined) view.poll = poll

	const theme = (get('theme') ?? '').trim().toLowerCase()
	if (theme === 'dark' || theme === 'light') view.theme = theme

	const fx = (get('fx') ?? '').trim().toLowerCase()
	if (fx === 'full' || fx === 'low') view.fx = fx

	return view
}
