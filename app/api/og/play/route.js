import { ImageResponse } from 'next/og'
import { getHistoricalData } from '@/lib/supabase'

const W = 1200
const H = 630

// Star field (deterministic — this card is cached, no need for variety)
const STARS = [
	[80, 60, 3], [220, 140, 2], [370, 50, 2], [520, 110, 3], [660, 40, 2],
	[790, 150, 2], [930, 70, 3], [1060, 130, 2], [1140, 40, 2], [160, 230, 2],
	[450, 200, 2], [720, 240, 2], [1000, 210, 3], [300, 300, 2], [860, 320, 2],
]

// OG card for /play: real CUP terrain from the last 60 days, the 1915 peso,
// a red spike, and today's rate. Cached at the edge for an hour.
export async function GET(request) {

	try {

		const { data } = await getHistoricalData('CUP', 60)
		if (!data || data.length < 10) throw new Error('No data for OG terrain')

		// Sample the series down to ~48 points and map into the card's bottom band
		const SAMPLES = 48
		const values = Array.from({ length: SAMPLES }, (_, i) => data[Math.floor((i / (SAMPLES - 1)) * (data.length - 1))].value)
		const min = Math.min(...values)
		const max = Math.max(...values)
		const span = max - min || 1
		const coords = values.map((v, i) => [
			Math.round((i / (SAMPLES - 1)) * (W + 40)) - 20,
			Math.round(560 - ((v - min) / span) * 170),
		])
		const lineAttr = coords.map(([x, y]) => `${x},${y}`).join(' ')
		const areaAttr = `-20,${H} ${lineAttr} ${W + 20},${H}`

		const yAt = (x) => {
			const nearest = coords.reduce((best, c) => (Math.abs(c[0] - x) < Math.abs(best[0] - x) ? c : best))
			return nearest[1]
		}
		const coinX = 380
		const coinY = yAt(coinX)
		const spikeX = 890
		const spikeY = yAt(spikeX)

		const current = data[data.length - 1].value

		// Real Barlow for the headline; fall back to default sans if the CDN hiccups
		let fonts
		try {
			const barlow = await fetch('https://cdn.jsdelivr.net/npm/@fontsource/barlow@5.0.13/files/barlow-latin-800-normal.woff')
				.then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('font fetch failed'))))
			fonts = [{ name: 'Barlow', data: barlow, weight: 800, style: 'normal' }]
		} catch { fonts = undefined }

		// The player coin (public/cup.png) inlined as data URI
		let coinSrc = null
		try {
			const coinBuf = await fetch(new URL('/cup.png', request.url)).then((res) => res.arrayBuffer())
			coinSrc = `data:image/png;base64,${Buffer.from(coinBuf).toString('base64')}`
		} catch { /* card works without the coin */ }

		return new ImageResponse(
			(
				<div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#0b0c10', position: 'relative', fontFamily: fonts ? 'Barlow' : 'sans-serif' }}>

					{/* Stars */}
					{STARS.map(([x, y, r], i) => (
						<div key={i} style={{ display: 'flex', position: 'absolute', left: x, top: y, width: r, height: r, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.45)' }} />
					))}

					{/* Real CUP terrain + spike */}
					<svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', top: 0, left: 0 }}>
						<polygon points={areaAttr} fill="rgba(30, 153, 53, 0.18)" />
						<polyline points={lineAttr} fill="none" stroke="rgba(83, 221, 108, 0.35)" strokeWidth="12" />
						<polyline points={lineAttr} fill="none" stroke="#53dd6c" strokeWidth="4" />
						<polygon points={`${spikeX - 34},${spikeY} ${spikeX},${spikeY - 130} ${spikeX + 34},${spikeY}`} fill="#d7263d" />
						<polygon points={`${spikeX - 34},${spikeY} ${spikeX},${spikeY - 130} ${spikeX + 34},${spikeY}`} fill="none" stroke="rgba(215, 38, 61, 0.4)" strokeWidth="10" />
					</svg>

					{/* Player coin riding the line (Satori JSX — next/image does not apply here) */}
					{coinSrc && (
						// eslint-disable-next-line @next/next/no-img-element
						<img
							src={coinSrc}
							alt=""
							width={96}
							height={96}
							style={{ position: 'absolute', left: coinX - 48, top: coinY - 92, transform: 'rotate(14deg)' }}
						/>
					)}

					{/* Copy block */}
					<div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', top: 72, left: 70 }}>
						<div style={{ display: 'flex', fontSize: 30, letterSpacing: 10, color: '#53dd6c', marginBottom: 6 }}>
							CAMBIOCUP PRESENTA
						</div>
						<div style={{ display: 'flex', fontSize: 128, fontWeight: 800, lineHeight: 1 }}>
							<span style={{ color: '#ffffff' }}>CUP</span>
							<span style={{ color: '#53dd6c', marginLeft: 28 }}>RUNNER</span>
						</div>
						<div style={{ display: 'flex', fontSize: 36, color: 'rgba(255,255,255,0.75)', marginTop: 18 }}>
							Surfea la historia real del dólar en Cuba
						</div>
						<div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 30 }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 12, backgroundColor: 'rgba(83, 221, 108, 0.15)', border: '2px solid #53dd6c', borderRadius: 99, padding: '10px 26px', fontSize: 32, color: '#53dd6c' }}>
								<svg width="20" height="18" viewBox="0 0 20 18">
									<polygon points="10,0 20,18 0,18" fill="#53dd6c" />
								</svg>
								${current.toFixed(2)} hoy
							</div>
							<div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.25)', borderRadius: 99, padding: '10px 26px', fontSize: 32, color: 'rgba(255,255,255,0.85)' }}>
								💀 ¿Cuántos días sobrevives?
							</div>
						</div>
					</div>

					{/* CTA */}
					<div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'absolute', right: 70, bottom: 44, fontSize: 30, color: 'rgba(255,255,255,0.7)' }}>
						<svg width="18" height="22" viewBox="0 0 18 22">
							<polygon points="0,0 18,11 0,22" fill="#53dd6c" />
						</svg>
						juega en&nbsp;<span style={{ color: '#53dd6c' }}>cambiocup.com/play</span>
					</div>
				</div>
			),
			{
				width: W,
				height: H,
				fonts,
				headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
			},
		)
	} catch (error) {

		console.error('OG /play image error:', error)

		return new ImageResponse(
			(
				<div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#0b0c10', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', fontFamily: 'sans-serif' }}>
					<div style={{ display: 'flex', fontSize: 110, fontWeight: 800 }}>
						<span style={{ color: '#ffffff' }}>CUP</span>
						<span style={{ color: '#53dd6c', marginLeft: 24 }}>RUNNER</span>
					</div>
					<div style={{ display: 'flex', fontSize: 36, color: 'rgba(255,255,255,0.75)', marginTop: 20 }}>
						Surfea la historia real del dólar en Cuba
					</div>
				</div>
			),
			{ width: W, height: H },
		)
	}
}
