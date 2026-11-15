'use client'

import { useEffect, useState } from 'react'
import { Liveline } from 'liveline'

const DAYS = 15
const WINDOW_SECS = DAYS * 24 * 60 * 60

// fx=low: la línea se redibuja entera en cada frame y su coste va con el número de puntos.
// ~1000 puntos en 540 px de ancho son dos por píxel: con estos se ve igual
const LOW_POINTS = 300

const hideTime = () => ''

// Uno de cada N, conservando siempre el último (es el que engancha con el valor en vivo)
const thin = (points, max) => {
	if (points.length <= max) return points
	const step = Math.ceil(points.length / max)
	const last = points.length - 1
	return points.filter((_, i) => i % step === 0 || i === last)
}

// `low` (fx=low): sin el halo. Es un filtro sobre un canvas a pantalla completa que se redibuja
// en cada frame, y sin GPU se recalcula entero cada vez.
export default function BackgroundLiveLine({ coin = 'CUP', value = 0, opacity = 0.22, low = false }) {
	const [data, setData] = useState([])

	useEffect(() => {
		let cancelled = false
		const fetchData = async () => {
			try {
				const response = await fetch(`/api/history?coin=${coin}&days=${DAYS}`)
				if (!response.ok) throw new Error(`HTTP ${response.status}`)
				const { data: points } = await response.json()
				if (!cancelled && Array.isArray(points)) setData(low ? thin(points, LOW_POINTS) : points)
			} catch (error) { console.error('Error fetching chart data:', error) }
		}
		fetchData()
		const interval = setInterval(fetchData, 30000)
		return () => {
			cancelled = true
			clearInterval(interval)
		}
	}, [coin, low])

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
				// fx=low: el canvas se pinta a media resolución y se estira al doble. Sin GPU su
				// dibujo corre en el hilo principal y va con el número de píxeles: son 4 veces menos
				...(low && { right: 'auto', bottom: 'auto', width: '50%', height: '50%', transform: 'scale(2)', transformOrigin: '0 0' }),
				zIndex: 0,
				pointerEvents: 'none',
				opacity,
				// soft halo so the line reads over any bg color without raising opacity too much
				filter: low ? undefined : 'drop-shadow(0 0 14px rgba(255, 255, 255, 0.45))',
			}}
		>
			<Liveline
				data={data}
				value={liveValue}
				color="#ffffff"
				theme="dark"
				window={windowSecs}
				lineWidth={low ? 1 : 2}
				// Al doble de tamaño las etiquetas del eje de tiempo dejan de pasar desapercibidas
				formatTime={low ? hideTime : undefined}
				grid={false}
				badge={false}
				pulse
				scrub={false}
				fill
				momentum={false}
				exaggerate
				loading={data.length === 0}
				padding={{ top: low ? 40 : 80, right: 0, bottom: low ? 40 : 80, left: 0 }}
				style={{ width: '100%', height: '100%' }}
			/>
		</div>
	)
}
