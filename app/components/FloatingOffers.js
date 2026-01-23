'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export default function FloatingOffers() {
	const [offers, setOffers] = useState([])
	const seenIds = useRef(new Set())

	const addOffer = useCallback((offer) => {
		// Skip if we've already seen this offer
		if (seenIds.current.has(offer.id)) return
		seenIds.current.add(offer.id)

		const id = `${offer.id}-${Math.random()}`
		const leftPosition = Math.random() * 80 + 10 // 10% to 90%
		const duration = Math.random() * 5 + 8 // 8 to 13 seconds
		const delay = Math.random() * 0.5 // 0 to 0.5 seconds delay

		const newOffer = {
			...offer,
			uniqueId: id,
			leftPosition,
			duration,
			delay,
		}

		setOffers((prev) => [...prev, newOffer])

		// Remove offer after animation completes
		setTimeout(() => {
			setOffers((prev) => prev.filter((o) => o.uniqueId !== id))
		}, (duration + delay) * 1000 + 500)
	}, [])

	useEffect(() => {
		const fetchOffers = async () => {
			try {
				const response = await fetch('/api/offers')
				const data = await response.json()

				if (data.offers && data.offers.length > 0) {
					data.offers.forEach((offer) => {
						addOffer(offer)
					})
				}
			} catch (error) {
				console.error('Error fetching offers:', error)
			}
		}

		// Initial fetch
		fetchOffers()

		// Poll every 3 seconds
		const interval = setInterval(fetchOffers, 3000)

		return () => clearInterval(interval)
	}, [addOffer])

	// Clean up old seen IDs periodically
	useEffect(() => {
		const cleanup = setInterval(() => {
			if (seenIds.current.size > 100) {
				seenIds.current.clear()
			}
		}, 60000)

		return () => clearInterval(cleanup)
	}, [])

	return (
		<div className="fixed inset-0 pointer-events-none overflow-hidden z-30">
			{offers.map((offer) => (
				<FloatingOffer key={offer.uniqueId} offer={offer} />
			))}
		</div>
	)
}

function FloatingOffer({ offer }) {
	const isBuy = offer.type === 'buy'
	const isCompleted = offer.status === 'completed'

	// 4 distinct styles based on type and status
	const getStyles = () => {
		if (isBuy && isCompleted) {
			// Buy completed - solid green
			return {
				bg: 'bg-emerald-500/95',
				border: 'border-emerald-300 border-2',
				shadow: 'shadow-lg shadow-emerald-500/30',
			}
		} else if (isBuy && !isCompleted) {
			// Buy attempt - lighter green, dashed border
			return {
				bg: 'bg-emerald-400/70',
				border: 'border-emerald-200 border-2 border-dashed',
				shadow: 'shadow-md',
			}
		} else if (!isBuy && isCompleted) {
			// Sell completed - solid red
			return {
				bg: 'bg-red-500/95',
				border: 'border-red-300 border-2',
				shadow: 'shadow-lg shadow-red-500/30',
			}
		} else {
			// Sell attempt - lighter red, dashed border
			return {
				bg: 'bg-red-400/70',
				border: 'border-red-200 border-2 border-dashed',
				shadow: 'shadow-md',
			}
		}
	}

	const styles = getStyles()

	const formatValue = (value) => {
		if (typeof value !== 'number') return value
		return value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		})
	}

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
			{/* Arrow icon - up for buy, down for sell */}
			<svg
				className={`w-4 h-4 ${isBuy ? 'rotate-180' : ''}`}
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={2.5}
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M19 14l-7 7m0 0l-7-7m7 7V3"
				/>
			</svg>

			{/* Value and coin */}
			<span className="font-bold">${formatValue(offer.value)}</span>
			<span className="text-xs opacity-80">{offer.coin}</span>

			{/* Status indicator */}
			{isCompleted ? (
				// Checkmark for completed
				<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
					<path
						fillRule="evenodd"
						d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
						clipRule="evenodd"
					/>
				</svg>
			) : (
				// Clock/pending icon for attempts
				<svg className="w-4 h-4 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
			)}
		</div>
	)
}
