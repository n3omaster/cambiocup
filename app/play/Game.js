'use client'

import Link from 'next/link'
import { encodePayload } from '@/app/utils/gameCodec'
import { DX, STEP, mulberry32, buildCourse, initSim, terrainY as simTerrainY, holeAt as simHoleAt, dayAt, applyResize, applyJump, applyOffers, stepPhysics } from '@/app/utils/gameSim'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// La física vive en app/utils/gameSim.js (paso fijo STEP, compartida con el
// verificador de replays del server); aquí quedan render, audio e inputs.
const BEST_KEY = 'cambiocup:play:best'
const NAME_KEY = 'cambiocup:play:name'

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

	return {
		preload,
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
	const submittedRef = useRef(false) // one submission per death
	const runTokenRef = useRef(null) // signed run token, issued at takeoff (anti-cheat)
	const runTokenPromiseRef = useRef(null) // in-flight token fetch — awaited at submit so fast deaths don't race it
	const revRef = useRef(null) // snapshot id de la historia usada para el course (anti-cheat)
	const traceRef = useRef(null) // traza del run (saltos/ofertas/resizes por paso) — el server la re-simula

	useEffect(() => {
		try {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza estado externo (localStorage) al montar
			setBest(JSON.parse(localStorage.getItem(BEST_KEY)))
			// Only accept a stored name if it's a valid Telegram handle (older saves may predate the @ format)
			const savedName = normalizeTg(localStorage.getItem(NAME_KEY))
			if (savedName) { setPlayerName(savedName); setNameDraft(savedName.slice(1)) }
		} catch { /* first run */ }
		const img = new Image()
		img.src = '/cup.png'
		coinImgRef.current = img
	}, [])

	const fetchBoard = useCallback(async () => {
		try {
			const res = await fetch('/api/game-score')
			if (res.ok) setBoard(await res.json())
		} catch { /* leaderboard is optional decoration */ }
	}, [])

	// eslint-disable-next-line react-hooks/set-state-in-effect -- setBoard ocurre tras un await, no es síncrono
	useEffect(() => { fetchBoard() }, [fetchBoard])

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
			} catch (err) {
				console.error('Error loading game data:', err)
				if (!cancelled) setStatus('error')
			}
		}
		load()
		return () => { cancelled = true }
	}, [])

	// ── Engine ──────────────────────────────────────────────────────────────
	useEffect(() => {
		if (status !== 'playing' || !courseRef.current) return

		const canvas = canvasRef.current
		const ctx = canvas.getContext('2d')
		if (!audioRef.current) audioRef.current = createAudio()
		const audio = audioRef.current
		audio.preload() // fetch + decode the real coin recordings (no-op after the first run)

		// Anti-cheat: a signed run token is issued at takeoff — its age proves the
		// run's real duration when the score is submitted
		runTokenRef.current = null
		runTokenPromiseRef.current = fetch('/api/game-token')
			.then((res) => res.json())
			.then((json) => { runTokenRef.current = json.token || null; return runTokenRef.current })
			.catch(() => null) // run still plays; the score just won't rank
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

		const terrainY = (wx) => simTerrainY(state, course, wx)
		const holeAt = (wx) => simHoleAt(state, wx)

		// Vistas estables sobre el estado de la sim (mutadas en sitio, nunca reasignadas)
		const holes = state.holes
		const liveDollars = state.liveDollars
		const taken = state.taken
		const R = state.r
		const PX = state.px
		const trail = []
		const popups = []
		let raf = 0

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

		// El spawn (posiciones incluidas) lo computa gameSim desde el estado, así el
		// server reproduce lo mismo con solo [paso, id, value] en la traza
		const fetchOffers = async () => {
			try {
				const res = await fetch('/api/offers')
				const json = await res.json()
				if (state.dead || !json.offers?.length) return
				const batch = []
				for (const o of json.offers) {
					if (seenOffers.has(o.id)) continue
					seenOffers.add(o.id)
					batch.push({ id: o.id, value: Number(o.value) || 0 })
				}
				if (!batch.length) return
				for (const o of batch) trace.offers.push([state.steps, o.id, o.value])
				applyOffers(state, course, batch)
			} catch { /* offline tick — retry on next poll */ }
		}
		fetchOffers()
		const offerPoll = setInterval(fetchOffers, 3000)

		const mod = (i) => ((i % n) + n) % n

		let finished = false
		const endRun = (won) => {
			if (finished) return
			finished = true
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

		let lastT = performance.now()
		let acc = 0

		const frame = (now) => {
			const dt = Math.min((now - lastT) / 1000, 0.1) // dt real, solo para el render
			lastT = now

			// ── Update: la física corre en gameSim a paso fijo (reproducible) ──
			acc += dt
			while (acc >= STEP) {
				acc -= STEP
				for (const ev of stepPhysics(state, course)) {
					if (ev.type === 'coin') {
						audio.coin(ev.combo)
						popups.push({ x: PX, y: ev.cy - 20, text: `+${ev.gain} ×${ev.combo}`, t: 0 })
					} else if (ev.type === 'die') { endRun(false); return }
					else if (ev.type === 'win') { endRun(true); return }
				}
			}

			const { worldX, py, elapsed, score, combo, comboTimer } = state
			const pwx = worldX + PX

			trail.push({ y: py })
			if (trail.length > 14) trail.shift()

			// ── Draw ──
			const bg = ctx.createLinearGradient(0, 0, 0, H)
			bg.addColorStop(0, '#0b0c10')
			bg.addColorStop(1, '#0c0d12')
			ctx.fillStyle = bg
			ctx.fillRect(0, 0, W, H)

			ctx.fillStyle = '#ffffff'
			for (const st of stars) {
				const span = W * 1.5
				const sx = ((st.x * span - worldX * 0.06) % span + span) % span - W * 0.25
				ctx.globalAlpha = st.a
				ctx.beginPath()
				ctx.arc(sx, st.y * H, st.r, 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.globalAlpha = 1

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
			for (const c of coins) {
				const sx = c.x - worldX
				if (sx < -30 || sx > W + 30 || taken.has(c.id)) continue
				const cy = terrainY(c.x) - c.dy + Math.sin(elapsed * 3 + c.id) * 4
				ctx.fillStyle = '#ffd75e'
				ctx.shadowColor = '#ffd75e'
				ctx.shadowBlur = 10
				ctx.beginPath()
				ctx.arc(sx, cy, 11, 0, Math.PI * 2)
				ctx.fill()
				ctx.shadowBlur = 0
				ctx.fillStyle = '#7a5b00'
				ctx.font = '800 13px ui-monospace, SFMono-Regular, Menlo, monospace'
				ctx.textAlign = 'center'
				ctx.textBaseline = 'middle'
				ctx.fillText('$', sx, cy + 1)
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

			// Player: trail + real 1-peso coin (public/cup.png) rolling
			for (let i = 0; i < trail.length; i++) {
				ctx.globalAlpha = (i / trail.length) * 0.25
				ctx.fillStyle = '#f0c85a'
				ctx.beginPath()
				ctx.arc(PX - (trail.length - i) * 4.5, trail[i].y, R * (0.4 + (i / trail.length) * 0.5), 0, Math.PI * 2)
				ctx.fill()
			}
			ctx.globalAlpha = 1
			ctx.save()
			ctx.translate(PX, py)
			ctx.rotate((worldX / R) * 0.7) // rueda: ángulo ∝ distancia recorrida
			const img = coinImgRef.current
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

			raf = requestAnimationFrame(frame)
		}

		raf = requestAnimationFrame(frame)

		return () => {
			cancelAnimationFrame(raf)
			clearInterval(offerPoll)
			window.removeEventListener('resize', resize)
			window.removeEventListener('keydown', onKey)
			canvas.removeEventListener('pointerdown', onPointer)
		}
	}, [status])

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
				submittedRef.current = false
			}
		} catch { submittedRef.current = false }
	}, [death, fetchBoard])

	// Known player: submit automatically the moment the death screen appears
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- setRank/setBoard ocurren tras un await, no es síncrono
		if (status === 'dead' && death && playerName) submitScore(playerName)
	}, [status, death, playerName, submitScore])

	const restart = useCallback(() => {
		if (share) URL.revokeObjectURL(share.url)
		setShare(null)
		setDeath(null)
		setRank(null)
		submittedRef.current = false
		setStatus('playing')
	}, [share])

	const waHref = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`
	const tgHref = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`
	const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`

	return (
		<div className="fixed inset-0 h-dvh w-full overflow-hidden bg-[#0b0c10] text-white select-none touch-none">
			<canvas ref={canvasRef} className="absolute inset-0 size-full" />

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
				<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-black/40 p-6 text-center">
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
					<p className="max-w-md text-xs sm:text-sm text-white/50">
						💸 Las ofertas <strong className="text-white/80">reales</strong> del mercado P2P entran
						al juego <span className="text-malachite-500 font-bold">EN VIVO</span>: si pagan por encima de la
						tasa te cae un <strong className="text-white/80">dólar del cielo</strong> 💵; si pagan por debajo,
						se abre un <strong className="text-white/80">cráter de doble salto</strong>.
					</p>
					{best && (
						<p className="rounded-full liquid-glass liquid-glass--dark px-4 py-1.5 text-xs sm:text-sm text-white/80 tabular-nums">
							🏆 Tu récord: {best.score.toLocaleString('es')} CUP — día {best.day}
						</p>
					)}
					{board?.top?.length > 0 && (
						<div className="w-full max-w-xs rounded-2xl liquid-glass liquid-glass--dark px-5 py-4 text-left">
							<p className="mb-2 flex justify-between text-[11px] font-bold tracking-[0.2em] text-white/50">
								<span>🌍 TOP 10 MUNDIAL</span>
								<span className="tabular-nums">{board.runs.toLocaleString('es')} partidas</span>
							</p>
							{board.top.slice(0, 10).map((row, i) => (
								<div key={`${row.name}-${i}`} className="flex items-center justify-between gap-3 py-0.5 text-sm">
									<span className={`truncate font-medium ${row.name === playerName ? 'text-malachite-500' : 'text-white/80'}`}>
										{['🥇', '🥈', '🥉'][i] || `${i + 1}.`} {row.name}
									</span>
									<span className="shrink-0 tabular-nums font-bold text-[#ffd75e]">{row.score.toLocaleString('es')}</span>
								</div>
							))}
							<Link href="/play/top-scores" className="mt-2 block text-center text-[11px] font-bold tracking-wide text-white/45 transition-colors hover:text-white/80">
								Top 10 →
							</Link>
						</div>
					)}
					<button
						type="button"
						onClick={() => setStatus('playing')}
						className="rounded-full bg-malachite-500 px-10 py-3.5 text-lg font-extrabold text-black shadow-[0_0_40px_rgba(83,221,108,0.45)] hover:scale-105 active:scale-95 transition-transform"
					>
						▶ JUGAR
					</button>
					<Link href="/" className="text-xs text-white/50 hover:text-white transition-colors">← Volver a las tasas</Link>
				</div>
			)}

			{status === 'dead' && death && (
				<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-black/60 p-6 text-center backdrop-blur-sm">

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
								className="w-[min(70vw,360px)] rounded-2xl ring-4 ring-white/90 shadow-[0_25px_80px_rgba(0,0,0,0.65)]"
							/>
						</div>
					) : (
						<div className="flex size-[min(70vw,360px)] items-center justify-center rounded-2xl liquid-glass liquid-glass--dark">
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
			)}
		</div>
	)
}
