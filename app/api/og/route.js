import { ImageResponse } from 'next/og'
import { getCoinData } from '@/lib/supabase'

// Disable caching for real-time data
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Coin configuration
const COINS = {
	CUP: { name: 'CUP', decimals: 2, coinId: 'cupHistory' },
	MLC: { name: 'MLC', decimals: 3, coinId: 'mlcHistory' },
	CLASICA: { name: 'CLASICA', decimals: 3, coinId: 'clasicaHistory' },
	ETECSA: { name: 'ETECSA', decimals: 2, coinId: 'etecsaHistory' },
	TROPICAL: { name: 'TROPICAL', decimals: 2, coinId: 'bandecprepagoHistory' },
}

// Colors
const COLORS = {
	green: '#53dd6c',
	red: '#d7263d',
}

export async function GET(request) {

	try {

		// Get coin from query parameter, default to CUP
		const { searchParams } = new URL(request.url)
		const coinParam = (searchParams.get('coin') || 'CUP').toUpperCase()
		const coinConfig = COINS[coinParam] || COINS.CUP

		// Fetch data directly from database
		const data = await getCoinData()
		const history = data[coinConfig.coinId]

		if (!history || history.length === 0) {
			throw new Error('No data available')
		}

		// Get current value and calculate average
		const currentValue = history[0].value
		const average = history.reduce((sum, item) => sum + item.value, 0) / history.length

		// Determine color based on trend
		const bgColor = currentValue < average ? COLORS.green : COLORS.red
		const trendText = currentValue < average ? '↓' : '↑'

		// Format value
		const formattedValue = currentValue.toFixed(coinConfig.decimals)

		// Get timestamp for freshness indicator
		const updatedAt = new Date(history[0].updated_at)
		const timeAgo = getTimeAgo(updatedAt)

		return new ImageResponse(
			(
				<div
					style={{
						display: 'flex',
						height: '100%',
						width: '100%',
						alignItems: 'center',
						justifyContent: 'center',
						flexDirection: 'column',
						backgroundColor: bgColor,
						fontFamily: 'sans-serif',
					}}
				>
					<div style={{ display: 'flex', color: 'white', fontSize: 48, opacity: 0.9, marginBottom: 10 }}>
						Tasa de cambio {coinConfig.name}
					</div>
					<div style={{ display: 'flex', color: 'white', alignItems: 'center', gap: 20 }}>
						<div style={{ display: 'flex', fontSize: 180, fontWeight: 900 }}>
							${formattedValue}
						</div>
						<div style={{ display: 'flex', fontSize: 80, opacity: 0.8 }}>
							{trendText}
						</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 30, marginTop: 20, color: 'white', opacity: 0.7, fontSize: 28 }}>
						<div style={{ display: 'flex' }}>cambiocup.com</div>
						<div style={{ display: 'flex' }}>•</div>
						<div style={{ display: 'flex' }}>Actualizado {timeAgo}</div>
					</div>
				</div>
			),
			{
				width: 1200,
				height: 630,
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0',
				},
			}
		)
	} catch (error) {

		console.error('OG Image error:', error)

		// Fallback image on error
		return new ImageResponse(
			(
				<div
					style={{
						display: 'flex',
						height: '100%',
						width: '100%',
						alignItems: 'center',
						justifyContent: 'center',
						flexDirection: 'column',
						backgroundColor: '#3a405a',
						fontFamily: 'sans-serif',
					}}
				>
					<div style={{ display: 'flex', color: 'white', fontSize: 60, fontWeight: 700 }}>
						CambioCUP
					</div>
					<div style={{ display: 'flex', color: 'white', fontSize: 32, opacity: 0.8, marginTop: 20 }}>
						Tasas de cambio en Cuba en tiempo real
					</div>
				</div>
			),
			{ width: 1200, height: 630 }
		)
	}
}

function getTimeAgo(date) {
	const seconds = Math.floor((new Date() - date) / 1000)
	if (seconds < 60) return 'hace segundos'
	if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`
	if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`
	return `hace ${Math.floor(seconds / 86400)}d`
}
