import { NextResponse } from 'next/server'
import { saveCoinData } from '@/lib/supabase'

export const fetchCache = 'force-no-store'
export const revalidate = 0

export async function GET() {

    const response = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=BANK_CUP', {
        headers: { 'Cache-Control': 'no-cache' },
        next: { revalidate: 0 }
    })
    const cupHistory = await response.json()
    
    const response2 = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=BANK_MLC', {
        headers: { 'Cache-Control': 'no-cache' },
        next: { revalidate: 0 }
    })
    const mlcHistory = await response2.json()

    console.log(mlcHistory)

    const response3 = await fetch('https://api.qvapay.com/p2p/completed_pairs_average?coin=CLASICA', {
        headers: { 'Cache-Control': 'no-cache' },
        next: { revalidate: 0 }
    })
    const clasicaHistory = await response3.json()
    
    const { cup, mlc, clasica } = await saveCoinData((cupHistory.average_buy + cupHistory.average_sell) / 2, (mlcHistory.average_buy + mlcHistory.average_sell) / 2, (clasicaHistory.average_buy + clasicaHistory.average_sell) / 2)
    const randomNumber = Math.random() * 1000

    return NextResponse.json({ cup, mlc, clasica, randomNumber })
}
