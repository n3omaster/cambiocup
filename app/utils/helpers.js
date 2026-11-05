// Apply a small percentage variation around `num` to simulate price fluctuation.
// `deep` is the total percentage span (e.g. 0.5 means ±0.25%).
const randomize = (num, deep = 0.1) => {
	const variation = (Math.random() - 0.5) * deep / 100
	return num * (1 + variation)
}

// Por debajo de este cambio en 24 h la moneda está estable (azul). Medido con el histórico: es
// el umbral con menos cambios de color, y queda por encima de los ±0,25 % de `randomize`, así
// que nunca se pinta como movimiento algo que no se distingue del ruido del número en pantalla.
const STABLE_PCT = 0.3

// Tendencia frente a hace 24 h. `current` es el dato real, nunca el número con ruido.
// state: 'up' | 'down' | 'stable'. Sin referencia, pct es null y cuenta como estable.
const dayTrend = (current, dayAgo) => {
	if (!dayAgo) return { pct: null, state: 'stable' }
	const pct = ((current - dayAgo) / dayAgo) * 100
	return { pct, state: Math.abs(pct) <= STABLE_PCT ? 'stable' : pct > 0 ? 'up' : 'down' }
}

// Relative age of a timestamp in Spanish ("hace 5 min", "hace 2h", "hace 3d").
const getTimeAgo = (date) => {
	const seconds = Math.floor((new Date() - new Date(date)) / 1000)
	if (seconds < 60) return 'hace segundos'
	if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`
	if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`
	return `hace ${Math.floor(seconds / 86400)}d`
}

export { randomize, dayTrend, getTimeAgo }
