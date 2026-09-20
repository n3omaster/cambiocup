// El mapa de CUP Runner se congela una vez al día, a medianoche de La Habana.
//
// Antes el terreno se reconstruía con TODA la historia disponible en cada
// momento, y como buildCourse() clasifica picos y huecos consumiendo un PRNG
// compartido, un solo dato nuevo del cron desincronizaba el flujo de rand() y
// volvía a sortear el mapa entero. Medido: de una hora para otra solo coincidían
// 17 de 62 picos; de una semana para otra, 7 de 62.
//
// Consecuencias que eso tenía: "aprenderse la historia del CUP" no servía de
// nada porque el mapa cambiaba solo, y el ranking comparaba partidas jugadas en
// mapas distintos. Congelarlo por día arregla las dos cosas y es lo que hace
// posible un fantasma o un duelo: dos personas pueden correr la MISMA pista.

const TZ = 'America/Havana'

// Desfase de La Habana respecto a UTC en un instante dado (ms). Positivo al
// este de Greenwich; Cuba siempre da negativo (-4 h o -5 h según el horario
// de verano), y por eso hay que calcularlo por fecha y no fijarlo.
const tzOffsetMs = (ms) => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TZ, hour12: false,
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	}).formatToParts(new Date(ms)).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
	const asIfUTC = Date.UTC(
		Number(parts.year), Number(parts.month) - 1, Number(parts.day),
		Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
	)
	return asIfUTC - Math.floor(ms / 1000) * 1000
}

// "2026-09-20" — el día de juego en curso según La Habana
const havanaDay = (ms = Date.now()) =>
	new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

// Primer instante UTC (ms) de un día `YYYY-MM-DD` en La Habana.
//
// Dos pasadas porque el propio desfase depende del instante buscado. Y después
// un empujón: la noche en que Cuba adelanta el reloj, las 00:00 locales NO
// EXISTEN (00:00 salta a 01:00), así que la estimación cae en el día anterior
// y hay que avanzar hasta el primer instante que de verdad pertenece al día.
const havanaMidnightMs = (day) => {
	const utcMidnight = Date.parse(`${day}T00:00:00Z`)
	let guess = utcMidnight
	for (let i = 0; i < 2; i++) guess = utcMidnight - tzOffsetMs(guess)
	let guard = 0
	while (havanaDay(guess) !== day && guard++ < 8) guess += 15 * 60 * 1000
	return guess
}

// Corte del mapa de hoy: la medianoche de La Habana más reciente.
// Todo el mundo que juegue hoy recibe exactamente el mismo terreno.
const currentMapCutoff = (now = Date.now()) => {
	const day = havanaDay(now)
	return { day, cutoff: havanaMidnightMs(day) }
}

// Cuántos segundos faltan para que el mapa cambie (para el Cache-Control del
// edge: cachear justo hasta el próximo corte, ni un segundo más)
const secondsUntilNextMap = (now = Date.now()) => {
	const { cutoff } = currentMapCutoff(now)
	const next = cutoff + 25 * 3600 * 1000 // holgado: cae siempre en el día siguiente
	const { cutoff: nextCutoff } = currentMapCutoff(next)
	return Math.max(60, Math.ceil((nextCutoff - now) / 1000))
}

export { TZ, havanaDay, havanaMidnightMs, currentMapCutoff, secondsUntilNextMap }
