'use client'

import Link from 'next/link'
import { encodePayload } from '@/app/utils/gameCodec'
import { DX, STEP, MAGNET_RADIUS, mulberry32, buildCourse, initSim, terrainY as simTerrainY, holeAt as simHoleAt, dayAt, applyResize, applyJump, applyOffers, stepPhysics } from '@/app/utils/gameSim'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// La física vive en app/utils/gameSim.js (paso fijo STEP, compartida con el
// verificador de replays del server); aquí quedan render, audio e inputs.
const BEST_KEY = 'cambiocup:play:best'
const MUSIC_KEY = 'cambiocup:play:music'
const NAME_KEY = 'cambiocup:play:name'
const GHOST_KEY = 'cambiocup:play:ghost'

// Telegram username: 5-32 chars, letters/digits/underscore, starts with a letter.
// Returns the normalized handle ("@usuario", lowercase) or null if invalid.
const normalizeTg = (raw) => {
	const user = String(raw || '').trim().replace(/^@+/, '')
	return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(user) ? `@${user.toLowerCase()}` : null
}

// Game SFX: real coin recordings (public/sounds/*, CC0 from OpenGameArt) played
// via Web Audio buffers for zero latency, with synthesized fallbacks while they
// load. The context resumes lazily on the first user gesture, per browser policy.
const createAudio = () => {

	let ctx = null
	const buffers = {}
	let preloaded = false

	const ensure = () => {
		if (!ctx) {
			const AC = window.AudioContext || window.webkitAudioContext
			if (!AC) return null
			ctx = new AC()
		}
		if (ctx.state === 'suspended') ctx.resume()
		return ctx
	}

	const preload = () => {
		if (preloaded) return
		preloaded = true
		const ac = ensure()
		if (!ac) return
		for (const [name, url] of [['jump', '/sounds/coin-jump.mp3'], ['death', '/sounds/coin-death.mp3']]) {
			fetch(url)
				.then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(url))))
				.then((raw) => ac.decodeAudioData(raw))
				.then((decoded) => { buffers[name] = decoded })
				.catch(() => { /* synth fallback keeps working */ })
		}
	}

	const playBuffer = (name, { vol = 0.4, rate = 1 } = {}) => {
		const ac = ensure()
		const buffer = buffers[name]
		if (!ac || !buffer) return false
		const src = ac.createBufferSource()
		src.buffer = buffer
		src.playbackRate.value = rate
		const gain = ac.createGain()
		gain.gain.value = vol
		src.connect(gain)
		gain.connect(ac.destination)
		src.start()
		return true
	}

	const blip = ({ from, to, dur, type = 'square', vol = 0.12, delay = 0 }) => {
		const ac = ensure()
		if (!ac) return
		const t0 = ac.currentTime + delay
		const osc = ac.createOscillator()
		const gain = ac.createGain()
		osc.type = type
		osc.frequency.setValueAtTime(from, t0)
		osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur)
		gain.gain.setValueAtTime(vol, t0)
		gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
		osc.connect(gain).connect(ac.destination)
		osc.start(t0)
		osc.stop(t0 + dur + 0.02)
	}

	const crash = ({ dur = 0.45, vol = 0.22 }) => {
		const ac = ensure()
		if (!ac) return
		const t0 = ac.currentTime
		const len = Math.floor(ac.sampleRate * dur)
		const buf = ac.createBuffer(1, len, ac.sampleRate)
		const channel = buf.getChannelData(0)
		for (let i = 0; i < len; i++) channel[i] = (Math.random() * 2 - 1) * (1 - i / len)
		const src = ac.createBufferSource()
		src.buffer = buf
		const filter = ac.createBiquadFilter()
		filter.type = 'lowpass'
		filter.frequency.setValueAtTime(900, t0)
		const gain = ac.createGain()
		gain.gain.setValueAtTime(vol, t0)
		gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
		src.connect(filter)
		filter.connect(gain)
		gain.connect(ac.destination)
		src.start(t0)
	}

	// ── Música: son cubano generado, 0 bytes de descarga ────────────────────
	// Nada de MP3: en Cuba los datos son caros y una pista en bucle son ~300 KB.
	// Esto son osciladores, así que además puede reaccionar al juego (acelera con
	// el turbo de TROPICAL, se enturbia con el apagón de ETECSA).
	//
	// Las notas se agendan con el reloj de AudioContext y una ventana de
	// anticipación; con setTimeout por nota se desincronizaría en cuanto el
	// navegador estrangule la pestaña.
	let music = null

	// Clave son 3-2, la columna vertebral del son: |x..x..x.|..x.x...|
	const CLAVE = [0, 3, 6, 10, 12]
	const BASS = [   // tumbao: fundamental, quinta y octava
		[0, 55.00], [3, 82.41], [6, 55.00], [8, 73.42],
		[16, 49.00], [19, 73.42], [22, 49.00], [24, 65.41],
	]
	const MONTUNO = [[2, [261.63, 329.63]], [6, [293.66, 349.23]], [18, [246.94, 329.63]], [22, [261.63, 329.63]]]

	const tone = (t0, freq, dur, { type = 'sine', vol = 0.06, glide = 1 } = {}) => {
		const ac = ctx
		const osc = ac.createOscillator()
		const gain = ac.createGain()
		osc.type = type
		osc.frequency.setValueAtTime(freq, t0)
		if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * glide, t0 + dur)
		gain.gain.setValueAtTime(0.0001, t0)
		gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012)
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
		osc.connect(gain).connect(music.bus)
		osc.start(t0)
		osc.stop(t0 + dur + 0.02)
	}

	// Golpe de clave: ruido corto y seco filtrado en agudo (suena a madera)
	const woodblock = (t0, vol) => {
		const ac = ctx
		const len = Math.floor(ac.sampleRate * 0.05)
		const buf = ac.createBuffer(1, len, ac.sampleRate)
		const ch = buf.getChannelData(0)
		for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
		const src = ac.createBufferSource()
		src.buffer = buf
		const bp = ac.createBiquadFilter()
		bp.type = 'bandpass'
		bp.frequency.value = 2100
		bp.Q.value = 6
		const g = ac.createGain()
		g.gain.value = vol
		src.connect(bp).connect(g).connect(music.bus)
		src.start(t0)
	}

	const startMusic = () => {
		const ac = ensure()
		if (!ac || music) return
		const bus = ac.createGain()
		bus.gain.value = 0
		// Filtro que se cierra durante el apagón de ETECSA
		const tone_ = ac.createBiquadFilter()
		tone_.type = 'lowpass'
		tone_.frequency.value = 12000
		bus.connect(tone_).connect(ac.destination)
		music = { bus, filter: tone_, next: 0, step: 0, bpm: 92, timer: 0, target: 0.5 }
		bus.gain.linearRampToValueAtTime(0.5, ac.currentTime + 1.5)

		// Planificador: cada 50 ms agenda lo que entra en los próximos 200 ms
		music.timer = setInterval(() => {
			if (!music) return
			const spb = 60 / music.bpm / 4 // duración de un dieciseisavo
			if (music.next < ac.currentTime) music.next = ac.currentTime + 0.05
			while (music.next < ac.currentTime + 0.2) {
				const k = music.step % 32
				if (CLAVE.includes(k % 16) && k < 16) woodblock(music.next, 0.14)
				if (k === 20 || k === 26) woodblock(music.next, 0.11)
				for (const [at, f] of BASS) if (at === k) tone(music.next, f, spb * 2.6, { type: 'triangle', vol: 0.075 })
				for (const [at, ch] of MONTUNO) {
					if (at !== k) continue
					for (const f of ch) tone(music.next, f, spb * 1.6, { type: 'square', vol: 0.022 })
				}
				music.next += spb
				music.step++
			}
		}, 50)
	}

	const stopMusic = () => {
		if (!music) return
		clearInterval(music.timer)
		const ac = ctx
		try {
			music.bus.gain.cancelScheduledValues(ac.currentTime)
			music.bus.gain.setValueAtTime(music.bus.gain.value, ac.currentTime)
			music.bus.gain.linearRampToValueAtTime(0.0001, ac.currentTime + 0.35)
		} catch { /* contexto cerrado */ }
		music = null
	}

	return {
		preload,
		startMusic,
		stopMusic,
		// El son sigue al juego: acelera con el turbo y se apaga con ETECSA
		setMusicMood: ({ turbo = false, blackout = false } = {}) => {
			if (!music || !ctx) return
			music.bpm = turbo ? 124 : 92
			const want = blackout ? 620 : 12000
			if (Math.abs(music.filter.frequency.value - want) > 50) {
				music.filter.frequency.setTargetAtTime(want, ctx.currentTime, 0.18)
			}
		},
		musicOn: () => !!music,
		// Real coin flick; the double jump replays it faster/brighter
		jump: () => {
			if (!playBuffer('jump', { vol: 0.45 })) blip({ from: 320, to: 750, dur: 0.12 })
		},
		doubleJump: () => {
			if (!playBuffer('jump', { vol: 0.45, rate: 1.25 })) blip({ from: 480, to: 1100, dur: 0.14 })
		},
		coin: (combo = 1) => {
			const lift = Math.min(combo, 20) * 28
			blip({ from: 880 + lift, to: 1500 + lift, dur: 0.09, type: 'sine', vol: 0.1 })
		},
		// Real coins dropping and settling, with a soft low thud underneath for weight
		death: () => {
			if (playBuffer('death', { vol: 0.6 })) {
				blip({ from: 160, to: 50, dur: 0.4, type: 'sine', vol: 0.1 })
			} else {
				blip({ from: 500, to: 55, dur: 0.5, type: 'sawtooth', vol: 0.18 })
				blip({ from: 240, to: 50, dur: 0.6, vol: 0.1, delay: 0.05 })
				crash({})
			}
		},
		// Una firma sonora por dinámica del feed P2P, para reconocerla sin leer
		event: (fx) => {
			switch (fx) {
				case 'magnet': // barrido ascendente, como un imán cargando
					blip({ from: 300, to: 1200, dur: 0.28, type: 'sine', vol: 0.11 })
					break
				case 'shield': // dos notas limpias, campana protectora
					blip({ from: 700, to: 705, dur: 0.14, type: 'triangle', vol: 0.11 })
					blip({ from: 1050, to: 1055, dur: 0.22, type: 'triangle', vol: 0.09, delay: 0.1 })
					break
				case 'blackout': // la señal cayéndose
					blip({ from: 900, to: 90, dur: 0.45, type: 'sawtooth', vol: 0.1 })
					break
				case 'turbo': // ráfaga
					blip({ from: 420, to: 1500, dur: 0.18, type: 'square', vol: 0.1 })
					blip({ from: 620, to: 1800, dur: 0.16, type: 'square', vol: 0.07, delay: 0.07 })
					break
				case 'lowgrav': // flotar
					blip({ from: 520, to: 260, dur: 0.4, type: 'sine', vol: 0.1 })
					break
				case 'cash': // arpegio de billetes
					[784, 988, 1175, 1568].forEach((f, i) => blip({ from: f, to: f * 1.01, dur: 0.1, type: 'sine', vol: 0.09, delay: i * 0.06 }))
					break
				case 'crater':
					blip({ from: 220, to: 60, dur: 0.3, type: 'sawtooth', vol: 0.12 })
					break
				default: // dollar
					blip({ from: 1100, to: 400, dur: 0.22, type: 'triangle', vol: 0.1 })
			}
		},
		// Escudo consumido: golpe seco + repique de rescate
		shieldSave: () => {
			blip({ from: 180, to: 90, dur: 0.18, type: 'sawtooth', vol: 0.16 })
			blip({ from: 900, to: 1400, dur: 0.22, type: 'triangle', vol: 0.12, delay: 0.06 })
		},
		bonus: () => blip({ from: 1200, to: 1900, dur: 0.11, type: 'sine', vol: 0.11 }),
		// Victory fanfare: ascending C-major arpeggio (crossing today's flag)
		win: () => {
			const notes = [523, 659, 784, 1047]
			notes.forEach((f, i) => blip({ from: f, to: f * 1.01, dur: 0.16, type: 'square', vol: 0.12, delay: i * 0.13 }))
			blip({ from: 1047, to: 1568, dur: 0.35, type: 'sine', vol: 0.1, delay: notes.length * 0.13 })
		},
	}
}

// Composes the shareable 1080×1080 card: the death frame + stats + CTA, all baked
// into one PNG so it survives any messaging app intact.
const buildShareCard = (gameCanvas, stats, sans) => {

	const S = 1080
	const card = document.createElement('canvas')
	card.width = S
	card.height = S
	const ctx = card.getContext('2d')
	const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

	ctx.fillStyle = '#0b0c10'
	ctx.fillRect(0, 0, S, S)

	// Death frame, cover-cropped
	const gw = gameCanvas.width
	const gh = gameCanvas.height
	const scale = Math.max(S / gw, S / gh)
	ctx.drawImage(gameCanvas, (S - gw * scale) / 2, (S - gh * scale) / 2, gw * scale, gh * scale)

	// Legibility gradients (bottom + top)
	let g = ctx.createLinearGradient(0, S * 0.3, 0, S)
	g.addColorStop(0, 'rgba(11,12,16,0)')
	g.addColorStop(0.55, 'rgba(11,12,16,0.85)')
	g.addColorStop(1, 'rgba(11,12,16,0.97)')
	ctx.fillStyle = g
	ctx.fillRect(0, 0, S, S)
	g = ctx.createLinearGradient(0, 0, 0, S * 0.22)
	g.addColorStop(0, 'rgba(11,12,16,0.85)')
	g.addColorStop(1, 'rgba(11,12,16,0)')
	ctx.fillStyle = g
	ctx.fillRect(0, 0, S, S * 0.22)

	// Logo
	ctx.textAlign = 'left'
	ctx.textBaseline = 'alphabetic'
	ctx.font = `800 64px ${sans}`
	ctx.fillStyle = '#ffffff'
	ctx.fillText('CUP', 56, 108)
	const cupW = ctx.measureText('CUP ').width
	ctx.fillStyle = '#53dd6c'
	ctx.fillText('RUNNER', 56 + cupW, 108)
	ctx.font = `600 30px ${mono}`
	ctx.fillStyle = 'rgba(255,255,255,0.55)'
	ctx.fillText('cambiocup.com/play', 58, 152)

	// Stats (dead: 💀 caíste / won: 🏁 llegaste hasta hoy)
	ctx.textAlign = 'center'
	ctx.font = '104px sans-serif'
	ctx.fillText(stats.won ? '🏁' : '💀', S / 2, S * 0.565)
	ctx.font = `800 ${stats.won ? 72 : 80}px ${sans}`
	ctx.fillStyle = stats.won ? '#53dd6c' : '#ffffff'
	ctx.fillText(stats.won ? '¡LLEGUÉ HASTA HOY!' : `CAÍSTE EN EL DÍA ${stats.day}`, S / 2, S * 0.67)
	ctx.font = `500 36px ${sans}`
	ctx.fillStyle = 'rgba(255,255,255,0.75)'
	ctx.fillText(
		stats.won
			? `${stats.day} días de historia — hoy el CUP está en $${stats.rate}`
			: `${stats.dateStr} — el CUP estaba en $${stats.rate}`,
		S / 2, S * 0.725,
	)
	ctx.font = `800 60px ${mono}`
	ctx.fillStyle = '#ffd75e'
	ctx.fillText(`${stats.score.toLocaleString('es')} CUP`, S / 2, S * 0.805)

	// CTA
	ctx.font = `800 46px ${mono}`
	ctx.fillStyle = '#53dd6c'
	ctx.fillText('¿PUEDES SUPERARME?', S / 2, S * 0.9)
	ctx.font = `600 30px ${mono}`
	ctx.fillStyle = 'rgba(255,255,255,0.6)'
	ctx.fillText('▶ juega en cambiocup.com/play', S / 2, S * 0.945)

	return card
}

