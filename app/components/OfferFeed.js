'use client'

import { memo, useState, useEffect } from 'react'

const POLL_MS = 3000
const FETCH_TIMEOUT_MS = 10000
const MAX_VISIBLE = 4 // en móvil y en modo stream la cuarta queda invisible (globals.css)
const LIFE_MS = 6000
const EXIT_MS = 350 // lo que dura el fundido de salida en globals.css (.offer-pill)
const DRIP_MS = 450
const DRIP_FAST_MS = 250
const QUEUE_FAST = 6
const QUEUE_MAX = 12
const FIRST_LOAD = 3
// Una oferta a más de esta distancia de la tasa es un dato raro, no una señal del mercado
const MAX_DELTA_PCT = 50

const LABELS = {
	'buy-completed': 'Compra cerrada',
	'buy-attempt': 'Oferta de compra',
	'sell-completed': 'Venta cerrada',
	'sell-attempt': 'Oferta de venta',
}

// Disco blanco con la flecha de color: verde y rojo también son colores de fondo de la página,
// y un avatar relleno de color se perdía sobre el fondo del mismo tono
const AVATARS = {
	'buy-completed': 'bg-white text-emerald-500',
	'buy-attempt': 'border-2 border-white/45 text-emerald-300',
	'sell-completed': 'bg-white text-red-500',
	'sell-attempt': 'border-2 border-white/45 text-red-300',
}

