'use client'

import { useEffect, useState } from 'react'
import { Liveline } from 'liveline'

const DAYS = 15
const WINDOW_SECS = DAYS * 24 * 60 * 60

export default function BackgroundLiveLine({ coin = 'CUP', value = 0, opacity = 0.22 }) {
	const [data, setData] = useState([])

	useEffect(() => {
		let cancelled = false
		const fetchData = async () => {
			try {
				const response = await fetch(`/api/history?coin=${coin}&days=${DAYS}`)
				const { data: points } = await response.json()
				if (!cancelled && Array.isArray(points)) setData(points)
			} catch (error) { console.error('Error fetching chart data:', error) }
		}
		fetchData()
		const interval = setInterval(fetchData, 30000)
		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [coin])

	const lastValue = data[data.length - 1]?.value ?? 0
	const liveValue = value > 0 ? value : lastValue

	// Size the visible window to the actual span of the data so the line always fills
	// the full screen width, even when the DB holds fewer than DAYS of history. As more
	// history accumulates the span grows on its own (capped by the DAYS query above).
	const dataSpan = data.length > 1 ? data[data.length - 1].time - data[0].time : 0
	const windowSecs = dataSpan > 0 ? Math.max(dataSpan, 3600) : WINDOW_SECS

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 0,
				pointerEvents: 'none',
				opacity,
			}}
		>
			<Liveline
				data={data}
				value={liveValue}
				color="#ffffff"
				theme="dark"
				window={windowSecs}
				lineWidth={1.5}
				grid={false}
				badge={false}
				pulse={false}
				scrub={false}
				fill
				momentum={false}
				exaggerate
				loading={data.length === 0}
				padding={{ top: 80, right: 0, bottom: 80, left: 0 }}
				style={{ width: '100%', height: '100%' }}
			/>
		</div>
	)
}
