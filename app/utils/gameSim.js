// Motor puro de CUP Runner, compartido por el cliente (app/play/Game.js) y el
// verificador de replays del server (app/api/game-score). No toca el DOM y toda
// la física corre a paso fijo (STEP), de modo que la misma traza de inputs
// —saltos, ofertas en vivo y resizes, indexados por número de paso— reproduce
// bit a bit el mismo run en cualquier engine JS. Solo aritmética IEEE-754
// exacta (+,-,*,/, Math.imul, Math.floor/min/max): nada de Math.sin ni fuentes
// de tiempo/aleatoriedad en el camino de colisiones.

// ── Tuning (idéntico al juego original) ─────────────────────────────────────
const DX = 90               // px entre puntos de datos (unidades de mundo)
const GRAVITY = 2800
const JUMP_V = 950
const BASE_SPEED = 250
const MAX_EXTRA_SPEED = 220
const STEP_HZ = 120
const STEP = 1 / STEP_HZ    // paso fijo de física
const COURSE_SEED = 20260724

const mulberry32 = (seed) => () => {
	seed |= 0; seed = (seed + 0x6D2B79F5) | 0
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// El course es determinista (seed fija): cada run juega el mismo mapa, así que
// aprenderse la historia del CUP ES la habilidad — misma idea que el juego de BTC.
const buildCourse = (data) => {

	const values = data.map((d) => d.value)
	const times = data.map((d) => d.time)
	const n = values.length

	// Normaliza cada punto contra una ventana móvil para que la línea quede en pantalla
	const WIN = 60
	const raw = new Array(n)
	for (let i = 0; i < n; i++) {
		let min = Infinity, max = -Infinity
		for (let j = Math.max(0, i - WIN); j <= Math.min(n - 1, i + WIN); j++) {
			if (values[j] < min) min = values[j]
			if (values[j] > max) max = values[j]
		}
		raw[i] = max - min < 1e-9 ? 0.5 : (values[i] - min) / (max - min)
	}
	const heights = raw.map((h, i) => (raw[Math.max(0, i - 1)] + h + raw[Math.min(n - 1, i + 1)]) / 3)

	// Umbral de volatilidad: los obstáculos salen de movimientos reales de la tasa
	const pcts = []
	for (let i = 1; i < n; i++) pcts.push((values[i] - values[i - 1]) / (values[i - 1] || 1))
	const mean = pcts.reduce((a, b) => a + b, 0) / (pcts.length || 1)
	const std = Math.sqrt(pcts.reduce((a, b) => a + (b - mean) ** 2, 0) / (pcts.length || 1)) || 0.001

	const rand = mulberry32(COURSE_SEED)
	const spikes = [] // subida fuerte → pico rojo
	const holes = []  // bajada fuerte → hueco
	let lastI = 16
	for (let i = 22; i < n - 4; i++) {
		const gap = i - lastI
		if (gap < 6) continue
		const pct = pcts[i - 1]
		let type = null
		if (pct > std * 1.1) type = 'spike'
		else if (pct < -std * 1.1) type = 'hole'
		else if (gap >= 14 && rand() < 0.35) type = rand() < 0.45 ? 'spike' : 'hole'
		if (!type) continue
		if (type === 'spike') {
			// Tan altos que un salto simple (~161px de ápice) no los libra — exigen doble salto (~297px)
			spikes.push({ i, h: 180 + rand() * 45, w: 50 })
			lastI = i
		} else {
			const wpts = 1.4 + rand() * 0.9
			holes.push({ x0: i * DX - 20, x1: (i + wpts) * DX })
			lastI = i + Math.ceil(wpts)
		}
	}

	// Monedas: arcos sobre huecos, una sobre cada pico, relleno por el camino
	const coins = []
	let id = 0
	for (const h of holes) {
		const cx = (h.x0 + h.x1) / 2
		coins.push({ id: id++, x: cx - 60, dy: 95 }, { id: id++, x: cx, dy: 135 }, { id: id++, x: cx + 60, dy: 95 })
	}
	for (const s of spikes) coins.push({ id: id++, x: s.i * DX, dy: s.h + 55 })
	const nearObstacle = (x) =>
		spikes.some((s) => Math.abs(s.i * DX - x) < DX * 2) || holes.some((h) => x > h.x0 - DX && x < h.x1 + DX)
	for (let i = 18; i < n; i += 7) {
		const x = i * DX
		if (!nearObstacle(x)) coins.push({ id: id++, x, dy: 65 + rand() * 50 })
	}
	coins.sort((a, b) => a.x - b.x)

	const stars = Array.from({ length: 80 }, () => ({
		x: rand(), y: rand() * 0.85, r: 0.4 + rand() * 1.4, a: 0.15 + rand() * 0.45,
	}))

	return { values, times, heights, spikes, holes, coins, stars, n }
}

// ── Estado de un run ────────────────────────────────────────────────────────
// R y PX quedan congelados al tamaño inicial (igual que el juego original, que
// los capturaba como const al arrancar el engine); h/w sí siguen los resizes.
const createSim = (course, w, h) => ({
	w, h,
	r: Math.max(15, Math.min(24, w * 0.027)),
	px: w * 0.3,
	worldX: 0,
	py: 0, // se asienta abajo, cuando ya existe terrainY
	vy: 0,
	grounded: true,
	jumpsLeft: 2,
	score: 0,
	combo: 1,
	comboTimer: 0,
	elapsed: 0,
	dead: false,
	steps: 0,
	taken: new Set(),
	holes: [...course.holes], // copia local — los cráteres vivos no persisten entre runs
	liveDollars: [],          // {x, y, vy, state:'fall'|'ground', groundT, value}
	coinLo: 0,                // puntero deslizante sobre coins (ordenadas por x)
	spikeLo: 0,               // ídem sobre spikes (ordenados por i)
})

const mod = (i, n) => ((i % n) + n) % n

const terrainY = (state, course, wx) => {
	const { heights, n } = course
	const fi = wx / DX
	const i0 = Math.floor(fi)
	const t = fi - i0
	const h = heights[mod(i0, n)] * (1 - t) + heights[mod(i0 + 1, n)] * t
	return state.h * (0.72 - h * 0.34)
}

const holeAt = (state, wx) => {
	for (const h of state.holes) if (wx > h.x0 && wx < h.x1) return h
	return null
}

const initSim = (course, w, h) => {
	const state = createSim(course, w, h)
	state.py = terrainY(state, course, state.px) - state.r
	return state
}

const dayAt = (course, rawIdx) => {
	const { times, n } = course
	const totalDays = Math.max(1, Math.ceil((times[n - 1] - times[0]) / 86400))
	const loops = Math.floor(rawIdx / n)
	return Math.floor((times[mod(rawIdx, n)] - times[0]) / 86400) + 1 + loops * totalDays
}

const runStats = (state, course) => {
	const rawIdx = Math.floor((state.worldX + state.px) / DX)
	return {
		day: dayAt(course, rawIdx),
		score: Math.round(state.score),
		idx: mod(rawIdx, course.n),
		loops: Math.floor(rawIdx / course.n),
		steps: state.steps,
	}
}

// ── Inputs ──────────────────────────────────────────────────────────────────
const applyResize = (state, w, h) => { state.w = w; state.h = h }

// Devuelve 'jump' | 'double' si el salto se aplicó (para el audio del cliente),
// o null si se ignoró — solo los aplicados van a la traza.
const applyJump = (state) => {
	if (state.dead || state.jumpsLeft <= 0) return null
	const fromGround = state.grounded
	state.jumpsLeft--
	state.vy = -JUMP_V * (fromGround ? 1 : 0.92)
	state.grounded = false
	return fromGround ? 'jump' : 'double'
}

const craterHash = (id) => [...String(id)].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)