// Full-screen confetti rain for the victory screen. Pure DOM/CSS decoration
// (fuera de la sim); usa el PRNG determinista de gameSim para pasar la regla de
// pureza de render — la variedad visual no necesita entropía real.
const CONFETTI_COLORS = ['#53dd6c', '#ffd75e', '#e05265', '#ffffff', '#229ED9']

// Una dinámica por moneda del feed P2P — el mismo mapa que aplica gameSim en
// applyOffers. Solo para explicarlo en la portada del juego.
const LIVE_FX_LEGEND = [
	{ coin: 'CUP', icon: '💵', color: '#8fe9a1', text: 'por encima de la tasa: dólar del cielo · por debajo: cráter' },
	{ coin: 'MLC', icon: '🧲', color: '#7ab8ff', text: 'imán: las monedas te buscan solas' },
	{ coin: 'CLÁSICA', icon: '🛡️', color: '#c6a2ff', text: 'escudo: te salva de un golpe' },
	{ coin: 'ETECSA', icon: '📡', color: '#ff9f43', text: 'se va la señal, pero las monedas valen ×2' },
	{ coin: 'TROPICAL', icon: '🌪️', color: '#ffd75e', text: 'turbo: más rápido y score ×2' },
	{ coin: 'CASH', icon: '💸', color: '#53dd6c', text: 'lluvia de efectivo: monedas bonus' },
	{ coin: 'GAS', icon: '⛽', color: '#a8e6cf', text: 'gravedad baja: saltos flotantes' },
]

function Confetti() {
	const pieces = useMemo(() => {
		const rand = mulberry32(0xC0FFE77)
		return Array.from({ length: 90 }, (_, i) => ({
			left: rand() * 100,
			delay: rand() * 2.5,
			dur: 3 + rand() * 2.5,
			size: 6 + rand() * 7,
			color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
			tilt: rand() * 360,
			round: rand() < 0.3,
		}))
	}, [])
	return (
		<div className="pointer-events-none fixed inset-0 z-20 overflow-hidden" aria-hidden="true">
			{pieces.map((p, i) => (
				<span
					key={i}
					className="absolute top-[-3vh] block"
					style={{
						left: `${p.left}%`,
						width: p.size,
						height: p.size * (p.round ? 1 : 0.55),
						backgroundColor: p.color,
						borderRadius: p.round ? '50%' : 2,
						transform: `rotate(${p.tilt}deg)`,
						animation: `confetti-fall ${p.dur}s linear ${p.delay}s infinite`,
					}}
				/>
			))}
		</div>
	)
}

// ── La Habana en 8 bits ─────────────────────────────────────────────────────
// Perfil de la ciudad como fondo de parallax, dibujado con bloques alineados a
// una rejilla de píxeles gordos. Es pura decoración: vive fuera de la sim, así
// que aquí sí valen Math.random/Math.sin (nunca al revés — ningún valor de
// render puede volver al estado de la simulación).
//
// La tira se genera UNA vez con semilla fija y se repite en bucle; así el
// skyline es estable (no parpadea) y no cuesta nada por frame.
const HAV_SPAN = 1600 // ancho de la tira que se repite, en px de mundo
const HAV_PX = 4      // tamaño del "píxel" del pixel-art

const snap = (v) => Math.round(v / HAV_PX) * HAV_PX

// Fachadas habaneras: pasteles desteñidos por el salitre. De día se ven tal
// cual, teñidas por la luz del sol; de noche se apagan hacia la silueta y
// solo quedan las ventanas encendidas.
const FACADES = [
	[214, 168, 96],  // ocre
	[228, 210, 170], // crema
	[86, 156, 148],  // verde azulado
	[208, 128, 122], // rosa viejo
	[116, 160, 192], // celeste
	[150, 186, 148], // menta
	[176, 104, 82],  // terracota
	[166, 140, 178], // lila
	[206, 202, 192], // blanco sucio
]
const TILE = [154, 78, 58]     // teja de los tejados
const GOLD = [232, 192, 112]   // remates dorados (Bacardí)
const TRUNK = [150, 120, 88]   // tronco de palma

const buildHavana = (seed) => {
	const rand = mulberry32(seed)
	const items = []
	const wins = (n, p = 0.38) => Array.from({ length: n }, () => ({ on: rand() < p, ph: rand() * 6.28 }))

	// Hitos reconocibles, en posiciones fijas de la tira
	items.push({ type: 'capitolio', x: 180, w: 190, h: 120, pal: [206, 196, 176] })
	items.push({ type: 'nacional', x: 620, w: 150, h: 150, pal: [226, 204, 162], win: wins(26, 0.45) })
	items.push({ type: 'focsa', x: 900, w: 64, h: 230, pal: [160, 170, 180], win: wins(4 * 18, 0.42) })
	items.push({ type: 'morro', x: 1180, w: 46, h: 200, pal: [198, 186, 158] })
	items.push({ type: 'bacardi', x: 1400, w: 72, h: 170, pal: [190, 116, 82], win: wins(4 * 9, 0.4) })

	// Relleno: manzanas de edificios. Tres estilos que conviven en cualquier
	// calle de La Habana: colonial (portales, balcones corridos, ventanas altas),
	// art déco (pilastras y remate escalonado) y moderno (bloques de ventanas
	// pequeñas con el tanque de agua en la azotea).
	const blocked = (a, b) => items.some((it) => a < it.x + it.w + 40 && b > it.x - 40)
	let x = 0
	while (x < HAV_SPAN) {
		const w = snap(46 + rand() * 80)
		if (!blocked(x, x + w)) {
			const r = rand()
			const style = r < 0.5 ? 'colonial' : r < 0.8 ? 'modern' : 'deco'
			const floors = style === 'modern' ? 3 + Math.floor(rand() * 6) : 2 + Math.floor(rand() * 3)
			const floorH = style === 'colonial' ? 20 : 16
			const cols = Math.max(1, Math.floor((w - 8) / (style === 'modern' ? 12 : 16)))
			const r2 = rand()
			items.push({
				type: 'block', style, x: snap(x), w, floors, floorH, cols,
				h: snap(floors * floorH + 8),
				pal: FACADES[Math.floor(rand() * FACADES.length)],
				roof: r2 < 0.4 ? 'tank' : r2 < 0.65 ? 'antenna' : 'flat',
				arcade: style === 'colonial' && rand() < 0.65,
				win: wins(cols * floors),
			})
		}
		x += w + snap(6 + rand() * 22)
	}

	// Palmas reales entre los edificios, siempre en primer plano
	for (let k = 0; k < 7; k++) {
		items.push({ type: 'palm', x: snap(rand() * HAV_SPAN), w: 0, h: snap(34 + rand() * 30), lean: (rand() - 0.5) * 8, pal: [74, 128, 70] })
	}
	return items.sort((a, b) => a.x - b.x)
}

const HAVANA = buildHavana(0x484241)

// Paleta del cielo a lo largo del run: amanece, se hace de día, atardece sobre
// el Malecón y cae la noche justo cuando llegas a HOY. Se mantiene oscura a
// propósito — la línea verde del CUP tiene que seguir siendo lo más legible.
const SKY = [
	{ at: 0.00, top: [7, 8, 15], hor: [17, 20, 40], glow: [70, 60, 140], sun: [150, 160, 210], night: 1 },
	{ at: 0.16, top: [18, 22, 46], hor: [120, 62, 58], glow: [225, 130, 80], sun: [255, 190, 120], night: 0.5 },
	{ at: 0.30, top: [20, 34, 62], hor: [186, 110, 62], glow: [255, 170, 100], sun: [255, 222, 160], night: 0.15 },
	{ at: 0.40, top: [18, 36, 68], hor: [196, 152, 112], glow: [210, 190, 150], sun: [255, 244, 210], night: 0.05 },
	{ at: 0.50, top: [16, 38, 70], hor: [52, 104, 142], glow: [110, 180, 224], sun: [255, 250, 226], night: 0 },
	{ at: 0.72, top: [30, 20, 52], hor: [206, 86, 46], glow: [255, 122, 77], sun: [255, 176, 96], night: 0.2 },
	{ at: 0.86, top: [18, 12, 34], hor: [104, 42, 54], glow: [190, 80, 90], sun: [255, 140, 110], night: 0.65 },
	{ at: 1.00, top: [7, 10, 16], hor: [14, 36, 24], glow: [46, 174, 92], sun: [200, 240, 214], night: 1 },
]

const lerpStops = (stops, t) => {
	let a = stops[0], b = stops[stops.length - 1]
	for (let i = 0; i < stops.length - 1; i++) {
		if (t >= stops[i].at && t <= stops[i + 1].at) { a = stops[i]; b = stops[i + 1]; break }
	}
	const k = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at)
	const mixArr = (p, q) => p.map((c, i) => Math.round(c + (q[i] - c) * k))
	return {
		top: mixArr(a.top, b.top),
		hor: mixArr(a.hor, b.hor),
		glow: mixArr(a.glow, b.glow),
		sun: mixArr(a.sun, b.sun),
		night: a.night + (b.night - a.night) * k,
	}
}

// Fantasma: re-simula la partida de otra persona en paralelo a la tuya, paso a
// paso. Solo es posible porque el mapa está congelado por día (lib/gameDay.js),
// así que su traza y la tuya corren exactamente la misma pista.
//
// Su `py` está en la escala de SU pantalla (terrainY depende de state.h), por
// eso se devuelve normalizado y el render lo multiplica por la altura actual.
const makeGhost = (course, ghost) => {
	if (!ghost?.run?.jumps) return null
	const { run, offers } = ghost
	const w = run.w, h = run.h
	if (!Number.isFinite(w) || !Number.isFinite(h)) return null
	const state = initSim(course, w, h)
	const jumps = run.jumps || []
	const evts = run.offers || []
	const resizes = run.resizes || []
	let ji = 0, oi = 0, ri = 0, step = 0
	return {
		name: ghost.name,
		score: ghost.score,
		state,
		get done() { return state.dead || state.won },
		// Avanza un paso de física, aplicando sus inputs en el mismo orden que el
		// verificador del server (resizes → ofertas → saltos → física)
		step() {
			if (state.dead || state.won) return
			while (ri < resizes.length && resizes[ri][0] === step) { applyResize(state, resizes[ri][1], resizes[ri][2]); ri++ }
			if (oi < evts.length && evts[oi][0] === step) {
				const batch = []
				while (oi < evts.length && evts[oi][0] === step) {
					const row = offers?.[String(evts[oi][1])]
					batch.push({ id: evts[oi][1], value: row?.value ?? 0, coin: row?.coin ?? 'CUP', status: row?.status ?? 'attempt' })
					oi++
				}
				applyOffers(state, course, batch)
			}
			while (ji < jumps.length && jumps[ji] === step) { applyJump(state); ji++ }
			stepPhysics(state, course)
			step++
		},
	}
}

