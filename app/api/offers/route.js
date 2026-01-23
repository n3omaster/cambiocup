import { NextResponse } from 'next/server'
import { getRecentOffers } from '@/lib/supabase'

// Get recent offers (last 2 minutes)
export async function GET() {

	const { data, error } = await getRecentOffers(50)

	if (error) {
		console.error('Error fetching offers:', error)
		return NextResponse.json({ offers: [] })
	}

	// Filter offers from last 2 minutes using ISO timestamp comparison
	const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()

	const recentOffers = (data || []).filter((offer) => { return offer.created_at >= twoMinutesAgo })

	return NextResponse.json({ offers: recentOffers })
}