// Ofertas reales como eventos de dificultad (mismo feed que las tarjetas de la
// portada). Las posiciones se derivan por completo del estado, así que ambos
// lados las recomputan idénticas: la traza solo lleva {step, id, value}.
// Oferta ≥ nominal → cae un dólar del cielo; < nominal → cráter de doble salto.
const applyOffers = (state, course, offers) => {
	const nominal = course.values[course.n - 1]
	let dollarStagger = 0
	let craterStagger = 0
	for (const o of offers) {
		const value = Number(o.value) || 0
		if (value >= nominal) {
			let x = state.worldX + state.w * 0.85 + dollarStagger
			dollarStagger += 380
			let guard = 0
			while (holeAt(state, x) && guard++ < 20) x += 160
			state.liveDollars.push({ x, y: -40, vy: 0, state: 'fall', groundT: 0, value })
		} else {
			const wpx = DX * (2.6 + (craterHash(o.id) % 7) / 10)
			let x0 = state.worldX + state.w + 400 + craterStagger
			craterStagger += 550
			const isClear = (a, b) =>
				!course.spikes.some((s) => s.i * DX > a - 180 && s.i * DX < b + 180) &&
				!state.holes.some((h) => h.x1 > a - 220 && h.x0 < b + 220)
			let guard = 0
			while (!isClear(x0, x0 + wpx) && guard++ < 30) x0 += 160
			state.holes.push({ x0, x1: x0 + wpx, live: { value } })
		}
	}
}

