import { NextResponse } from 'next/server'
import { saveCoinData } from '@/lib/supabase'

// Get the average buy and sell prices for the last 24 hours for BANK_CUP and BANK_MLC and CLASICA
export async function GET() {

	const response = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=BANK_CUP')
	const cupHistory = await response.json()

	const response2 = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=BANK_MLC')
	const mlcHistory = await response2.json()

	const response3 = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=CLASICA')
	const clasicaHistory = await response3.json()

	const response4 = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=ETECSA')
	const etecsaHistory = await response4.json()

	const response5 = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=BANDECPREPAGO')
	const bandecprepagoHistory = await response5.json()

	const { cup, mlc, clasica, etecsa, bandecprepago } = await saveCoinData(
		(cupHistory.average_buy + cupHistory.average_sell) / 2,
		(mlcHistory.average_buy + mlcHistory.average_sell) / 2,
		(clasicaHistory.average_buy + clasicaHistory.average_sell) / 2,
		(etecsaHistory.average_buy + etecsaHistory.average_sell) / 2,
		(bandecprepagoHistory.average_buy + bandecprepagoHistory.average_sell) / 2)

	const randomNumber = Math.random() * 1000
	return NextResponse.json({ cup, mlc, clasica, etecsa, bandecprepago, randomNumber })
}