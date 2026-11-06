import { NextResponse } from 'next/server'
import { pushConfigured, sendDailyRates } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request) {
	// Vercel manda CRON_SECRET en cada ejecución. Sin él, esta ruta sería un botón público para
	// enviar push a todos los suscriptores, así que si falta la variable tampoco se abre.
	const secret = process.env.CRON_SECRET
	if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
	}
	if (!pushConfigured()) return NextResponse.json({ error: 'PUSH_NOT_CONFIGURED' }, { status: 503 })

	try {
		return NextResponse.json(await sendDailyRates())
	} catch (error) { console.error('[push] daily:', error); return NextResponse.json({ error: 'SEND_FAILED' }, { status: 500 }) }
}
