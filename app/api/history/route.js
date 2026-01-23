import { NextResponse } from 'next/server'
import { getHistoricalData } from '@/lib/supabase'

export async function GET(request) {

	const { searchParams } = new URL(request.url)
	const coin = searchParams.get('coin') || 'CUP'
	const days = parseInt(searchParams.get('days') || '7', 10)

	const { data, error } = await getHistoricalData(coin, days)

	if (error) {
		console.error('Error fetching historical data:', error)
		return NextResponse.json({ data: [] })
	}

	// Transform data for chart format (timestamp, value)
	const chartData = (data || []).map((item) => ({
		time: Math.floor(new Date(item.updated_at).getTime() / 1000),
		value: item.value,
	}))

	return NextResponse.json({ data: chartData, coin: coin.toUpperCase() })
}
