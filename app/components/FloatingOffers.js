'use client'

import { memo, useState, useEffect, useCallback, useRef } from 'react'

const STYLES = {
	'buy-completed': { bg: 'bg-emerald-500/95', border: 'border-emerald-300 border-2', shadow: 'shadow-lg shadow-emerald-500/30' },
	'buy-attempt': { bg: 'bg-emerald-400/70', border: 'border-emerald-200 border-2 border-dashed', shadow: 'shadow-md' },
	'sell-completed': { bg: 'bg-red-500/95', border: 'border-red-300 border-2', shadow: 'shadow-lg shadow-red-500/30' },
	'sell-attempt': { bg: 'bg-red-400/70', border: 'border-red-200 border-2 border-dashed', shadow: 'shadow-md' },
}

const formatValue = (value) => {
	if (typeof value !== 'number') return value
	return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function FloatingOffers() {

	const [offers, setOffers] = useState([])
	const seenIds = useRef(null)
	if (seenIds.current === null) seenIds.current = new Set()
	const timeoutsRef = useRef(null)
	if (timeoutsRef.current === null) timeoutsRef.current = new Set()

	const addOffer = useCallback((offer) => {
		if (seenIds.current.has(offer.id)) return
		seenIds.current.add(offer.id)

		const uniqueId = `${offer.id}-${Math.random()}`
		const leftPosition = Math.random() * 80 + 10
		const duration = Math.random() * 5 + 8
		const delay = Math.random() * 0.5

		const newOffer = { ...offer, uniqueId, leftPosition, duration, delay }
		setOffers((prev) => [...prev, newOffer])

		const timeoutId = setTimeout(() => {
			setOffers((prev) => prev.filter((o) => o.uniqueId !== uniqueId))
			timeoutsRef.current.delete(timeoutId)
		}, (duration + delay) * 1000 + 500)
		timeoutsRef.current.add(timeoutId)
	}, [])

	useEffect(() => {
		const timeouts = timeoutsRef.current
		let cancelled = false

		const fetchOffers = async () => {
			try {
				const response = await fetch('/api/offers')
				const data = await response.json()
				if (cancelled || !data.offers?.length) return
				data.offers.forEach(addOffer)
			} catch (error) { console.error('Error fetching offers:', error) }
		}

		fetchOffers()
		const interval = setInterval(fetchOffers, 3000)
		const cleanup = setInterval(() => {
			if (seenIds.current.size > 100) seenIds.current.clear()
		}, 60000)

		return () => {
			cancelled = true
			clearInterval(interval)
			clearInterval(cleanup)
			timeouts.forEach(clearTimeout)
			timeouts.clear()
		}
	}, [addOffer])

	return (
		<div className="fixed inset-0 pointer-events-none overflow-hidden z-30">
			{offers.map((offer) => (
				<FloatingOffer key={offer.uniqueId} offer={offer} />
			))}
		</div>
	)
}

const FloatingOffer = memo(function FloatingOffer({ offer }) {
	const isBuy = offer.type === 'buy'
	const isCompleted = offer.status === 'completed'
	const styles = STYLES[`${isBuy ? 'buy' : 'sell'}-${isCompleted ? 'completed' : 'attempt'}`]

	return (
		<div
			className={`absolute bottom-0 ${styles.bg} ${styles.border} ${styles.shadow} backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 text-white text-sm font-medium animate-float-up`}
			style={{
				left: `${offer.leftPosition}%`,
				transform: 'translateX(-50%)',
				animationDuration: `${offer.duration}s`,
				animationDelay: `${offer.delay}s`,
			}}
		>
			<svg className={`w-4 h-4 ${isBuy ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
			</svg>

			<span className="font-bold">${formatValue(offer.value)}</span>
			<span className="text-xs opacity-80">{offer.coin}</span>

			{isCompleted ? (
				<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
				</svg>
			) : (
				<svg className="w-4 h-4 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
			)}
		</div>
	)
})
