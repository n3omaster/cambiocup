'use client'

import { useEffect, useState } from 'react'

const buildPaths = (data) => {

	if (!data?.length) return null

	const values = data.map((d) => d.value)
	const minVal = Math.min(...values)
	const maxVal = Math.max(...values)
	const range = maxVal - minVal || 1

	const width = 100
	const height = 100
	const padding = 5

	let line = ''
	for (let i = 0; i < data.length; i++) {
		const x = (i / (data.length - 1)) * width
		const y = height - padding - ((data[i].value - minVal) / range) * (height - padding * 2)
		line += `${i === 0 ? 'M' : 'L'} ${x} ${y} `
	}

	return { line: line.trim(), area: `${line.trim()} L ${width} ${height} L 0 ${height} Z` }
}

export default function BackgroundChart({ coin = 'CUP', opacity = 0.2 }) {
	const [paths, setPaths] = useState(null)

	useEffect(() => {
		let cancelled = false

		const fetchData = async () => {
			try {
				const response = await fetch(`/api/history?coin=${coin}&days=7`)
				const { data } = await response.json()
				if (cancelled) return
				const next = buildPaths(data)
				if (next) setPaths(next)
			} catch (error) { console.error('Error fetching chart data:', error) }
		}

		fetchData()
		const interval = setInterval(fetchData, 30000)
		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [coin])

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
			<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: 'block' }}>
				{paths && (
					<>
						<path d={paths.area} fill="white" fillOpacity="0.4" />
						<path d={paths.line} fill="none" stroke="white" strokeWidth="0.3" strokeOpacity="0.8" vectorEffect="non-scaling-stroke" />
					</>
				)}
			</svg>
		</div>
	)
}
