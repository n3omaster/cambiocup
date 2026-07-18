import { NextResponse } from 'next/server'
import { saveCoinData } from '@/lib/supabase'

const QVAPAY_COINS = ['BANK_CUP', 'BANK_MLC', 'CLASICA', 'ETECSA', 'BANDECPREPAGO']

// GAS is not traded on QvaPay — fixed price per litre in USD
const GAS_PRICE = 3.5

const fetchAverage = async (coin) => {
	const res = await fetch(`https://api.qvapay.com/p2p/completed_pairs_average?coin=${coin}`, { cache: 'no-store' })
	if (!res.ok) throw new Error(`QvaPay ${coin} responded ${res.status}`)
	const { average_buy, average_sell } = await res.json()
	return (average_buy + average_sell) / 2
}

export async function GET() {
	try {
		const [cupAvg, mlcAvg, clasicaAvg, etecsaAvg, bandecprepagoAvg] = await Promise.all(QVAPAY_COINS.map(fetchAverage))
		const result = await saveCoinData(cupAvg, mlcAvg, clasicaAvg, etecsaAvg, bandecprepagoAvg, GAS_PRICE)
		return NextResponse.json(result)
	} catch (error) { console.error('Cron error:', error); return NextResponse.json({ error: 'Failed to refresh exchange rates' }, { status: 502 }) }
}
