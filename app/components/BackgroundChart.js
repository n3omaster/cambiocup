'use client'

import { useEffect, useState } from 'react'

export default function BackgroundChart({ coin = 'CUP', opacity = 0.2 }) {
	const [pathData, setPathData] = useState('')
	const [areaData, setAreaData] = useState('')

	useEffect(() => {
		const fetchData = async () => {
			try {
				const response = await fetch(`/api/history?coin=${coin}&days=7`)
				const { data } = await response.json()

				if (data && data.length > 0) {
					const values = data.map(d => d.value)
					const minVal = Math.min(...values)
					const maxVal = Math.max(...values)
					const range = maxVal - minVal || 1

					const width = 100
					const height = 100
					const padding = 5

					const points = data.map((d, i) => {
						const x = (i / (data.length - 1)) * width
						const y = height - padding - ((d.value - minVal) / range) * (height - padding * 2)
						return { x, y }
					})

					const linePath = points
						.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
						.join(' ')

					const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

					setPathData(linePath)
					setAreaData(areaPath)
				}
			} catch (error) {
				console.error('Error fetching chart data:', error)
			}
		}

		fetchData()
		const interval = setInterval(fetchData, 30000)
		return () => clearInterval(interval)
	}, [coin])

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 0,
				pointerEvents: 'none',
				opacity: opacity,
			}}
		>
			<svg
				width="100%"
				height="100%"
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				style={{ display: 'block' }}
			>
				{/* Area fill */}
				{areaData && (
					<path
						d={areaData}
						fill="white"
						fillOpacity="0.4"
					/>
				)}
				{/* Line */}
				{pathData && (
					<path
						d={pathData}
						fill="none"
						stroke="white"
						strokeWidth="0.3"
						strokeOpacity="0.8"
						vectorEffect="non-scaling-stroke"
					/>
				)}
			</svg>
		</div>
	)
}
