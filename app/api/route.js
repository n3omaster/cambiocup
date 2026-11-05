import { NextResponse } from 'next/server'
import { getCoinData, getDayAgoValues } from '@/lib/supabase'

// Get the data for the home page. Sin referencia de hace 24 h la tasa se sirve igual: la
// tendencia queda neutra, pero nunca tumba la página principal.
export async function GET() {
	const [coinData, dayAgo] = await Promise.all([getCoinData(), getDayAgoValues().catch(() => ({}))])
	const { cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory, gasHistory, cupcashHistory } = coinData
	return NextResponse.json({ cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory, gasHistory, cupcashHistory, dayAgo })
}