export default function Game() {

	const canvasRef = useRef(null)
	const courseRef = useRef(null)
	const coinImgRef = useRef(null)
	const audioRef = useRef(null)
	const [status, setStatus] = useState('loading') // loading | ready | playing | dead | error
	const [death, setDeath] = useState(null)
	const [best, setBest] = useState(null)
	const [share, setShare] = useState(null) // {url, blob} — captured death-frame card
	const [playerName, setPlayerName] = useState('')
	const [nameDraft, setNameDraft] = useState('')
	const [nameError, setNameError] = useState(false)
	const [board, setBoard] = useState(null) // {top: [...], runs}
	const [rank, setRank] = useState(null)
	const [submitError, setSubmitError] = useState(null)
	const [ghostInfo, setGhostInfo] = useState(null) // {name, score} del fantasma cargado
	const [ghostOn, setGhostOn] = useState(true)      // ¿se dibuja el fantasma? (hay quien corre mejor sin él)
	const ghostOnRef = useRef(true)
	const [presence, setPresence] = useState(null)   // {live, recent}
	const [boardTab, setBoardTab] = useState('today') // today | all
	const playBtnRef = useRef(null)
	const [playOffscreen, setPlayOffscreen] = useState(false) // ¿se salió de vista el botón de jugar?
	const [musicOn, setMusicOn] = useState(false)
	const musicOnRef = useRef(false)
	const submittedRef = useRef(false) // one submission per death
	const runTokenRef = useRef(null) // signed run token, issued at takeoff (anti-cheat)
	const runTokenPromiseRef = useRef(null) // in-flight token fetch — awaited at submit so fast deaths don't race it
	// Token del PRÓXIMO run, pedido por adelantado. La edad del token es el
	// presupuesto de tiempo del run en el verificador, así que pedirlo cuando ya
	// empezaste a correr le regala tu latencia de red al reloj — en conexiones
	// lentas eso mandaba runs honestos al honeypot.
	const spareTokenRef = useRef(null) // {token, at}
	const ghostRef = useRef(null)      // partida del rival a batir hoy (traza + ofertas)
	const clientIdRef = useRef(null)   // id de sesión para el contador de presencia
	const revRef = useRef(null) // snapshot id de la historia usada para el course (anti-cheat)
	const traceRef = useRef(null) // traza del run (saltos/ofertas/resizes por paso) — el server la re-simula

	useEffect(() => {
		try {
			// Sincroniza estado externo (localStorage) al montar. Si react-hooks vuelve
			// a analizar este componente, hará falta un eslint-disable-next-line de
			// react-hooks/set-state-in-effect aquí.
			setBest(JSON.parse(localStorage.getItem(BEST_KEY)))
			// Only accept a stored name if it's a valid Telegram handle (older saves may predate the @ format)
			const savedName = normalizeTg(localStorage.getItem(NAME_KEY))
			if (savedName) { setPlayerName(savedName); setNameDraft(savedName.slice(1)) }
			// La música solo arranca dentro de una partida, nunca al abrir la página
			const wantsMusic = localStorage.getItem(MUSIC_KEY) !== 'off'
			setMusicOn(wantsMusic)
			musicOnRef.current = wantsMusic
			const wantsGhost = localStorage.getItem(GHOST_KEY) !== 'off'
			setGhostOn(wantsGhost)
			ghostOnRef.current = wantsGhost
		} catch { /* first run */ }
		const img = new Image()
		img.src = '/cup.png'
		coinImgRef.current = img
	}, [])

	// Un token por run: se pide con antelación para que su edad cubra el run entero
	const fetchToken = useCallback(
		() => fetch('/api/game-token').then((res) => res.json()).then((json) => json.token || null).catch(() => null),
		[],
	)

	// Fantasma del día: tu propio récord si ya jugaste hoy, si no el del líder
	const loadGhost = useCallback(async () => {
		try {
			const me = normalizeTg(localStorage.getItem(NAME_KEY))
			let res = me ? await fetch(`/api/game-ghost?self=${encodeURIComponent(me)}`) : null
			let json = res?.ok ? await res.json() : null
			if (!json?.ghost) {
				res = await fetch(`/api/game-ghost${me ? `?exclude=${encodeURIComponent(me)}` : ''}`)
				json = res.ok ? await res.json() : null
			}
			if (json?.ghost) {
				ghostRef.current = json.ghost
				setGhostInfo({ name: json.ghost.name, score: json.ghost.score, mine: json.ghost.name === me })
			}
		} catch { /* correr solo también vale */ }
	}, [])

	// Mostrar/ocultar el fantasma. Se lee por ref dentro del bucle de render,
	// así que el cambio aplica al instante, también en plena partida.
	const toggleGhost = useCallback(() => {
		const next = !ghostOnRef.current
		ghostOnRef.current = next
		setGhostOn(next)
		try { localStorage.setItem(GHOST_KEY, next ? 'on' : 'off') } catch { /* modo privado */ }
	}, [])

	// Presencia: cuánta gente está corriendo ahora mismo
	const fetchPresence = useCallback(async () => {
		try {
			const res = await fetch('/api/presence')
			if (res.ok) setPresence(await res.json())
		} catch { /* decoración */ }
	}, [])

	const fetchBoard = useCallback(async () => {
		try {
			const res = await fetch('/api/game-score')
			if (res.ok) setBoard(await res.json())
		} catch { /* leaderboard is optional decoration */ }
	}, [])

	// setBoard ocurre tras un await, no es síncrono (ver nota del efecto de arriba)
	useEffect(() => { fetchBoard() }, [fetchBoard])

	// Contador de gente jugando: se refresca cada 15 s, y el latido que alimenta
	// ese contador se manda desde el motor mientras hay una partida en curso
	useEffect(() => {
		if (!clientIdRef.current) {
			try {
				clientIdRef.current = localStorage.getItem('cambiocup:play:cid')
					|| `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
				localStorage.setItem('cambiocup:play:cid', clientIdRef.current)
			} catch { clientIdRef.current = `c${Math.random().toString(36).slice(2, 12)}` }
		}
		fetchPresence()
		const poll = setInterval(fetchPresence, 15000)
		return () => clearInterval(poll)
	}, [fetchPresence])

	// Load the real CUP history (full series, bucketed server-side)
	useEffect(() => {
		let cancelled = false
		const load = async () => {
			try {
				let res = await fetch('/api/game-history?coin=CUP')
				let json = await res.json()
				if (!json.data || json.data.length < 50) {
					res = await fetch('/api/history?coin=CUP&days=15')
					json = await res.json()
				}
				if (cancelled) return
				if (!json.data || json.data.length < 50) { setStatus('error'); return }
				courseRef.current = buildCourse(json.data)
				revRef.current = json.rev ?? null
				setStatus('ready')
				// Deja un token listo antes de que toquen "jugar"
				fetchToken().then((token) => { if (token) spareTokenRef.current = { token, at: Date.now() } })
				// Y el fantasma del día: la mejor partida verificada sobre ESTE mismo mapa
				loadGhost()
			} catch (err) {
				console.error('Error loading game data:', err)
				if (!cancelled) setStatus('error')
			}
		}
		load()
		return () => { cancelled = true }
	}, [fetchToken, loadGhost])

	// ── Engine ──────────────────────────────────────────────────────────────
	useEffect(() => {
		if (status !== 'playing' || !courseRef.current) return

		const canvas = canvasRef.current
		const ctx = canvas.getContext('2d')
		if (!audioRef.current) audioRef.current = createAudio()
		const audio = audioRef.current
		audio.preload() // fetch + decode the real coin recordings (no-op after the first run)
		if (musicOnRef.current) audio.startMusic()

		// Anti-cheat: el run va firmado con un token cuya edad prueba cuánto duró de
		// verdad. Se usa el que ya estaba pedido (así su reloj arranca ANTES que el
		// run y la latencia no se descuenta del presupuesto); si no hay uno fresco
		// se pide ahora y el submit lo espera.
		const spare = spareTokenRef.current
		spareTokenRef.current = null
		if (spare && Date.now() - spare.at < 20 * 60 * 1000) {
			runTokenRef.current = spare.token
			runTokenPromiseRef.current = Promise.resolve(spare.token)
		} else {
			runTokenRef.current = null
			runTokenPromiseRef.current = fetchToken().then((token) => { runTokenRef.current = token; return token })
		}
		fetchToken().then((token) => { if (token) spareTokenRef.current = { token, at: Date.now() } })
		const course = courseRef.current
		const { values, times, spikes, coins, stars, n, finishX } = course

		// Estado de física (gameSim) + traza del run: cada salto, oferta en vivo y
		// resize queda registrado con su número de paso para que el server pueda
		// re-simular el run completo y verificar el score.
		let state = null
		let trace = null

		let W = 0, H = 0
		const resize = () => {
			const dpr = Math.min(window.devicePixelRatio || 1, 2)
			W = canvas.clientWidth
			H = canvas.clientHeight
			canvas.width = Math.round(W * dpr)
			canvas.height = Math.round(H * dpr)
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			if (state && !state.dead) { applyResize(state, W, H); trace.resizes.push([state.steps, W, H]) }
		}
		resize()
		window.addEventListener('resize', resize)

		state = initSim(course, W, H)
		trace = { w: W, h: H, resizes: [], offers: [], jumps: [] }

		// Rival del día, corriendo la misma pista congelada en paralelo
		const ghost = makeGhost(course, ghostRef.current)

		// Latido de presencia mientras dure la partida (alimenta "N corriendo ahora")
		const beat = () => {
			fetch('/api/presence', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: clientIdRef.current, day: runStatsDay(), score: Math.round(state.score) }),
			}).catch(() => { /* best-effort */ })
		}
		const runStatsDay = () => dayAt(course, Math.floor((state.worldX + state.px) / DX))
		beat()
		const beatPoll = setInterval(beat, 20000)

		const terrainY = (wx) => simTerrainY(state, course, wx)
		const holeAt = (wx) => simHoleAt(state, wx)

		// Vistas estables sobre el estado de la sim (mutadas en sitio, nunca reasignadas)
		const holes = state.holes
		const liveDollars = state.liveDollars
		const bonusCoins = state.bonusCoins
		const taken = state.taken
		const R = state.r
		const PX = state.px
		const trail = []
		const popups = []
		const particles = []   // {x, y, vx, vy, t, ttl, r, color, kind} — puro adorno
		const banners = []     // avisos de dinámica en vivo {title, sub, color, t}
		let shake = 0          // sacudida de cámara (px), decae sola
		let flash = null       // {color, t} — destello a pantalla completa
		let raf = 0

		// Partículas: pool con tope duro para no ahogar un móvil lento
		const MAX_PARTICLES = 200
		const spawn = (count, make) => {
			for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) particles.push(make(i))
		}
		const burst = (x, y, count, color, opts = {}) => {
			const { speed = 170, ttl = 0.6, r = 3, kind = 'dot', spread = Math.PI * 2, dir = 0 } = opts
			spawn(count, () => {
				const a = dir + (Math.random() - 0.5) * spread
				const v = speed * (0.35 + Math.random() * 0.65)
				return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, ttl: ttl * (0.7 + Math.random() * 0.6), r: r * (0.6 + Math.random()), color, kind }
			})
		}

		// El cielo recorre un día entero a lo largo del run: amanece al principio de
		// la historia, atardece sobre el Malecón y cae la noche justo al llegar a
		// HOY. Además de bonito, es una barra de progreso que no hay que leer.
		const totalDays = dayAt(course, n - 1)
		const ERAS_UNUSED = null

		const rgb = (c, alpha) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`

		// Sol / luna: arco sobre el horizonte según el avance del run
		const drawSunMoon = (sky, t) => {
			const isMoon = sky.night > 0.55
			const arc = Math.min(1, Math.max(0, (t - 0.06) / 0.88))
			const sx = W * (0.08 + arc * 0.84)
			const sy = H * 0.62 - Math.sin(arc * Math.PI) * H * 0.42
			const r = isMoon ? 13 : 19
			const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 6)
			halo.addColorStop(0, rgb(sky.sun, 0.5))
			halo.addColorStop(0.35, rgb(sky.glow, 0.16))
			halo.addColorStop(1, rgb(sky.glow, 0))
			ctx.fillStyle = halo
			ctx.fillRect(sx - r * 6, sy - r * 6, r * 12, r * 12)
			ctx.fillStyle = rgb(sky.sun, 0.95)
			ctx.beginPath()
			ctx.arc(sx, sy, r, 0, Math.PI * 2)
			ctx.fill()
			if (isMoon) { // muerde la luna para que sea creciente
				ctx.globalCompositeOperation = 'destination-out'
				ctx.beginPath()
				ctx.arc(sx + r * 0.55, sy - r * 0.3, r * 0.92, 0, Math.PI * 2)
				ctx.fill()
				ctx.globalCompositeOperation = 'source-over'
			}
			return { sx, sy }
		}

		// Color de una fachada bajo la luz del momento: de día es su pastel teñido
		// por el sol (dorado al amanecer, blanco al mediodía, naranja al caer);
		// de noche se funde con la silueta azulada. `L.haze` lo mezcla con el
		// horizonte — perspectiva aérea: cuanto más lejos, más desvaído.
		const facade = (pal, L, k = 1) => {
			const { sky, haze } = L
			const day = 1 - sky.night
			let out = ''
			for (let i = 0; i < 3; i++) {
				const sunlit = pal[i] * (0.5 + 0.5 * (sky.sun[i] / 255)) * L.k * k
				const dark = (sky.top[i] * L.darkMul + L.darkAdd) * k
				const c = sunlit * day + dark * (1 - day)
				out += (i ? ',' : '') + Math.round(c * (1 - haze) + sky.hor[i] * haze)
			}
			return `rgb(${out})`
		}

		// Ventanas: de día son huecos oscuros (persianas cerradas al sol); de
		// noche solo se ven las encendidas, cada una parpadeando a su ritmo.
		const drawWindow = (x, y, w, h, win, L, t) => {
			if (L.dayA > 0.02) { ctx.fillStyle = L.winDay; ctx.fillRect(x, y, w, h) }
			if (L.lit > 0.02 && win?.on) {
				ctx.fillStyle = `rgba(255, 214, 138, ${L.lit * (0.55 + 0.45 * Math.sin(t * 0.7 + win.ph))})`
				ctx.fillRect(x, y, w, h)
			}
		}

		// Un edificio de la tira, en bloques. La luz viene de la izquierda: el
		// lado derecho va en sombra y las cornisas llevan un filo claro.
		const drawBuilding = (it, bx, baseY, L, t) => {
			const P = HAV_PX
			const x0 = snap(bx), w = snap(it.w), h = snap(it.h), y0 = snap(baseY - h)
			const base = facade(it.pal, L)
			const shade = facade(it.pal, L, 0.7)
			const trim = facade(it.pal, L, 1.2)
			const body = (x, y, ww, hh) => { // caja con el lado derecho en sombra
				ctx.fillStyle = base
				ctx.fillRect(x, y, ww, hh)
				ctx.fillStyle = shade
				ctx.fillRect(x + ww - P, y, P, hh)
			}

			if (it.type === 'palm') {
				const top = baseY - h
				ctx.lineCap = 'round'
				ctx.strokeStyle = facade(TRUNK, L)
				ctx.lineWidth = P * 0.75
				ctx.beginPath()
				ctx.moveTo(x0, baseY)
				ctx.lineTo(x0 + it.lean, top)
				ctx.stroke()
				ctx.strokeStyle = base
				ctx.lineWidth = P
				for (let k = 0; k < 6; k++) { // pencas, con un balanceo mínimo de brisa
					const a = -Math.PI * 0.95 + k * (Math.PI * 0.9 / 5) + Math.sin(t * 0.8 + k) * 0.04
					ctx.beginPath()
					ctx.moveTo(x0 + it.lean, top)
					ctx.lineTo(x0 + it.lean + Math.cos(a) * P * 4.5, top + Math.sin(a) * P * 3 + P * 2)
					ctx.stroke()
				}
				ctx.lineCap = 'butt'
				return
			}

			if (it.type === 'capitolio') {
				// Cuerpo con columnata, pórtico central, tambor y cúpula
				const bodyH = snap(h * 0.48)
				body(x0, baseY - bodyH, w, bodyH)
				ctx.fillStyle = trim
				ctx.fillRect(x0, baseY - bodyH, w, P)
				for (let cx = x0 + P * 2; cx < x0 + w - P * 2; cx += P * 3) ctx.fillRect(cx, baseY - bodyH + P * 2, P, bodyH - P * 3)
				const pw = snap(w * 0.34), px0 = snap(x0 + (w - pw) / 2), ph = snap(h * 0.6)
				body(px0, baseY - ph, pw, ph)
				ctx.fillStyle = trim
				for (let cx = px0 + P; cx < px0 + pw - P; cx += P * 2) ctx.fillRect(cx, baseY - ph + P * 2, P, ph - P * 3)
				ctx.fillRect(px0 - P, baseY - ph, pw + P * 2, P)
				// frontón escalonado
				ctx.fillStyle = base
				ctx.fillRect(px0 + P * 2, baseY - ph - P, pw - P * 4, P)
				ctx.fillRect(px0 + P * 5, baseY - ph - P * 2, pw - P * 10, P)
				// tambor con columnas
				const dw = snap(w * 0.24), dx0 = snap(x0 + (w - dw) / 2), dh = snap(h * 0.16), dTop = baseY - ph - P * 2 - dh
				body(dx0, dTop, dw, dh)
				ctx.fillStyle = trim
				for (let cx = dx0 + P; cx < dx0 + dw - P; cx += P * 2) ctx.fillRect(cx, dTop + P, P, dh - P * 2)
				// cúpula: perfil circular en escalones
				const steps = 8, rad = w * 0.15, domeH = h * 0.24
				for (let k = 0; k < steps; k++) {
					const f = (k + 0.5) / steps
					const dwk = snap(rad * 2 * Math.sqrt(1 - f * f))
					ctx.fillStyle = k % 2 ? base : trim
					ctx.fillRect(snap(x0 + w / 2 - dwk / 2), snap(dTop - (k + 1) * (domeH / steps)), dwk, snap(domeH / steps) + 1)
				}
				// linterna
				ctx.fillStyle = trim
				ctx.fillRect(snap(x0 + w / 2 - P), snap(dTop - domeH - P * 3), P * 2, P * 3)
				ctx.fillRect(snap(x0 + w / 2 - P / 2), snap(dTop - domeH - P * 5), P, P * 2)
				return
			}

			if (it.type === 'nacional') {
				// Cuerpo con dos plantas de arcadas y las torres gemelas con tejado
				const bodyH = snap(h * 0.56)
				body(x0, baseY - bodyH, w, bodyH)
				ctx.fillStyle = trim
				ctx.fillRect(x0, baseY - bodyH, w, P)
				const cols = 12
				for (let f = 0; f < 2; f++) for (let c = 0; c < cols; c++) {
					drawWindow(snap(x0 + P * 2 + c * ((w - P * 4) / cols)), baseY - bodyH + P * 3 + f * P * 5, P, P * 3, it.win[f * cols + c], L, t)
				}
				const tw = snap(w * 0.2), th = h - bodyH
				const tile = facade(TILE, L)
				;[0.11, 0.69].forEach((fx, i) => {
					const tx = snap(x0 + w * fx)
					body(tx, baseY - h, tw, th)
					ctx.fillStyle = tile
					ctx.fillRect(tx - P, baseY - h - P, tw + P * 2, P)
					ctx.fillRect(tx + P, baseY - h - P * 2, tw - P * 2, P)
					ctx.fillRect(tx + P * 2, baseY - h - P * 3, tw - P * 4, P)
					drawWindow(tx + P, baseY - h + P * 3, P, P * 2, it.win[cols * 2 + i], L, t)
					drawWindow(tx + tw - P * 3, baseY - h + P * 3, P, P * 2, it.win[cols * 2 + i], L, t)
				})
				return
			}

			if (it.type === 'focsa') {
				// La torre en Y del Vedado: espina central clara y cintas de ventanas
				body(x0, y0, w, h)
				ctx.fillStyle = trim
				ctx.fillRect(snap(x0 + w * 0.46), y0, P, h)
				const cols = 4, rows = 18
				for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
					drawWindow(snap(x0 + P + c * ((w - P * 3) / cols)), snap(y0 + P * 3 + r * ((h - P * 5) / rows)), P * 2, P, it.win[r * cols + c], L, t)
				}
				ctx.fillStyle = shade
				ctx.fillRect(snap(x0 + w * 0.3), y0 - P * 2, snap(w * 0.4), P * 2) // caseta
				ctx.fillRect(snap(x0 + w * 0.5), y0 - P * 6, 2, P * 4) // antena
				return
			}

			if (it.type === 'morro') {
				// Muralla con almenas, torre que se estrecha por tramos y el farol
				const wallW = snap(w * 3.2), wallH = snap(h * 0.16), wx0 = snap(x0 - w * 1.1)
				body(wx0, baseY - wallH, wallW, wallH)
				ctx.fillStyle = trim
				for (let cx = wx0; cx < wx0 + wallW; cx += P * 2) ctx.fillRect(cx, baseY - wallH - P, P, P)
				const seg = (from, to, sw) => {
					const ww = snap(w * sw), sx = snap(x0 + (w - ww) / 2)
					body(sx, snap(baseY - h * to), ww, snap(h * (to - from)) + 1)
					ctx.fillStyle = trim
					ctx.fillRect(sx - P, snap(baseY - h * to), ww + P * 2, P)
				}
				seg(0, 0.38, 1)
				seg(0.38, 0.7, 0.82)
				seg(0.7, 0.9, 0.66)
				const lw = snap(w * 0.6), lx = snap(x0 + (w - lw) / 2), ly = snap(baseY - h), lh = snap(h * 0.08)
				const pulse = (Math.sin(t * 1.1) + 1) / 2
				body(lx - P, ly, lw + P * 2, lh) // la sala del farol, con el cristal encendido dentro
				ctx.fillStyle = `rgba(255, 236, 170, ${0.1 + (0.2 + pulse * 0.45) * L.lit})`
				ctx.fillRect(lx, ly + P / 2, lw, lh - P)
				ctx.fillStyle = shade
				ctx.fillRect(lx - P * 2, ly - P, lw + P * 4, P)
				ctx.fillRect(snap(x0 + w / 2 - P / 2), ly - P * 3, P, P * 2)
				if (L.lit > 0.05) { // el haz barre la bahía, solo de noche
					const a = t * 0.9
					const cx = x0 + w / 2, cy = ly + lh / 2, len = 240 * (w / 46)
					ctx.fillStyle = `rgba(255, 244, 200, ${0.14 * L.lit * (0.5 + 0.5 * Math.cos(a))})`
					ctx.beginPath()
					ctx.moveTo(cx, cy)
					ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.35 - 18)
					ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.35 + 18)
					ctx.closePath()
					ctx.fill()
				}
				return
			}

			if (it.type === 'bacardi') {
				// Art déco: pilastras verticales, remate escalonado en terracota y
				// oro, y la torre con su murciélago
				const bodyH = snap(h * 0.62)
				body(x0, baseY - bodyH, w, bodyH)
				ctx.fillStyle = trim
				for (let cx = x0 + P; cx < x0 + w - P; cx += P * 4) ctx.fillRect(cx, baseY - bodyH, P, bodyH)
				const cols = 4
				for (let f = 0; f < 9; f++) for (let c = 0; c < cols; c++) {
					if (P * 2 + f * 16 + P * 2 > bodyH) continue
					drawWindow(snap(x0 + P * 2 + c * P * 4), baseY - bodyH + P * 2 + f * 16, P * 2, P * 2, it.win[f * cols + c], L, t)
				}
				const gold = facade(GOLD, L)
				let prev = 0.62
				for (const [sw, to] of [[0.84, 0.72], [0.62, 0.82], [0.4, 0.9]]) {
					const ww = snap(w * sw), sx = snap(x0 + (w - ww) / 2)
					body(sx, snap(baseY - h * to), ww, snap(h * (to - prev)) + 1)
					ctx.fillStyle = gold
					ctx.fillRect(sx, snap(baseY - h * to), ww, P)
					prev = to
				}
				body(snap(x0 + w / 2 - P * 2), snap(baseY - h), P * 4, snap(h * 0.1) + 1)
				ctx.fillStyle = gold
				ctx.fillRect(snap(x0 + w / 2 - P * 2), snap(baseY - h), P * 4, P)
				ctx.fillRect(snap(x0 + w / 2 - P * 1.5), snap(baseY - h - P), P * 3, P)
				return
			}

			// Manzana normal
			body(x0, y0, w, h)
			ctx.fillStyle = trim
			ctx.fillRect(x0, y0, w, P) // cornisa
			if (it.style === 'deco') { // remate escalonado y pilastras
				ctx.fillStyle = base
				ctx.fillRect(x0 + P * 2, y0 - P * 2, w - P * 4, P * 2)
				ctx.fillStyle = trim
				ctx.fillRect(x0 + P * 2, y0 - P * 2, w - P * 4, P)
				ctx.fillRect(snap(x0 + w / 2 - P), y0 - P * 4, P * 2, P * 2)
				ctx.fillStyle = shade
				for (let cx = x0 + P * 2; cx < x0 + w - P * 2; cx += P * 4) ctx.fillRect(cx, y0 + P, P, h - P * 2)
			}
			const winW = it.style === 'modern' ? P * 2 : P
			const winH = it.style === 'colonial' ? P * 3 : it.style === 'deco' ? P * 2 : P
			const colW = (w - P * 2) / it.cols
			for (let f = 0; f < it.floors; f++) {
				if (it.arcade && f === it.floors - 1) break // la planta baja es el portal
				const fy = y0 + P * 2 + f * it.floorH
				for (let c = 0; c < it.cols; c++) {
					drawWindow(snap(x0 + P + c * colW + (colW - winW) / 2), fy, winW, winH, it.win[f * it.cols + c], L, t)
				}
				if (it.style === 'colonial' && f < it.floors - 1) { // balcón corrido
					ctx.fillStyle = shade
					ctx.fillRect(x0 + P, fy + winH, w - P * 2, P)
				}
			}
			if (it.arcade) { // portales con columnas en la planta baja
				const ah = P * 4
				ctx.fillStyle = shade
				ctx.fillRect(x0, baseY - ah, w, ah)
				ctx.fillStyle = trim
				for (let cx = x0 + P; cx < x0 + w - P; cx += P * 3) ctx.fillRect(cx, baseY - ah, P, ah)
			}
			if (it.roof === 'tank') { // tanque de agua sobre patas
				const tx = snap(x0 + w * 0.6)
				ctx.fillStyle = shade
				ctx.fillRect(tx, y0 - P * 3, P * 3, P * 2)
				ctx.fillRect(tx, y0 - P, P, P)
				ctx.fillRect(tx + P * 2, y0 - P, P, P)
				ctx.fillStyle = trim
				ctx.fillRect(tx, y0 - P * 4, P * 3, P)
			} else if (it.roof === 'antenna') {
				const ax = snap(x0 + w * 0.3)
				ctx.fillStyle = shade
				ctx.fillRect(ax + 1, y0 - P * 5, 2, P * 5)
				ctx.fillRect(ax - P, y0 - P * 4, P * 3, 2)
				ctx.fillRect(ax - P / 2, y0 - P * 3, P * 2, 2)
			}
		}

		// Una capa de ciudad, repetida en bucle y desplazada por parallax. Los
		// edificios van primero y las palmas después, para que queden delante.
		const drawCity = (wx0, factor, scale, baseY, L, t) => {
			const shift = wx0 * factor
			const span = HAV_SPAN * scale
			const start = Math.floor(shift / span) - 1
			for (let pass = 0; pass < 2; pass++) {
				for (let rep = start; rep < start + Math.ceil(W / span) + 2; rep++) {
					for (const it of HAVANA) {
						if ((it.type === 'palm') !== (pass === 1)) continue
						const bx = rep * span + it.x * scale - shift
						if (bx > W + 220 || bx + it.w * scale < -220) continue
						drawBuilding({ ...it, w: it.w * scale, h: it.h * scale }, bx, baseY, L, t)
					}
				}
			}
		}

		// Silueta lejana: la MISMA curva del CUP repetida a otra escala y otra
		// velocidad. El fondo no es decoración genérica, es el propio gráfico.
		const ridge = (wx0, factor, squeeze, offset, fillStyle) => {
			ctx.beginPath()
			ctx.moveTo(-10, H + 20)
			for (let sx = -10; sx <= W + 10; sx += 10) {
				const wx = (wx0 * factor + sx) * 1.7
				const fi = wx / DX
				const i0 = Math.floor(fi)
				const ft = fi - i0
				const hh = course.heights[((i0 % n) + n) % n] * (1 - ft) + course.heights[((i0 + 1) % n + n) % n] * ft
				ctx.lineTo(sx, H * offset - hh * H * squeeze)
			}
			ctx.lineTo(W + 10, H + 20)
			ctx.closePath()
			ctx.fillStyle = fillStyle
			ctx.fill()
		}

		// Live offers as difficulty events: same feed as the homepage cards
		// (/api/offers, 3s poll). Offer ≥ nominal → a dollar falls from the sky;
		// offer < nominal → a double-jump crater opens in the terrain ahead.
		const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
		const seenOffers = new Set()

		const roundedRect = (c, x, y, w, h, r) => {
			c.beginPath()
			if (c.roundRect) { c.roundRect(x, y, w, h, r); return }
			c.moveTo(x + r, y)
			c.arcTo(x + w, y, x + w, y + h, r)
			c.arcTo(x + w, y + h, x, y + h, r)
			c.arcTo(x, y + h, x, y, r)
			c.arcTo(x, y, x + w, y, r)
			c.closePath()
		}

		const fmtValue = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

		// Ficha visual de cada dinámica: color, icono y copy del banner. La sim ya
		// aplicó el efecto; esto es solo cómo se lee en pantalla.
		const FX_LOOK = {
			dollar: { color: '#8fe9a1', icon: '💵', title: 'DÓLAR DEL CIELO', sub: 'esquívalo' },
			crater: { color: '#e05265', icon: '🕳️', title: 'CRÁTER EN VIVO', sub: 'doble salto' },
			magnet: { color: '#7ab8ff', icon: '🧲', title: 'IMÁN MLC', sub: 'las monedas te buscan' },
			shield: { color: '#c6a2ff', icon: '🛡️', title: 'ESCUDO CLÁSICA', sub: 'aguanta un golpe' },
			blackout: { color: '#ff9f43', icon: '📡', title: 'SE FUE ETECSA', sub: 'sin señal · monedas ×2' },
			turbo: { color: '#ffd75e', icon: '🌪️', title: 'RACHA TROPICAL', sub: 'más rápido · score ×2' },
			lowgrav: { color: '#a8e6cf', icon: '⛽', title: 'GRAVEDAD BAJA', sub: 'saltos flotantes' },
			cash: { color: '#53dd6c', icon: '💸', title: 'LLUVIA DE EFECTIVO', sub: 'monedas bonus' },
		}

		// Anuncia en pantalla una dinámica recién disparada por el feed P2P
		const announce = (ev) => {
			const look = FX_LOOK[ev.fx]
			if (!look) return
			banners.push({
				title: `${look.icon} ${look.title}`,
				sub: `${ev.coin} · $${fmtValue(ev.value)} · ${look.sub}`,
				color: look.color,
				t: 0,
			})
			if (banners.length > 3) banners.shift()
			flash = { color: look.color, t: 0 }
			if (ev.fx === 'crater' || ev.fx === 'dollar') shake = Math.max(shake, 7)
			audio.event(ev.fx)
			burst(PX, state.py, 14, look.color, { speed: 230, ttl: 0.5, r: 2.6 })
		}

		// El spawn (posiciones incluidas) lo computa gameSim desde el estado, así el
		// server reproduce lo mismo con solo [paso, id] en la traza
		const fetchOffers = async () => {
			try {
				const res = await fetch('/api/offers')
				const json = await res.json()
				if (state.dead || state.won || !json.offers?.length) return
				const batch = []
				for (const o of json.offers) {
					if (seenOffers.has(o.id)) continue
					seenOffers.add(o.id)
					batch.push({ id: o.id, value: Number(o.value) || 0, coin: o.coin, status: o.status, type: o.type })
				}
				if (!batch.length) return
				// La traza solo guarda [paso, id]: moneda, valor y estado los relee el
				// verificador de la tabla `offers`, así que no hay nada que falsear
				for (const o of batch) trace.offers.push([state.steps, o.id])
				for (const ev of applyOffers(state, course, batch)) announce(ev)
			} catch { /* offline tick — retry on next poll */ }
		}
		fetchOffers()
		const offerPoll = setInterval(fetchOffers, 3000)

		const mod = (i) => ((i % n) + n) % n

		let finished = false
		const endRun = (won) => {
			if (finished) return
			finished = true
			audio.stopMusic()
			if (won) audio.win()
			else audio.death()
			cancelAnimationFrame(raf)
			const rawIdx = Math.floor((state.worldX + PX) / DX)
			const loops = Math.floor(rawIdx / n)
			const idx = won ? n - 1 : mod(rawIdx)
			const day = dayAt(course, won ? n - 1 : rawIdx)
			const dateStr = loops > 0 && !won
				? 'un futuro lejano 🚀'
				: new Date(times[idx] * 1000).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
			const stats = { day, dateStr, rate: values[idx].toFixed(2), score: Math.round(state.score), won }
			// La traza completa del run muerto queda lista para el submit: el server
			// la re-simula y solo acepta el score si lo reproduce
			traceRef.current = trace
			try {
				const prev = JSON.parse(localStorage.getItem(BEST_KEY))
				if (!prev || stats.score > prev.score) {
					localStorage.setItem(BEST_KEY, JSON.stringify({ score: stats.score, day: stats.day }))
					setBest({ score: stats.score, day: stats.day })
					stats.isRecord = true
				}
			} catch { /* localStorage unavailable */ }
			try {
				const sans = getComputedStyle(document.body).fontFamily || 'sans-serif'
				buildShareCard(canvas, stats, sans).toBlob((blob) => {
					if (blob) setShare({ url: URL.createObjectURL(blob), blob })
				}, 'image/png')
			} catch (err) { console.error('Error building share card:', err) }
			setDeath(stats)
			setStatus('dead')
		}

		const jump = () => {
			// Se aplica justo antes del paso state.steps: la traza guarda ese índice
			// y el server lo re-aplica en el mismo punto exacto
			const kind = applyJump(state)
			if (!kind) return
			trace.jumps.push(state.steps)
			if (kind === 'jump') audio.jump()
			else audio.doubleJump()
		}

		const onPointer = (e) => { e.preventDefault(); jump() }
		const onKey = (e) => {
			if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump() }
		}
		canvas.addEventListener('pointerdown', onPointer)
		window.addEventListener('keydown', onKey)

		// Reacción audiovisual a cada evento de la sim. Devuelve true si el run
		// terminó, para que el bucle de física corte en el mismo punto.
		const onSimEvent = (ev) => {
			if (ev.type === 'coin') {
				audio.coin(ev.combo)
				const x2 = ev.mult > 1 ? ` ×${ev.mult}` : ''
				popups.push({ x: PX, y: ev.cy - 20, text: `+${ev.gain} ×${ev.combo}${x2}`, t: 0, color: ev.mult > 1 ? '#ffd75e' : '#53dd6c' })
				burst(PX, ev.cy, ev.mult > 1 ? 9 : 5, '#ffd75e', { speed: 130, ttl: 0.45, r: 2.2 })
				return false
			}
			if (ev.type === 'bonus') {
				audio.bonus()
				popups.push({ x: PX, y: ev.cy - 20, text: `+${ev.gain} EFECTIVO`, t: 0, color: '#53dd6c' })
				burst(PX, ev.cy, 12, '#53dd6c', { speed: 190, ttl: 0.55, r: 2.6, kind: 'bill' })
				return false
			}
			if (ev.type === 'shield') {
				// El escudo de CLASICA absorbió el golpe: sacudida + onda morada
				audio.shieldSave()
				shake = 16
				flash = { color: '#c6a2ff', t: 0 }
				popups.push({ x: PX, y: state.py - 40, text: '🛡️ ¡SALVADO!', t: 0, color: '#c6a2ff' })
				burst(PX, state.py, 26, '#c6a2ff', { speed: 300, ttl: 0.7, r: 3.2 })
				return false
			}
			if (ev.type === 'die') {
				shake = 22
				burst(PX, state.py, 30, '#e05265', { speed: 320, ttl: 0.9, r: 3.4 })
				endRun(false)
				return true
			}
			if (ev.type === 'win') { endRun(true); return true }
			return false
		}

		let lastT = performance.now()
		let acc = 0

		const frame = (now) => {
			const dt = Math.min((now - lastT) / 1000, 0.1) // dt real, solo para el render
			lastT = now

			// ── Update: la física corre en gameSim a paso fijo (reproducible) ──
			acc += dt
			while (acc >= STEP) {
				acc -= STEP
				if (ghost) ghost.step() // mismo número de pasos que el jugador: van a la par
				for (const ev of stepPhysics(state, course)) { if (onSimEvent(ev)) return }
			}

			const { worldX, py, elapsed, score, combo, comboTimer } = state
			const pwx = worldX + PX
			const magnetOn = state.magnet > 0
			const turboOn = state.turbo > 0
			const blackoutOn = state.blackout > 0
			const lowgravOn = state.lowgrav > 0

			trail.push({ y: py })
			if (trail.length > 14) trail.shift()

			// ── Draw ──
			// Progreso del run = hora del día. Amanece en 2023, atardece sobre el
			// Malecón y es de noche cuando cruzas la bandera de HOY.
			const prog = Math.min(1, dayAt(course, Math.floor(pwx / DX)) / totalDays)
			const sky = lerpStops(SKY, prog)
			// La línea del CUP vive entre 0,38·H y 0,72·H. La ciudad arranca justo ahí
			// y CRECE HACIA ARRIBA, de modo que el terreno cercano le tapa la base
			// (que es exactamente lo que hace la profundidad) en vez de quedar
			// dibujada por debajo del gráfico.
			const HOR = H * 0.6

			const bg = ctx.createLinearGradient(0, 0, 0, HOR)
			bg.addColorStop(0, rgb(sky.top, 1))
			bg.addColorStop(1, rgb(sky.hor, 1))
			ctx.fillStyle = bg
			ctx.fillRect(0, 0, W, HOR)
			ctx.fillStyle = rgb(sky.top.map((c) => Math.round(c * 0.55)), 1)
			ctx.fillRect(0, HOR, W, H - HOR)

			// Estrellas: solo de noche, se apagan al amanecer
			if (sky.night > 0.05) {
				ctx.fillStyle = '#ffffff'
				for (const st of stars) {
					const span = W * 1.5
					const sx = ((st.x * span - worldX * 0.06) % span + span) % span - W * 0.25
					ctx.globalAlpha = st.a * sky.night * (0.6 + 0.4 * Math.sin(elapsed * 1.6 + st.x * 30))
					ctx.beginPath()
					ctx.arc(sx, st.y * HOR, st.r, 0, Math.PI * 2)
					ctx.fill()
				}
				ctx.globalAlpha = 1
			}

			const orb = blackoutOn ? null : drawSunMoon(sky, prog)

			// Cordillera lejana: la MISMA curva del CUP a otra escala — el gráfico
			// también es el fondo
			ridge(worldX, 0.06, 0.16, 0.60, rgb(sky.glow, 0.1))

			// Mar del Malecón: banda estrecha bajo la ciudad, con el reflejo del astro
			const sea = ctx.createLinearGradient(0, HOR, 0, H)
			sea.addColorStop(0, rgb(sky.hor.map((c) => Math.round(c * 0.6)), 1))
			sea.addColorStop(1, rgb(sky.top.map((c) => Math.round(c * 0.5)), 1))
			ctx.fillStyle = sea
			ctx.fillRect(0, HOR, W, H - HOR)
			if (orb && orb.sy < HOR) {
				ctx.globalAlpha = 0.22
				ctx.fillStyle = rgb(sky.sun, 1)
				for (let k = 0; k < 6; k++) {
					const rw = snap(54 - k * 7 + Math.sin(elapsed * 1.7 + k) * 9)
					ctx.fillRect(snap(orb.sx - rw / 2), snap(HOR + 6 + k * 8), rw, HAV_PX)
				}
				ctx.globalAlpha = 1
			}

			// La Habana en dos planos: la lejana, desvaída por la calima y más
			// lenta; la cercana con sus colores y más rápida. Ambas nacen en el
			// horizonte y crecen hacia el cielo.
			const dayA = 1 - sky.night
			const layer = (k, haze, darkMul, darkAdd, lit) => ({
				sky, k, haze, darkMul, darkAdd, lit, dayA,
				winDay: `rgba(12, 16, 30, ${(0.5 * dayA * (1 - haze)).toFixed(3)})`,
			})
			drawCity(worldX, 0.08, 0.8, HOR + 1, layer(0.7, 0.45, 1.7, 16, sky.night * 0.45), elapsed)
			drawCity(worldX, 0.16, 1.0, HOR + 3, layer(0.86, 0.12, 1.1, 5, sky.night * 0.9), elapsed + 40)

			// Cámara: sacudidas por golpes y cráteres. Todo el mundo se dibuja
			// dentro de este translate; el HUD queda fuera para que no tiemble.
			ctx.save()
			if (shake > 0.4) {
				ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake)
				shake *= Math.pow(0.0025, dt) // decae ~exponencial, independiente del framerate
			} else shake = 0

			// Spikes ARE the chart: the line itself shoots up into a sharp red peak
			// (like a price wick), so they're born from the line by construction
			const nearSpikes = []
			for (const s of spikes) {
				const screenX = s.i * DX - worldX
				if (screenX > -150 && screenX < W + 150) {
					const g = Math.min(1, Math.max(0, (W + 40 - screenX) / 160))
					nearSpikes.push({ s, grow: 1 - (1 - g) * (1 - g) })
				}
			}
			const bumpAt = (wx) => {
				let bump = 0
				for (const { s, grow } of nearSpikes) {
					const half = s.w / 2 + 12 // wide foot for a gentle takeoff
					const dx = Math.abs(wx - s.i * DX)
					if (dx < half) {
						const frac = 1 - dx / half
						const ss = frac * frac * (3 - 2 * frac) // smoothstep: zero-slope exit from the line
						bump = Math.max(bump, s.h * grow * ss ** 1.7)
					}
				}
				return bump
			}
			const lineY = (wx) => terrainY(wx) - bumpAt(wx)

			// Terrain: contiguous runs of samples (holes split them); spikes included in the path
			const runs = []
			let run = null
			for (let sx = -10; sx <= W + 10; sx += 4) {
				const wx = worldX + sx
				if (holeAt(wx)) { run = null; continue }
				if (!run) { run = []; runs.push(run) }
				run.push({ sx, y: lineY(wx) })
			}
			for (const r of runs) {
				if (r.length < 2) continue
				const fill = ctx.createLinearGradient(0, H * 0.4, 0, H)
				fill.addColorStop(0, 'rgba(30, 153, 53, 0.22)')
				fill.addColorStop(1, 'rgba(30, 153, 53, 0.02)')
				ctx.fillStyle = fill
				ctx.beginPath()
				ctx.moveTo(r[0].sx, H + 20)
				for (const p of r) ctx.lineTo(p.sx, p.y)
				ctx.lineTo(r[r.length - 1].sx, H + 20)
				ctx.closePath()
				ctx.fill()

				ctx.strokeStyle = '#53dd6c'
				ctx.lineWidth = 3
				ctx.lineJoin = 'round'
				ctx.shadowColor = '#53dd6c'
				ctx.shadowBlur = 12
				ctx.beginPath()
				if (r[0].sx > 0) ctx.moveTo(r[0].sx, H + 20), ctx.lineTo(r[0].sx, r[0].y)
				else ctx.moveTo(r[0].sx, r[0].y)
				for (const p of r) ctx.lineTo(p.sx, p.y)
				if (r[r.length - 1].sx < W) ctx.lineTo(r[r.length - 1].sx, H + 20)
				ctx.stroke()
				ctx.shadowBlur = 0
			}

			// Repaint the spiking stretch of the line in crimson, fading back into
			// green at both ends, with a red inner tint and a smoldering peak
			for (const { s, grow } of nearSpikes) {
				if (grow <= 0.02) continue
				const wx0 = s.i * DX
				const half = s.w / 2 + 12
				const xA = wx0 - half - 8
				const xB = wx0 + half + 8
				const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3 + s.i * 1.7)

				const crest = []
				for (let wx = xA; wx <= xB; wx += 3) {
					if (holeAt(wx)) continue
					crest.push([wx - worldX, lineY(wx)])
				}
				if (crest.length < 2) continue

				const baseY = terrainY(wx0)
				const peakY = baseY - s.h * grow

				// Inner tint: the spike glows red from within the terrain fill
				const tint = ctx.createLinearGradient(0, peakY, 0, baseY)
				tint.addColorStop(0, `rgba(215, 38, 61, ${0.4 + pulse * 0.1})`)
				tint.addColorStop(1, 'rgba(215, 38, 61, 0)')
				ctx.fillStyle = tint
				ctx.beginPath()
				ctx.moveTo(crest[0][0], crest[0][1])
				for (const [x, y] of crest) ctx.lineTo(x, y)
				ctx.closePath()
				ctx.fill()

				// Heat ramp along the climb: the line warms up with altitude —
				// green at the foot, yellow → amber → orange → crimson at the peak
				const grad = ctx.createLinearGradient(0, baseY + 2, 0, peakY)
				grad.addColorStop(0, 'rgba(140, 225, 130, 0)')
				grad.addColorStop(0.12, 'rgba(216, 226, 100, 0.45)')
				grad.addColorStop(0.3, 'rgba(255, 178, 86, 0.85)')
				grad.addColorStop(0.55, '#ff7a5a')
				grad.addColorStop(1, '#ff4d63')
				ctx.strokeStyle = grad
				ctx.lineWidth = 3.5
				ctx.lineJoin = 'round'
				ctx.shadowColor = 'rgba(224, 56, 79, 0.95)'
				ctx.shadowBlur = 13 + pulse * 8
				ctx.beginPath()
				ctx.moveTo(crest[0][0], crest[0][1])
				for (const [x, y] of crest) ctx.lineTo(x, y)
				ctx.stroke()
				ctx.shadowBlur = 0

				// Peak ember
				const emberR = 6 + pulse * 4
				const px = wx0 - worldX
				const ember = ctx.createRadialGradient(px, peakY, 0, px, peakY, emberR)
				ember.addColorStop(0, `rgba(255, 220, 226, ${0.7 + pulse * 0.3})`)
				ember.addColorStop(1, 'rgba(255, 114, 133, 0)')
				ctx.fillStyle = ember
				ctx.beginPath()
				ctx.arc(px, peakY, emberR, 0, Math.PI * 2)
				ctx.fill()
			}

			// Meta de "HOY": bandera con asta en el último punto de la historia.
			// Solo decoración — el cruce lo detecta gameSim (evento 'win').
			{
				const fsx = finishX - worldX
				if (fsx > -120 && fsx < W + 120) {
					const baseY = terrainY(finishX)
					const poleH = Math.min(150, H * 0.28)
					const topY = baseY - poleH
					// Halo en la base, como un checkpoint que respira
					const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4)
					ctx.globalAlpha = 0.35 + pulse * 0.3
					ctx.strokeStyle = '#ffd75e'
					ctx.lineWidth = 2
					ctx.beginPath()
					ctx.ellipse(fsx, baseY, 26 + pulse * 6, 8, 0, 0, Math.PI * 2)
					ctx.stroke()
					ctx.globalAlpha = 1
					// Asta
					ctx.strokeStyle = '#f5efe0'
					ctx.lineWidth = 3.5
					ctx.shadowColor = 'rgba(255, 215, 94, 0.8)'
					ctx.shadowBlur = 10
					ctx.beginPath()
					ctx.moveTo(fsx, baseY)
					ctx.lineTo(fsx, topY)
					ctx.stroke()
					ctx.shadowBlur = 0
					ctx.fillStyle = '#ffd75e'
					ctx.beginPath()
					ctx.arc(fsx, topY, 4.5, 0, Math.PI * 2)
					ctx.fill()
					// Bandera ondeando (tiras verticales con desfase sinusoidal)
					const fw = 74
					const fh = 44
					ctx.fillStyle = '#53dd6c'
					ctx.shadowColor = '#53dd6c'
					ctx.shadowBlur = 14
					ctx.beginPath()
					ctx.moveTo(fsx + 2, topY + 3)
					const STRIPS = 12
					for (let k = 0; k <= STRIPS; k++) {
						const t = k / STRIPS
						ctx.lineTo(fsx + 2 + t * fw, topY + 3 + Math.sin(elapsed * 6 - t * 4) * 5 * t)
					}
					for (let k = STRIPS; k >= 0; k--) {
						const t = k / STRIPS
						ctx.lineTo(fsx + 2 + t * fw, topY + 3 + fh + Math.sin(elapsed * 6 - t * 4) * 5 * t)
					}
					ctx.closePath()
					ctx.fill()
					ctx.shadowBlur = 0
					ctx.fillStyle = '#04240b'
					ctx.font = `800 17px ${MONO}`
					ctx.textAlign = 'center'
					ctx.textBaseline = 'middle'
					ctx.fillText('HOY', fsx + 2 + fw / 2, topY + 3 + fh / 2 + Math.sin(elapsed * 6 - 2) * 2.5)
					ctx.textBaseline = 'alphabetic'
				}
			}

			// Coins
			const coinMult = (blackoutOn ? 2 : 1) * (turboOn ? 2 : 1)
			for (const c of coins) {
				let sx = c.x - worldX
				if (sx < -30 || sx > W + 30 || taken.has(c.id)) continue
				let cy = terrainY(c.x) - c.dy + Math.sin(elapsed * 3 + c.id) * 4
				// Imán de MLC: la moneda se ve viajar hacia ti dentro del radio real
				// de recogida, así que lo que ves es lo que la física ya hace
				if (magnetOn) {
					const dx = PX - sx
					const dy = py - cy
					const d = Math.sqrt(dx * dx + dy * dy)
					const reach = R + 12 + MAGNET_RADIUS
					if (d < reach && d > 0.001) {
						const pull = 1 - d / reach
						sx += dx * pull * 0.55
						cy += dy * pull * 0.55
					}
				}
				const hot = coinMult > 1
				ctx.fillStyle = hot ? '#fff0b3' : '#ffd75e'
				ctx.shadowColor = '#ffd75e'
				ctx.shadowBlur = hot ? 18 : 10
				ctx.beginPath()
				ctx.arc(sx, cy, hot ? 12.5 : 11, 0, Math.PI * 2)
				ctx.fill()
				ctx.shadowBlur = 0
				if (magnetOn) {
					ctx.strokeStyle = 'rgba(122, 184, 255, 0.55)'
					ctx.lineWidth = 1.5
					ctx.beginPath()
					ctx.arc(sx, cy, 15, 0, Math.PI * 2)
					ctx.stroke()
				}
				ctx.fillStyle = '#7a5b00'
				ctx.font = '800 13px ui-monospace, SFMono-Regular, Menlo, monospace'
				ctx.textAlign = 'center'
				ctx.textBaseline = 'middle'
				ctx.fillText('$', sx, cy + 1)
			}

			// Lluvia de efectivo (CASH): billetes bonus, no suben el combo
			for (const b of bonusCoins) {
				let sx = b.x - worldX
				if (sx < -40 || sx > W + 40) continue
				let by = terrainY(b.x) - b.dy + Math.sin(elapsed * 4 + b.x * 0.02) * 3
				if (magnetOn) {
					const dx = PX - sx
					const dy = py - by
					const d = Math.sqrt(dx * dx + dy * dy)
					const reach = R + 12 + MAGNET_RADIUS
					if (d < reach && d > 0.001) { sx += dx * (1 - d / reach) * 0.55; by += dy * (1 - d / reach) * 0.55 }
				}
				ctx.save()
				ctx.translate(sx, by)
				ctx.rotate(Math.sin(elapsed * 2.5 + b.x * 0.01) * 0.25)
				ctx.shadowColor = '#53dd6c'
				ctx.shadowBlur = 14
				ctx.fillStyle = '#146623'
				roundedRect(ctx, -17, -10, 34, 20, 4)
				ctx.fill()
				ctx.shadowBlur = 0
				ctx.strokeStyle = '#8fe9a1'
				ctx.lineWidth = 1.4
				roundedRect(ctx, -17, -10, 34, 20, 4)
				ctx.stroke()
				ctx.fillStyle = '#d6f5dc'
				ctx.font = `800 12px ${MONO}`
				ctx.textAlign = 'center'
				ctx.textBaseline = 'middle'
				ctx.fillText('$', 0, 1)
				ctx.restore()
			}

			// Live crater warnings: dashed red line across the gap + offer tag
			for (const h of holes) {
				if (!h.live) continue
				const sx0 = h.x0 - worldX
				const sx1 = h.x1 - worldX
				if (sx1 < -100 || sx0 > W + 400) continue
				const y0 = terrainY(h.x0 - 1)
				const y1 = terrainY(h.x1 + 1)
				ctx.strokeStyle = 'rgba(224, 82, 101, 0.7)'
				ctx.lineWidth = 2
				ctx.setLineDash([6, 5])
				ctx.beginPath()
				ctx.moveTo(sx0, y0)
				ctx.lineTo(sx1, y1)
				ctx.stroke()
				ctx.setLineDash([])
				ctx.globalAlpha = 0.55 + 0.45 * Math.sin(elapsed * 5 + h.x0 * 0.01)
				ctx.fillStyle = '#e05265'
				ctx.font = `700 12px ${MONO}`
				ctx.textAlign = 'center'
				ctx.textBaseline = 'alphabetic'
				ctx.fillText(`▼ $${fmtValue(h.live.value)} · EN VIVO`, (sx0 + sx1) / 2, Math.min(y0, y1) - 18)
				ctx.globalAlpha = 1
			}

			// Falling dollars
			for (const d of liveDollars) {
				const sx = d.x - worldX
				if (sx < -100 || sx > W + 150) continue
				const alpha = d.state === 'ground' && d.groundT > 5 ? Math.max(0, 1 - (d.groundT - 5)) : 1
				// Landing marker while falling
				if (d.state === 'fall') {
					const gy = terrainY(d.x)
					ctx.globalAlpha = 0.45 + 0.35 * Math.sin(elapsed * 7)
					ctx.strokeStyle = '#53dd6c'
					ctx.lineWidth = 2
					ctx.beginPath()
					ctx.ellipse(sx, gy, 18 + 5 * Math.sin(elapsed * 6), 6, 0, 0, Math.PI * 2)
					ctx.stroke()
					ctx.globalAlpha = 1
				}
				ctx.save()
				ctx.globalAlpha = alpha
				ctx.translate(sx, d.y)
				ctx.rotate(d.state === 'fall' ? Math.sin(elapsed * 6 + d.x) * 0.35 : 0.06)
				ctx.shadowColor = '#53dd6c'
				ctx.shadowBlur = 12
				ctx.fillStyle = '#146623'
				roundedRect(ctx, -22, -12, 44, 24, 5)
				ctx.fill()
				ctx.shadowBlur = 0
				ctx.strokeStyle = '#53dd6c'
				ctx.lineWidth = 1.5
				roundedRect(ctx, -22, -12, 44, 24, 5)
				ctx.stroke()
				ctx.fillStyle = '#d6f5dc'
				ctx.font = `800 15px ${MONO}`
				ctx.textAlign = 'center'
				ctx.textBaseline = 'middle'
				ctx.fillText('$', 0, 1)
				ctx.restore()
				ctx.globalAlpha = alpha * (0.55 + 0.45 * Math.sin(elapsed * 5 + d.x * 0.01))
				ctx.fillStyle = '#8fe9a1'
				ctx.font = `700 12px ${MONO}`
				ctx.textAlign = 'center'
				ctx.textBaseline = 'alphabetic'
				ctx.fillText(`▲ $${fmtValue(d.value)} · EN VIVO`, sx, d.y - 26)
				ctx.globalAlpha = 1
			}

			// Popups
			for (let i = popups.length - 1; i >= 0; i--) {
				const p = popups[i]
				p.t += dt
				if (p.t > 1.1) { popups.splice(i, 1); continue }
				ctx.globalAlpha = Math.max(0, 1 - p.t)
				ctx.fillStyle = p.color || '#53dd6c'
				ctx.font = '700 16px ui-monospace, SFMono-Regular, Menlo, monospace'
				ctx.textAlign = 'left'
				ctx.fillText(p.text, p.x + 20, p.y - p.t * 55)
				ctx.globalAlpha = 1
			}

			// Partículas (monedas, impactos, escudo). Puro adorno: viven fuera de la sim.
			for (let i = particles.length - 1; i >= 0; i--) {
				const pt = particles[i]
				pt.t += dt
				if (pt.t >= pt.ttl) { particles.splice(i, 1); continue }
				pt.x += pt.vx * dt
				pt.y += pt.vy * dt
				pt.vy += 520 * dt
				const k = 1 - pt.t / pt.ttl
				ctx.globalAlpha = k
				ctx.fillStyle = pt.color
				if (pt.kind === 'bill') {
					ctx.fillRect(pt.x - worldX * 0 - pt.r, pt.y - pt.r * 0.6, pt.r * 2, pt.r * 1.2)
				} else {
					ctx.beginPath()
					ctx.arc(pt.x, pt.y, pt.r * k, 0, Math.PI * 2)
					ctx.fill()
				}
			}
			ctx.globalAlpha = 1

			// Líneas de velocidad del turbo tropical
			if (turboOn) {
				ctx.strokeStyle = 'rgba(255, 215, 94, 0.2)'
				ctx.lineWidth = 1.5
				for (let i = 0; i < 6; i++) {
					const ly = ((elapsed * 700 + i * 211) % (H * 0.75)) + H * 0.05
					const lx = ((elapsed * 1800 + i * 311) % (W + 300)) - 150
					ctx.beginPath()
					ctx.moveTo(lx + 44, ly)
					ctx.lineTo(lx, ly + 3)
					ctx.stroke()
				}
			}

			// Motas flotando hacia arriba mientras dura la gravedad baja
			if (lowgravOn) {
				ctx.fillStyle = 'rgba(168, 230, 207, 0.4)'
				for (let i = 0; i < 12; i++) {
					const fx2 = ((i * 97 + elapsed * 40) % (W + 40)) - 20
					const fy2 = H - ((elapsed * 60 + i * 83) % (H + 60))
					ctx.beginPath()
					ctx.arc(fx2, fy2, 2, 0, Math.PI * 2)
					ctx.fill()
				}
			}

			// Fantasma: el rival del día, translúcido. Se dibujan también SUS cráteres
			// y dólares en vivo (los que enfrentó él, no tú) para que se entienda por
			// qué salta donde salta.
			if (ghost && !ghost.done && ghostOnRef.current) {
				const g = ghost.state
				const gx = g.worldX + g.px - worldX   // mundo → mi pantalla
				const gy = (g.py / g.h) * H           // su pantalla → la mía
				if (gx > -140 && gx < W + 140) {
					ctx.globalAlpha = 0.3
					for (const h of g.holes) {
						if (!h.live) continue
						const a = h.x0 - worldX, b = h.x1 - worldX
						if (b < -60 || a > W + 60) continue
						ctx.strokeStyle = '#8ab4ff'
						ctx.lineWidth = 2
						ctx.setLineDash([4, 6])
						ctx.beginPath()
						ctx.moveTo(a, terrainY(h.x0 - 1))
						ctx.lineTo(b, terrainY(h.x1 + 1))
						ctx.stroke()
						ctx.setLineDash([])
					}
					for (const d of g.liveDollars) {
						const dx2 = d.x - worldX
						if (dx2 < -60 || dx2 > W + 60) continue
						ctx.fillStyle = '#8ab4ff'
						roundedRect(ctx, dx2 - 18, (d.y / g.h) * H - 10, 36, 20, 4)
						ctx.fill()
					}
					// El corredor
					ctx.globalAlpha = 0.42
					ctx.fillStyle = '#9ec6ff'
					ctx.shadowColor = '#7ab8ff'
					ctx.shadowBlur = 14
					ctx.beginPath()
					ctx.arc(gx, gy, R, 0, Math.PI * 2)
					ctx.fill()
					ctx.shadowBlur = 0
					ctx.globalAlpha = 0.85
					ctx.fillStyle = '#cfe2ff'
					ctx.font = `700 11px ${MONO}`
					ctx.textAlign = 'center'
					ctx.textBaseline = 'alphabetic'
					ctx.fillText(ghost.name, gx, gy - R - 10)
					ctx.globalAlpha = 1
				}
			}

			// Player: sombra + trail + moneda real de 1 peso (public/cup.png) rodando
			{
				const gy = terrainY(pwx)
				const air = Math.max(0, Math.min(1, (gy - R - py) / 220))
				ctx.globalAlpha = 0.28 * (1 - air)
				ctx.fillStyle = '#000000'
				ctx.beginPath()
				ctx.ellipse(PX, gy - 2, R * (1 - air * 0.5), R * 0.3 * (1 - air * 0.5), 0, 0, Math.PI * 2)
				ctx.fill()
				ctx.globalAlpha = 1
			}
			for (let i = 0; i < trail.length; i++) {
				ctx.globalAlpha = (i / trail.length) * (turboOn ? 0.4 : 0.25)
				ctx.fillStyle = turboOn ? '#ffd75e' : '#f0c85a'
				ctx.beginPath()
				ctx.arc(PX - (trail.length - i) * 4.5, trail[i].y, R * (0.4 + (i / trail.length) * 0.5), 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.globalAlpha = 1
			ctx.save()
			ctx.translate(PX, py)
			// Squash & stretch: se estira al caer y se achata al asentarse
			const stretch = Math.max(-0.22, Math.min(0.22, state.vy / 4200))
			ctx.scale(1 - stretch, 1 + stretch)
			ctx.rotate((worldX / R) * 0.7) // rueda: ángulo ∝ distancia recorrida
			const img = coinImgRef.current
			const invulnOn = state.invuln > 0
			ctx.globalAlpha = invulnOn && Math.floor(elapsed * 20) % 2 === 0 ? 0.45 : 1
			if (img?.complete && img.naturalWidth) {
				ctx.shadowColor = 'rgba(255, 210, 110, 0.8)'
				ctx.shadowBlur = 18
				ctx.beginPath()
				ctx.arc(0, 0, R * 0.96, 0, Math.PI * 2)
				ctx.fillStyle = 'rgba(240, 200, 90, 0.35)' // halo cálido detrás de la moneda
				ctx.fill()
				ctx.shadowBlur = 0
				ctx.drawImage(img, -R, -R, R * 2, R * 2)
			} else {
				ctx.fillStyle = '#e0b64b'
				ctx.shadowColor = 'rgba(255, 210, 110, 0.8)'
				ctx.shadowBlur = 16
				ctx.beginPath()
				ctx.arc(0, 0, R, 0, Math.PI * 2)
				ctx.fill()
				ctx.shadowBlur = 0
			}
			ctx.restore()

			// Burbuja de escudo (CLASICA) y anillo del imán (MLC) alrededor del jugador
			if (state.shield > 0) {
				for (let i = 0; i < state.shield; i++) {
					ctx.strokeStyle = `rgba(198, 162, 255, ${0.75 - i * 0.18})`
					ctx.lineWidth = 2
					ctx.beginPath()
					ctx.arc(PX, py, R + 9 + i * 5 + Math.sin(elapsed * 3 + i) * 1.6, 0, Math.PI * 2)
					ctx.stroke()
				}
			}
			if (magnetOn) {
				const reach = R + 12 + MAGNET_RADIUS
				ctx.strokeStyle = `rgba(122, 184, 255, ${0.16 + 0.12 * Math.sin(elapsed * 6)})`
				ctx.lineWidth = 2
				ctx.setLineDash([5, 7])
				ctx.beginPath()
				ctx.arc(PX, py, reach, 0, Math.PI * 2)
				ctx.stroke()
				ctx.setLineDash([])
			}

			ctx.restore() // ← fin de la cámara con shake: el HUD ya no tiembla

			// Apagón de ETECSA: se cierra la viñeta y se cae la señal
			if (blackoutOn) {
				const dark = ctx.createRadialGradient(PX, py, R * 2, PX, py, Math.max(W, H) * 0.62)
				dark.addColorStop(0, 'rgba(0,0,0,0)')
				dark.addColorStop(0.45, 'rgba(0,0,0,0.42)')
				dark.addColorStop(1, 'rgba(0,0,0,0.88)')
				ctx.fillStyle = dark
				ctx.fillRect(0, 0, W, H)
				// Banda de glitch que barre la pantalla
				const gy2 = ((elapsed * 260) % (H + 80)) - 40
				ctx.fillStyle = 'rgba(255, 159, 67, 0.09)'
				ctx.fillRect(0, gy2, W, 22)
				ctx.fillStyle = 'rgba(255, 159, 67, 0.75)'
				ctx.font = `800 13px ${MONO}`
				ctx.textAlign = 'center'
				ctx.textBaseline = 'alphabetic'
				ctx.globalAlpha = 0.5 + 0.5 * Math.sin(elapsed * 9)
				ctx.fillText('📡 SIN SEÑAL — MONEDAS ×2', W / 2, H * 0.4)
				ctx.globalAlpha = 1
			}

			// Destello al dispararse una dinámica
			if (flash) {
				flash.t += dt
				if (flash.t > 0.35) flash = null
				else {
					ctx.globalAlpha = (1 - flash.t / 0.35) * 0.16
					ctx.fillStyle = flash.color
					ctx.fillRect(0, 0, W, H)
					ctx.globalAlpha = 1
				}
			}

			// Viñeta: enfoca el centro y le da cuerpo a la escena
			const vig = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.78)
			vig.addColorStop(0, 'rgba(0,0,0,0)')
			vig.addColorStop(1, 'rgba(0,0,0,0.45)')
			ctx.fillStyle = vig
			ctx.fillRect(0, 0, W, H)

			// HUD
			const day = dayAt(course, Math.floor(pwx / DX))
			const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'
			ctx.textAlign = 'left'
			ctx.textBaseline = 'alphabetic'
			ctx.fillStyle = '#f5efe0'
			ctx.font = `800 ${Math.min(28, W * 0.06)}px ${mono}`
			ctx.fillText(`DÍA ${day}`, 20, 40)
			ctx.fillStyle = '#ffd75e'
			ctx.font = `700 ${Math.min(20, W * 0.045)}px ${mono}`
			ctx.fillText(`${Math.round(score).toLocaleString('es')} CUP`, 20, 68)
			ctx.fillStyle = '#53dd6c'
			ctx.font = `700 ${Math.min(17, W * 0.04)}px ${mono}`
			ctx.fillText(`COMBO ×${combo}`, 20, 94)
			ctx.fillStyle = 'rgba(83, 221, 108, 0.25)'
			ctx.fillRect(20, 102, 130, 5)
			ctx.fillStyle = '#53dd6c'
			ctx.fillRect(20, 102, 130 * Math.max(0, comboTimer / 4), 5)

			ctx.fillStyle = 'rgba(255,255,255,0.35)'
			ctx.font = `500 12px ${mono}`
			ctx.textAlign = 'right'
			ctx.fillText('ø fechas ocultas hasta que caigas', W - 16, 32)

			audio.setMusicMood({ turbo: turboOn, blackout: blackoutOn })

			// Distancia al fantasma: lo único que necesitas saber es si vas delante
			if (ghost && ghostOnRef.current) {
				const lead = (worldX + PX) - (ghost.state.worldX + ghost.state.px)
				const ahead = lead >= 0
				const days = Math.abs(lead) / DX * ((totalDays || 1) / n)
				ctx.textAlign = 'left'
				ctx.fillStyle = ghost.done ? 'rgba(255,255,255,0.4)' : ahead ? '#53dd6c' : '#7ab8ff'
				ctx.font = `700 12px ${mono}`
				ctx.fillText(
					ghost.done
						? `👻 ${ghost.name} cayó — ${ghost.score.toLocaleString('es')}`
						: `👻 ${ghost.name} · ${ahead ? '▲ le sacas' : '▼ te saca'} ${days < 1 ? '<1' : Math.round(days)} día${Math.round(days) === 1 ? '' : 's'}`,
					20, 126,
				)
			}

			// Fichas de dinámicas activas: icono + barra de cuenta atrás. Sin esto
			// el jugador no sabe cuánto le queda de imán, turbo o apagón.
			const chips = []
			if (state.turbo > 0) chips.push({ icon: '🌪️', color: '#ffd75e', k: state.turbo / (7 * 120) })
			if (state.magnet > 0) chips.push({ icon: '🧲', color: '#7ab8ff', k: state.magnet / (8 * 120) })
			if (state.blackout > 0) chips.push({ icon: '📡', color: '#ff9f43', k: state.blackout / (6 * 120) })
			if (state.lowgrav > 0) chips.push({ icon: '⛽', color: '#a8e6cf', k: state.lowgrav / (6 * 120) })
			for (let i = 0; i < state.shield; i++) chips.push({ icon: '🛡️', color: '#c6a2ff', k: 1 })
			ctx.textAlign = 'center'
			ctx.textBaseline = 'middle'
			for (let i = 0; i < chips.length; i++) {
				const c = chips[i]
				const cx = W - 32 - i * 46
				const cy = 72
				ctx.fillStyle = 'rgba(0,0,0,0.45)'
				roundedRect(ctx, cx - 19, cy - 19, 38, 38, 11)
				ctx.fill()
				ctx.strokeStyle = c.color
				ctx.lineWidth = 2
				roundedRect(ctx, cx - 19, cy - 19, 38, 38, 11)
				ctx.stroke()
				ctx.font = '19px sans-serif'
				ctx.fillText(c.icon, cx, cy - 2)
				if (c.k < 1) {
					ctx.fillStyle = 'rgba(255,255,255,0.18)'
					ctx.fillRect(cx - 14, cy + 12, 28, 3)
					ctx.fillStyle = c.color
					ctx.fillRect(cx - 14, cy + 12, 28 * Math.max(0, Math.min(1, c.k)), 3)
				}
			}
			// Banners de las ofertas reales que acaban de entrar al run
			for (let i = banners.length - 1; i >= 0; i--) {
				const b = banners[i]
				b.t += dt
				if (b.t > 2.6) { banners.splice(i, 1); continue }
				const slot = banners.length - 1 - i
				const appear = Math.min(1, b.t / 0.18)
				const fade = b.t > 2.1 ? 1 - (b.t - 2.1) / 0.5 : 1
				const by = H * 0.17 + slot * 46
				ctx.globalAlpha = Math.max(0, fade)
				ctx.translate(0, (1 - appear) * -18)
				const bw = Math.min(W - 40, 320)
				ctx.fillStyle = 'rgba(8, 9, 13, 0.82)'
				roundedRect(ctx, W / 2 - bw / 2, by - 18, bw, 40, 13)
				ctx.fill()
				ctx.strokeStyle = b.color
				ctx.lineWidth = 1.6
				roundedRect(ctx, W / 2 - bw / 2, by - 18, bw, 40, 13)
				ctx.stroke()
				ctx.fillStyle = b.color
				ctx.font = `800 13px ${mono}`
				ctx.textAlign = 'center'
				ctx.textBaseline = 'alphabetic'
				ctx.fillText(b.title, W / 2, by - 1)
				ctx.fillStyle = 'rgba(255,255,255,0.55)'
				ctx.font = `600 11px ${mono}`
				ctx.fillText(b.sub, W / 2, by + 14)
				ctx.translate(0, (1 - appear) * 18)
				ctx.globalAlpha = 1
			}
			ctx.textBaseline = 'alphabetic'

			raf = requestAnimationFrame(frame)
		}

		raf = requestAnimationFrame(frame)

		return () => {
			cancelAnimationFrame(raf)
			clearInterval(offerPoll)
			clearInterval(beatPoll)
			audio.stopMusic()
			window.removeEventListener('resize', resize)
			window.removeEventListener('keydown', onKey)
			canvas.removeEventListener('pointerdown', onPointer)
		}
	}, [status, fetchToken])

	const shareUrl = 'https://www.cambiocup.com/play'
	const flavor = !death
		? ''
		: death.score === 0
			? 'Morí sin cobrar ni un quilo 😭'
			: death.score < 2500
				? "Con eso no compro ni el pan 🥖"
				: death.score < 8000
					? "Me alcanza pa' un cartón de huevos 🥚"
					: 'Eso ya es plata seria, asere 😎💵'
	const shareText = death
		? death.won
			? [
				'🏁 ¡SOBREVIVÍ A TODA LA HISTORIA DEL CUP, ASERE!',
				'',
				`🪙 Surfeé los ${death.day} días del precio REAL del dólar en Cuba y llegué a HOY`,
				`📅 Hoy el CUP está en $${death.rate}`,
				'',
				`💰 Botín: ${death.score.toLocaleString('es')} CUP — ${flavor}`,
				'',
				'¿Puedes llegar a la meta tú también? 🎮👇',
			].join('\n')
			: [
				'💀 ¡ME MATÓ LA TASA, ASERE!',
				'',
				`🪙 Sobreviví ${death.day} días surfeando el precio REAL del CUP`,
				`📅 Caí el ${death.dateStr} con el dólar a $${death.rate}`,
				'',
				`💰 Botín: ${death.score.toLocaleString('es')} CUP — ${flavor}`,
				'',
				'¿Puedes superarme? 🎮👇',
			].join('\n')
		: ''

	// True on iOS/Android (and some desktops): native sheet can share the PNG itself
	const canShareImage = useMemo(() => {
		if (!share || typeof navigator === 'undefined' || !navigator.canShare) return false
		try {
			return navigator.canShare({ files: [new File([share.blob], 'cup-runner.png', { type: 'image/png' })] })
		} catch { return false }
	}, [share])

	const nativeShare = useCallback(async () => {
		if (!share) return
		try {
			const file = new File([share.blob], 'cup-runner.png', { type: 'image/png' })
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ files: [file], text: `${shareText}\n${shareUrl}` })
			} else if (navigator.share) {
				await navigator.share({ title: 'CUP Runner', text: shareText, url: shareUrl })
			}
		} catch { /* user cancelled */ }
	}, [share, shareText])

	const submitScore = useCallback(async (name) => {
		if (!death || submittedRef.current) return
		submittedRef.current = true
		setSubmitError(null)
		try {
			localStorage.setItem(NAME_KEY, name)
			setPlayerName(name)
			// Espera el fetch del token si sigue en vuelo (una muerte a los ~3s podía
			// ganarle la carrera y caer al honeypot con un submit sin token)
			const token = runTokenRef.current || (runTokenPromiseRef.current ? await runTokenPromiseRef.current : null)
			// La traza (saltos/ofertas/resizes por paso) + rev del mapa permiten al
			// server re-simular el run entero: sin una traza que reproduzca el score,
			// la submission cae al honeypot
			const payload = { name, score: death.score, day: death.day, rev: revRef.current, run: traceRef.current }
			const res = await fetch('/api/game-score', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				// Scrambled envelope keyed by the run token; a plain payload (token
				// fetch failed) still submits but lands in the server's honeypot
				body: JSON.stringify(token ? { t: token, d: encodePayload(payload, token) } : { name, score: death.score, day: death.day }),
			})
			if (res.ok) {
				const json = await res.json()
				setRank(json.rank)
				fetchBoard()
			} else {
				// Antes esto se tragaba el error en silencio: el jugador veía su
				// récord local, ningún rank, y asumía que había quedado guardado
				const json = await res.json().catch(() => null)
				setSubmitError(json?.error || 'No se pudo guardar tu puntuación.')
				submittedRef.current = false
			}
		} catch {
			setSubmitError('Sin conexión — toca para reintentar.')
			submittedRef.current = false
		}
	}, [death, fetchBoard])

	// Known player: submit automatically the moment the death screen appears
	useEffect(() => {
		// setRank/setBoard ocurren tras un await, no es síncrono (ver nota de arriba)
		if (status === 'dead' && death && playerName) submitScore(playerName)
	}, [status, death, playerName, submitScore])

	// El botón flotante de abajo solo aparece cuando el de arriba ya no se ve;
	// si no, en pantallas altas salían dos JUGAR a la vez
	useEffect(() => {
		const el = playBtnRef.current
		if (status !== 'ready' || !el || typeof IntersectionObserver === 'undefined') { setPlayOffscreen(false); return }
		// Ojo: `isIntersecting` es true con que asome un píxel, así que el umbral
		// sería decorativo. Lo que decide es la proporción visible.
		const io = new IntersectionObserver(
			([entry]) => setPlayOffscreen(entry.intersectionRatio < 0.55),
			{ threshold: [0, 0.55, 1] },
		)
		io.observe(el)
		return () => io.disconnect()
	}, [status])

	const restart = useCallback(() => {
		if (share) URL.revokeObjectURL(share.url)
		setShare(null)
		setDeath(null)
		setRank(null)
		submittedRef.current = false
		setSubmitError(null)
		setStatus('playing')
	}, [share])

	const waHref = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`
	const tgHref = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`
	const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`

	// `touch-none` solo durante la partida: en las pantallas de inicio y de muerte
	// bloqueaba el gesto de desplazar, y con el overlay sin scroll el botón de
	// JUGAR quedaba literalmente fuera de alcance en un móvil.
	return (
		<div className={`fixed inset-0 h-dvh w-full overflow-hidden bg-[#0b0c10] text-white select-none ${status === 'playing' ? 'touch-none' : 'touch-auto'}`}>
			<canvas ref={canvasRef} className="absolute inset-0 size-full" />

			{/* Silencio: la música es un son generado en el propio navegador, sin
			    descarga. Tiene que poder apagarse de un toque y recordarlo. */}
			{status !== 'loading' && status !== 'error' && (
				<button
					type="button"
					aria-label={musicOn ? 'Silenciar música' : 'Activar música'}
					onClick={(e) => {
						e.stopPropagation()
						const next = !musicOn
						setMusicOn(next)
						musicOnRef.current = next
						try { localStorage.setItem(MUSIC_KEY, next ? 'on' : 'off') } catch { /* modo privado */ }
						if (audioRef.current) {
							if (next && status === 'playing') audioRef.current.startMusic()
							else audioRef.current.stopMusic()
						}
					}}
					className="absolute bottom-4 right-4 z-30 flex size-10 items-center justify-center rounded-full liquid-glass liquid-glass--dark text-base transition-transform active:scale-90"
				>
					{musicOn ? '🔊' : '🔇'}
				</button>
			)}

			{/* Fantasma: hay quien prefiere correr sin el rival encima. Se apaga de
			    un toque, también en plena partida, y se recuerda. */}
			{ghostInfo && status !== 'loading' && status !== 'error' && (
				<button
					type="button"
					aria-label={ghostOn ? 'Ocultar fantasma' : 'Mostrar fantasma'}
					aria-pressed={ghostOn}
					onClick={(e) => { e.stopPropagation(); toggleGhost() }}
					className={`absolute bottom-4 right-16 z-30 flex size-10 items-center justify-center rounded-full liquid-glass liquid-glass--dark text-base transition-all active:scale-90 ${ghostOn ? '' : 'opacity-50 grayscale'}`}
				>
					👻
				</button>
			)}

			{status === 'loading' && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
					<div className="size-8 animate-spin rounded-full border-2 border-malachite-500 border-t-transparent" />
					<p className="text-sm text-white/60 font-medium">Cargando la historia real del CUP…</p>
				</div>
			)}

			{status === 'error' && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
					<p className="text-lg font-bold">No se pudieron cargar los datos 😕</p>
					<Link href="/" className="rounded-full liquid-glass px-6 py-2.5 font-bold">Volver al inicio</Link>
				</div>
			)}

			{status === 'ready' && (
				<div className="absolute inset-0 z-10 overflow-y-auto overscroll-contain bg-black/40">
				 <div className="flex min-h-full flex-col items-center justify-center gap-5 p-6 pb-28 text-center">
					<div>
						<p className="text-sm font-bold tracking-[0.3em] text-malachite-500 mb-2">CAMBIOCUP PRESENTA</p>
						<h1 className="text-4xl sm:text-6xl font-extrabold tracking-tighter">
							CUP <span className="text-malachite-500">RUNNER</span>
						</h1>
					</div>
					<p className="max-w-md text-sm sm:text-base text-white/70">
						Surfea la <strong className="text-white">historia real</strong> de la tasa del CUP.
						Toca para saltar y toca de nuevo en el aire para el <strong className="text-white">doble salto</strong>.
						Los <span className="text-crimson-500 font-bold">picos rojos</span> de las subidas solo se pasan con
						doble salto; los <strong>huecos</strong> de las caídas, calcula bien la distancia.
						Sobrevive hasta la <strong className="text-malachite-500">bandera de HOY 🏁</strong> y ganas.
					</p>

					{/* Jugar va ANTES que la leyenda y el ranking: es lo que vienes a hacer */}
					<button
						ref={playBtnRef}
						type="button"
						onClick={() => setStatus('playing')}
						className="rounded-full bg-malachite-500 px-10 py-3.5 text-lg font-extrabold text-black shadow-[0_0_40px_rgba(83,221,108,0.45)] hover:scale-105 active:scale-95 transition-transform"
					>
						▶ JUGAR
					</button>

					{best && (
						<p className="rounded-full liquid-glass liquid-glass--dark px-4 py-1.5 text-xs sm:text-sm text-white/80 tabular-nums">
							🏆 Tu récord: {best.score.toLocaleString('es')} CUP — día {best.day}
						</p>
					)}

					{/* La leyenda es larga: plegada por defecto en móvil, que no empuje
					    el resto de la pantalla fuera de la vista */}
					<details className="group max-w-md text-left" open={typeof window !== 'undefined' && window.innerWidth >= 640}>
						<summary className="cursor-pointer list-none text-center text-xs sm:text-sm text-white/50 marker:content-none">
							💸 Las ofertas <strong className="text-white/80">reales</strong> del P2P entran
							al juego <span className="text-malachite-500 font-bold">EN VIVO</span>, y
							<strong className="text-white/80"> cada moneda dispara lo suyo</strong>
							<span className="ml-1 inline-block text-white/40 transition-transform group-open:rotate-180">▾</span>
						</summary>
						<ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-left text-[11px] sm:text-xs text-white/60 sm:grid-cols-2">
							{LIVE_FX_LEGEND.map((fx) => (
								<li key={fx.coin} className="flex items-start gap-2">
									<span className="shrink-0 text-sm leading-tight">{fx.icon}</span>
									<span>
										<strong className="font-bold" style={{ color: fx.color }}>{fx.coin}</strong>
										<span className="text-white/45"> · {fx.text}</span>
									</span>
								</li>
							))}
						</ul>
					</details>
					{/* El mapa se congela a medianoche de La Habana, así que el ranking de
					    HOY es el único donde todos corrieron exactamente la misma pista.
					    El histórico se queda para que nadie pierda su récord. */}
					{board && (board.today?.length > 0 || board.top?.length > 0) && (
						<div className="w-full max-w-xs rounded-2xl liquid-glass liquid-glass--dark px-5 py-4 text-left">
							<div className="mb-2 flex items-center gap-1 text-[11px] font-bold tracking-[0.15em]">
								<button
									type="button"
									onClick={() => setBoardTab('today')}
									className={`rounded-full px-2.5 py-1 transition-colors ${boardTab === 'today' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'}`}
								>
									🏁 HOY
								</button>
								<button
									type="button"
									onClick={() => setBoardTab('all')}
									className={`rounded-full px-2.5 py-1 transition-colors ${boardTab === 'all' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'}`}
								>
									🌍 HISTÓRICO
								</button>
							</div>
							{(boardTab === 'today' ? board.today : board.top)?.length > 0 ? (
								(boardTab === 'today' ? board.today : board.top).slice(0, 10).map((row, i) => (
									<div key={`${row.name}-${i}`} className="flex items-center justify-between gap-3 py-0.5 text-sm">
										<span className={`truncate font-medium ${row.name === playerName ? 'text-malachite-500' : 'text-white/80'}`}>
											{['🥇', '🥈', '🥉'][i] || `${i + 1}.`} {row.name}
										</span>
										<span className="shrink-0 tabular-nums font-bold text-[#ffd75e]">{row.score.toLocaleString('es')}</span>
									</div>
								))
							) : (
								<p className="py-3 text-center text-xs text-white/45">
									Nadie ha corrido el mapa de hoy todavía.<br />
									<span className="text-malachite-500 font-bold">Sé el primero.</span>
								</p>
							)}
							<p className="mt-2 flex items-center justify-between text-[10px] text-white/35">
								<span className="tabular-nums">{board.runs?.toLocaleString('es')} partidas</span>
								<Link href="/play/top-scores" className="font-bold tracking-wide transition-colors hover:text-white/80">Top 50 →</Link>
							</p>
						</div>
					)}

					{/* Fantasma del día + gente jugando ahora */}
					<div className="flex flex-col items-center gap-2">
						{ghostInfo && (
							<p className="rounded-full liquid-glass liquid-glass--dark px-4 py-1.5 text-xs text-white/75">
								{ghostOn ? (
									<>
										👻 Corres contra {ghostInfo.mine
											? <><strong className="text-white">tu récord de hoy</strong></>
											: <><strong className="text-white">{ghostInfo.name}</strong></>}
										{' — '}<span className="tabular-nums font-bold text-[#ffd75e]">{ghostInfo.score.toLocaleString('es')}</span>
									</>
								) : (
									<>👻 Fantasma oculto</>
								)}
								{' · '}
								<button
									type="button"
									onClick={toggleGhost}
									className="font-bold text-white/60 underline underline-offset-2 transition-colors hover:text-white"
								>
									{ghostOn ? 'ocultar' : 'mostrar'}
								</button>
							</p>
						)}
						{presence?.live > 0 && (
							<p className="flex items-center gap-1.5 text-[11px] text-white/50">
								<span className="inline-block size-1.5 animate-pulse rounded-full bg-malachite-500" />
								{presence.live === 1 ? '1 persona corriendo ahora' : `${presence.live} personas corriendo ahora`}
							</p>
						)}
						{presence?.recent?.[0] && (
							<p className="text-[11px] text-white/35">
								último: <span className="text-white/55">{presence.recent[0].name}</span> — día {presence.recent[0].day} · {presence.recent[0].score.toLocaleString('es')} CUP
							</p>
						)}
					</div>
					<Link href="/" className="text-xs text-white/50 hover:text-white transition-colors">← Volver a las tasas</Link>
				 </div>

				 {/* Y si el de arriba queda fuera de vista al bajar, uno fijo abajo:
				     desde cualquier punto del scroll se puede empezar a jugar */}
				 {playOffscreen && (
					<button
						type="button"
						onClick={() => setStatus('playing')}
						className="fixed inset-x-0 bottom-0 z-20 mx-auto mb-4 w-[min(88%,320px)] animate-card-pop rounded-full bg-malachite-500 px-8 py-3.5 text-lg font-extrabold text-black shadow-[0_0_40px_rgba(83,221,108,0.55)] active:scale-95 transition-transform"
					>
						▶ JUGAR
					</button>
				 )}
				</div>
			)}

			{status === 'dead' && death && (
				<div className="absolute inset-0 z-10 overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-sm">
				 <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 pb-6 text-center">

					{death.won && <Confetti />}

					{death.won && (
						<h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-malachite-500">
							🏁 ¡GANASTE! Surfeaste TODA la historia del CUP
						</h2>
					)}

					{/* Captured final frame, photo-style */}
					{share ? (
						<div className="animate-card-pop">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								src={share.url}
								alt={death.won
									? `¡Llegaste hasta hoy! ${death.day} días — ${death.score.toLocaleString('es')} CUP`
									: `Caíste en el día ${death.day} — ${death.score.toLocaleString('es')} CUP`}
								className="w-[min(70vw,360px)] max-h-[42vh] object-contain rounded-2xl ring-4 ring-white/90 shadow-[0_25px_80px_rgba(0,0,0,0.65)]"
							/>
						</div>
					) : (
						<div className="flex size-[min(70vw,360px)] max-h-[42vh] items-center justify-center rounded-2xl liquid-glass liquid-glass--dark">
							<div className="size-7 animate-spin rounded-full border-2 border-malachite-500 border-t-transparent" />
						</div>
					)}

					<div className="flex flex-wrap items-center justify-center gap-2.5">
						{death.isRecord && (
							<span className="inline-flex h-10 items-center rounded-full bg-malachite-500 px-5 text-sm font-bold text-black">🏆 ¡Nuevo récord!</span>
						)}
						{rank && (
							<span className="inline-flex h-10 items-center rounded-full liquid-glass px-5 text-sm font-bold tabular-nums text-white/90">
								🌍 #{rank}{board?.runs ? ` de ${board.runs.toLocaleString('es')} partidas` : ''}
							</span>
						)}
					</div>

					{/* Antes un fallo de guardado era invisible: el jugador veía su récord
					    local, ningún rank, y se quedaba con que había quedado registrado */}
					{submitError && (
						<button
							type="button"
							onClick={() => { submittedRef.current = false; if (playerName) submitScore(playerName) }}
							className="rounded-2xl border border-crimson-500/60 bg-crimson-500/10 px-4 py-2.5 text-xs font-bold text-crimson-500 transition-colors hover:bg-crimson-500/20"
						>
							⚠️ {submitError}
							{playerName && <span className="ml-1 text-white/70">Toca para reintentar ↻</span>}
						</button>
					)}

					{!playerName && (
						<form
							onSubmit={(e) => {
								e.preventDefault()
								const name = normalizeTg(nameDraft)
								if (name) submitScore(name)
								else setNameError(true)
							}}
							className="flex flex-col items-center gap-2"
						>
							<div className="flex items-center gap-2">
								<div className={`flex h-11 items-center rounded-full border bg-white/10 pl-4 transition-colors focus-within:border-malachite-500 ${nameError ? 'border-crimson-500' : 'border-white/25'}`}>
									<span className="text-sm font-bold text-white/60">@</span>
									<input
										type="text"
										value={nameDraft}
										onChange={(e) => { setNameDraft(e.target.value); setNameError(false) }}
										maxLength={32}
										placeholder="tu_usuario"
										aria-label="Tu usuario de Telegram"
										autoCapitalize="none"
										autoCorrect="off"
										spellCheck={false}
										className="h-full w-40 bg-transparent px-1.5 pr-4 text-sm text-white placeholder-white/40 outline-none"
									/>
								</div>
								<button
									type="submit"
									className="inline-flex h-11 items-center justify-center rounded-full bg-malachite-500 px-5 text-sm font-bold text-black hover:scale-105 active:scale-95 transition-transform"
								>
									Anotar
								</button>
							</div>
							<p className="max-w-xs text-[11px] text-white/50">
								{nameError
									? <span className="text-crimson-600 font-medium">Usuario inválido — 5 a 32 caracteres, letras, números o _</span>
									: <>🎁 Tu @ de Telegram pa&apos;l ranking — cada semana <strong className="text-white/75">premiamos al #1</strong> y te contactamos por ahí</>}
							</p>
						</form>
					)}

					<div className="flex flex-wrap items-center justify-center gap-3">
						<button
							type="button"
							onClick={restart}
							className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 font-extrabold text-black hover:scale-105 active:scale-95 transition-transform"
						>
							↻ Reintentar
						</button>
						{canShareImage && (
							<button
								type="button"
								onClick={nativeShare}
								className="inline-flex h-12 items-center justify-center rounded-full bg-malachite-500 px-8 font-extrabold text-black hover:scale-105 active:scale-95 transition-transform"
							>
								Compartir
							</button>
						)}
					</div>

					{/* Direct share targets + save */}
					<div className="flex items-center justify-center gap-2.5">
						<a
							href={waHref} target="_blank" rel="noopener noreferrer" aria-label="Compartir en WhatsApp" title="WhatsApp"
							className="flex size-12 items-center justify-center rounded-full bg-[#25D366] text-white hover:scale-110 active:scale-95 transition-transform"
						>
							<svg className="size-6" fill="currentColor" viewBox="0 0 24 24">
								<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
							</svg>
						</a>
						<a
							href={tgHref} target="_blank" rel="noopener noreferrer" aria-label="Compartir en Telegram" title="Telegram"
							className="flex size-12 items-center justify-center rounded-full bg-[#229ED9] text-white hover:scale-110 active:scale-95 transition-transform"
						>
							<svg className="size-6" fill="currentColor" viewBox="0 0 24 24">
								<path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
							</svg>
						</a>
						<a
							href={xHref} target="_blank" rel="noopener noreferrer" aria-label="Compartir en X" title="X"
							className="flex size-12 items-center justify-center rounded-full bg-white text-black hover:scale-110 active:scale-95 transition-transform"
						>
							<svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
								<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
							</svg>
						</a>
						{share && (
							<a
								href={share.url} download="cup-runner.png" aria-label="Descargar imagen" title="Descargar imagen"
								className="flex size-12 items-center justify-center rounded-full liquid-glass text-white hover:scale-110 active:scale-95 transition-transform"
							>
								<svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" />
								</svg>
							</a>
						)}
					</div>

					<Link href="/" className="text-xs text-white/50 hover:text-white transition-colors">← Volver a las tasas</Link>
				 </div>
				</div>
			)}
		</div>
	)
}