const formatValue = (value) => {
	if (typeof value !== 'number') return value
	return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Diferencia de la oferta contra la tasa actual de su moneda, o null si no hay nada que decir
const deltaPct = (value, rate) => {
	if (typeof value !== 'number' || !(rate > 0)) return null
	const pct = ((value - rate) / rate) * 100
	if (Math.abs(pct) >= MAX_DELTA_PCT || Math.abs(pct) < 0.05) return null
	return pct
}

// Feed de ofertas P2P en vivo, apilado abajo a la izquierda: la nueva entra por abajo, empuja a las
// anteriores y las viejas se apagan. Las líneas tienen altura fija y la pila solo se mueve con
// transform y opacity, que no cuestan layout ni repintado.
// `rates` es la tasa real por moneda ({ CUP: 1017.2, ... }). `fx="low"` quita el vidrio y el brillo.
// `stream` lo sube por encima de los comentarios del directo. Sin `onPickCoin` las líneas no se tocan.
export default memo(function OfferFeed({ rates, fx = 'full', stream = false, onPickCoin }) {

	const [items, setItems] = useState([])

	useEffect(() => {
		const seen = new Set()
		const live = [] // uids visibles, de la más vieja a la más nueva
		const timers = new Set()
		let queue = []
		let firstLoad = true
		let pumping = false
		let cancelled = false
		let seq = 0

		const later = (fn, ms) => {
			const id = setTimeout(() => { timers.delete(id); fn() }, ms)
			timers.add(id)
		}

		// Salida en dos pasos: primero se anima, luego se quita
		const dismiss = (uid) => {
			const index = live.indexOf(uid)
			if (index === -1) return
			live.splice(index, 1)
			setItems((prev) => prev.map((item) => (item.uid === uid ? { ...item, leaving: true } : item)))
			later(() => setItems((prev) => prev.filter((item) => item.uid !== uid)), EXIT_MS)
		}

		// Publica de una en una, para que una tanda se lea como un chat y no como un bloque
		const pump = () => {
			if (cancelled || document.hidden || !queue.length) { pumping = false; return }
			pumping = true

			const offer = queue.shift()
			const uid = `${offer.id}-${seq++}`
			live.push(uid)
			if (live.length > MAX_VISIBLE) dismiss(live[0])
			setItems((prev) => [...prev, { uid, offer, leaving: false }])

			later(() => dismiss(uid), LIFE_MS)
			later(pump, queue.length > QUEUE_FAST ? DRIP_FAST_MS : DRIP_MS)
		}

		// `offers` llega de la más nueva a la más vieja
		const enqueue = (offers) => {
			let fresh = offers.filter((offer) => !seen.has(offer.id))

			// Lo que ya no viene en la respuesta (últimos 2 min) no vuelve, así que no hace falta recordarlo
			if (offers.length) {
				seen.clear()
				for (const offer of offers) seen.add(offer.id)
			}

			// Al abrir la página no se repasa todo lo de los últimos 2 minutos
			if (firstLoad) { fresh = fresh.slice(0, FIRST_LOAD); firstLoad = false }
			if (!fresh.length) return

			queue.push(...fresh.reverse())
			const cap = document.hidden ? FIRST_LOAD : QUEUE_MAX
			if (queue.length > cap) queue = queue.slice(-cap)
			if (!pumping) pump()
		}

		// La página se transmite días seguidos: una consulta colgada no puede apilar otras detrás,
		// y con la pestaña oculta no se pide lo que no se va a publicar
		let busy = false
		const poll = async () => {
			if (busy || document.hidden) return
			busy = true
			try {
				const response = await fetch('/api/offers', { signal: AbortSignal.timeout?.(FETCH_TIMEOUT_MS) })
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const data = await response.json()
				if (cancelled || !Array.isArray(data.offers)) return
				enqueue(data.offers)
			} catch (error) { console.error('Error fetching offers:', error) } finally { busy = false }
		}

		// Con la pestaña oculta ni se consulta ni se publica; al volver se pide lo último
		const onVisible = () => {
			if (document.hidden) return
			// Como al abrir: solo lo más nuevo, sin repasar lo que pasó mientras no se miraba
			firstLoad = true
			poll()
			if (!pumping) pump()
		}

		poll()
		const interval = setInterval(poll, POLL_MS)
		document.addEventListener('visibilitychange', onVisible)

		return () => {
			cancelled = true
			clearInterval(interval)
			document.removeEventListener('visibilitychange', onVisible)
			timers.forEach(clearTimeout)
			timers.clear()
		}
	}, [])

	const liveUids = items.filter((item) => !item.leaving).map((item) => item.uid)

	return (
		<div
			role="log"
			aria-live="off"
			aria-label="Ofertas P2P en vivo"
			className="offer-feed"
			data-fx={fx}
			data-stream={stream ? 'true' : undefined}
		>
			{items.map((item) => (
				<OfferRow
					key={item.uid}
					offer={item.offer}
					leaving={item.leaving}
					// 0 es la más nueva; las de arriba se van apagando
					rank={item.leaving ? null : liveUids.length - 1 - liveUids.indexOf(item.uid)}
					liveCount={liveUids.length}
					rate={rates?.[item.offer.coin]}
					flat={fx === 'low'}
					onPickCoin={onPickCoin}
				/>
			))}
		</div>
	)
})

const OfferRow = memo(function OfferRow({ offer, leaving, rank, liveCount, rate, flat, onPickCoin }) {
	const isBuy = offer.type === 'buy'
	const isCompleted = offer.status === 'completed'
	const kind = `${isBuy ? 'buy' : 'sell'}-${isCompleted ? 'completed' : 'attempt'}`
	const delta = deltaPct(offer.value, rate)
	const Pill = onPickCoin ? 'button' : 'div'
	const surface = flat ? 'offer-pill--flat' : `liquid-glass liquid-glass--dark ${isCompleted ? 'offer-pill--shine' : ''}`

	return (
		// La que sale se queda en el hueco de arriba de la pila mientras se funde
		<div className="offer-row" data-leaving={leaving ? '' : undefined} data-rank={rank ?? undefined} style={{ '--slot': rank ?? liveCount }}>
			<Pill
				{...(onPickCoin && { type: 'button', tabIndex: -1, title: `Ver ${offer.coin}`, onClick: () => onPickCoin(offer.coin) })}
				className={`offer-pill ${surface} ${onPickCoin ? 'pointer-events-auto cursor-pointer' : ''} flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-left text-sm text-white`}
			>
				<span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${AVATARS[kind]}`}>
					<svg className={`size-3.5 ${isBuy ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
						<path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
					</svg>
				</span>

				<span className="min-w-0 truncate">
					<span className={`font-medium ${isCompleted ? '' : 'opacity-80'}`}>{LABELS[kind]}</span>
					{' '}
					<span className="font-extrabold tabular-nums">${formatValue(offer.value)}</span>
					{' '}
					<span className="text-xs opacity-70">{offer.coin}</span>
				</span>

				{delta !== null && (
					<span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums" title="Frente a la tasa actual">
						{delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
					</span>
				)}
			</Pill>
		</div>
	)
})