// ── Un paso de física ───────────────────────────────────────────────────────
// Réplica exacta del update del frame original, con dt = STEP. Devuelve los
// eventos del paso ({type:'coin'|'die'}) para que el cliente dispare
// audio/popups; la muerte corta el paso en el mismo punto que el original.
// Única divergencia deliberada: la colisión de monedas usa su posición base
// (el bamboleo ±4px era Math.sin, no portable entre engines — queda visual).
const stepPhysics = (state, course) => {

	const events = []
	if (state.dead) return events
	const dt = STEP
	const { coins, spikes } = course
	const R = state.r

	const speed = BASE_SPEED + Math.min(MAX_EXTRA_SPEED, state.elapsed * 7)
	state.worldX += speed * dt
	state.elapsed += dt
	state.steps++

	const pwx = state.worldX + state.px
	const hole = holeAt(state, pwx)
	const gy = terrainY(state, course, pwx)

	state.vy = Math.min(state.vy + GRAVITY * dt, 1700)
	state.py += state.vy * dt

	const die = () => { state.dead = true; events.push({ type: 'die' }) }

	if (!hole && state.vy >= 0 && state.py + R >= gy) {
		if (state.py + R > gy + 30 && state.vy > 150) { die(); return events } // chocó con la pared lejana de un hueco
		state.py = gy - R
		state.vy = 0
		state.grounded = true
		state.jumpsLeft = 2
	} else {
		state.grounded = false
	}
	if (state.py - R > state.h + 60) { die(); return events } // cayó por un hueco

	while (state.spikeLo < spikes.length && spikes[state.spikeLo].i * DX < pwx - 60) state.spikeLo++
	for (let si = state.spikeLo; si < spikes.length; si++) {
		const s = spikes[si]
		const sx = s.i * DX
		if (sx > pwx + 60) break
		const dx = Math.abs(pwx - sx)
		if (dx < s.w / 2) {
			const baseY = terrainY(state, course, sx)
			// El falloff cuadrático calza con los flancos cóncavos de la espina
			const frac = 1 - dx / (s.w / 2)
			const surfY = baseY - s.h * frac * frac
			if (state.py + R * 0.7 > surfY) { die(); return events }
		}
	}

	state.comboTimer -= dt
	if (state.comboTimer <= 0) state.combo = 1

	while (state.coinLo < coins.length && coins[state.coinLo].x < pwx - 200) state.coinLo++
	for (let ci = state.coinLo; ci < coins.length; ci++) {
		const c = coins[ci]
		if (c.x > pwx + 200) break
		if (state.taken.has(c.id)) continue
		const cy = terrainY(state, course, c.x) - c.dy
		const dx = pwx - c.x
		const dyp = state.py - cy
		if (dx * dx + dyp * dyp < (R + 12) ** 2) {
			state.taken.add(c.id)
			state.combo++
			state.comboTimer = 4
			const gain = 25 * state.combo
			state.score += gain
			events.push({ type: 'coin', combo: state.combo, gain, cy })
		}
	}

	// Dólares que caen: caen, aterrizan, estorban letales 6s y se desvanecen
	for (let i = state.liveDollars.length - 1; i >= 0; i--) {
		const d = state.liveDollars[i]
		if (d.state === 'fall') {
			d.vy = Math.min(d.vy + 1600 * dt, 900)
			d.y += d.vy * dt
			const dgy = terrainY(state, course, d.x)
			if (d.y >= dgy - 13) { d.y = dgy - 13; d.state = 'ground'; d.groundT = 0 }
		} else {
			d.groundT += dt
		}
		if (d.x < state.worldX - 250 || d.groundT > 6) { state.liveDollars.splice(i, 1); continue }
		const dx = pwx - d.x
		const dyp = state.py - d.y
		if (dx * dx + dyp * dyp < (R + 17) ** 2) { die(); return events }
	}
	// Cráteres vivos ya cruzados: fuera del terreno local
	for (let i = state.holes.length - 1; i >= 0; i--) {
		if (state.holes[i].live && state.holes[i].x1 < state.worldX - 400) state.holes.splice(i, 1)
	}

	return events
}

// ── Replay completo (server) ────────────────────────────────────────────────
// trace: {w, h, resizes: [[step,w,h]…], offers: [[step,id,value]…], jumps: [step…]}
// con los steps en orden ascendente (así los graba el cliente). En cada paso el
// orden es resizes → ofertas → saltos → física, el mismo que usa el cliente.
const simulateRun = (course, trace, maxSteps) => {
	const { w, h } = trace
	const resizes = trace.resizes || []
	const offers = trace.offers || []
	const jumps = trace.jumps || []
	const state = initSim(course, w, h)
	let ri = 0, oi = 0, ji = 0
	for (let s = 0; s < maxSteps && !state.dead; s++) {
		while (ri < resizes.length && resizes[ri][0] === s) { applyResize(state, resizes[ri][1], resizes[ri][2]); ri++ }
		if (oi < offers.length && offers[oi][0] === s) {
			const batch = []
			while (oi < offers.length && offers[oi][0] === s) { batch.push({ id: offers[oi][1], value: offers[oi][2] }); oi++ }
			applyOffers(state, course, batch)
		}
		while (ji < jumps.length && jumps[ji] === s) { applyJump(state); ji++ }
		stepPhysics(state, course)
	}
	return { died: state.dead, ...runStats(state, course) }
}

export {
	DX, GRAVITY, JUMP_V, BASE_SPEED, MAX_EXTRA_SPEED, STEP, STEP_HZ,
	mulberry32, buildCourse, initSim, terrainY, holeAt, dayAt, runStats,
	applyResize, applyJump, applyOffers, stepPhysics, simulateRun,
}
