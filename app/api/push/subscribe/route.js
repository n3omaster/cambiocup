import { NextResponse } from 'next/server'
import { parseSubscription, pushConfigured } from '@/lib/push'
import { savePushSubscription, deletePushSubscription } from '@/lib/supabase'

export async function POST(request) {
	if (!pushConfigured()) return NextResponse.json({ error: 'PUSH_NOT_CONFIGURED' }, { status: 503 })

	const subscription = parseSubscription(await request.json().catch(() => null))
	if (!subscription) return NextResponse.json({ error: 'INVALID_SUBSCRIPTION' }, { status: 400 })

	try {
		await savePushSubscription(subscription)
		return NextResponse.json({ ok: true })
	} catch (error) { console.error('[push] subscribe:', error); return NextResponse.json({ error: 'SAVE_FAILED' }, { status: 500 }) }
}

// El endpoint es secreto de ese navegador: quien lo conoce es quien se suscribió
export async function DELETE(request) {
	const { endpoint } = (await request.json().catch(() => null)) ?? {}
	if (typeof endpoint !== 'string') return NextResponse.json({ error: 'INVALID_SUBSCRIPTION' }, { status: 400 })

	try {
		await deletePushSubscription(endpoint)
		return NextResponse.json({ ok: true })
	} catch (error) { console.error('[push] unsubscribe:', error); return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 }) }
}
