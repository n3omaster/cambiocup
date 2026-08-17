import { NextResponse } from 'next/server'
import { saveOffer } from '@/lib/supabase'

const validCoins = ['CUP', 'MLC', 'CLASICA', 'ETECSA', 'TROPICAL', 'GAS', 'CASH']

export async function POST(request) {

	try {

		const body = await request.json()

		// Validate required fields
		const { type, status, value, coin } = body
		if (!type || !status || !value || !coin) { return NextResponse.json({ error: 'Missing required fields: type, status, value, coin' }, { status: 400 }) }

		// Validate type
		if (!['buy', 'sell'].includes(type)) { return NextResponse.json({ error: 'Invalid type. Must be "buy" or "sell"' }, { status: 400 }) }

		// Validate status
		if (!['attempt', 'completed'].includes(status)) { return NextResponse.json({ error: 'Invalid status. Must be "attempt" or "completed"' }, { status: 400 }) }

		// Validate coin
		if (!validCoins.includes(coin.toUpperCase())) { return NextResponse.json({ error: `Invalid coin. Must be one of: ${validCoins.join(', ')}` }, { status: 400 }) }

		// Save to database
		const { data, error } = await saveOffer(type, status, parseFloat(value), coin.toUpperCase())
		if (error) { console.error('Error saving offer:', error); return NextResponse.json({ error: 'Failed to save offer' }, { status: 500 }) }

		return NextResponse.json({ success: true, offer: data })

	} catch (error) { console.error('Webhook error:', error); return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }
}
