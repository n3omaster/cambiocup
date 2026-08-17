import { NextResponse } from 'next/server'
import { getCoinData } from '@/lib/supabase'

// Get the data for the home page
export async function GET() {
	const { cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory, gasHistory, cupcashHistory } = await getCoinData()
	return NextResponse.json({ cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory, gasHistory, cupcashHistory })
}