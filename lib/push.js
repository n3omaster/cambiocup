import webpush from 'web-push'
import { TZ, havanaDay } from '@/lib/gameDay'
import { dayTrend } from '@/app/utils/helpers'
import {
	getCoinData, getDayAgoValues, getPushSubscriptions, deletePushSubscriptionsById, claimPushDay, finishPushDay,
} from '@/lib/supabase'

// Solo se guardan endpoints de estos servicios: el cron hace un POST a cada endpoint guardado, y
// sin esta lista cualquiera podría registrar una URL y hacer que el servidor la llame
const PUSH_HOSTS = ['fcm.googleapis.com', 'jmt17.google.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']
const isPushHost = (host) => PUSH_HOSTS.includes(host) || host.endsWith('.notify.windows.com')

const MAX_ENDPOINT_LENGTH = 2048
const MAX_KEY_LENGTH = 256
const BASE64URL = /^[\w-]+={0,2}$/
const isKey = (key) => typeof key === 'string' && key.length <= MAX_KEY_LENGTH && BASE64URL.test(key)

// { endpoint, p256dh, auth } o null si no es una suscripción válida
const parseSubscription = (body) => {
	const { endpoint, keys } = body ?? {}
	if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return null
	if (!isKey(keys?.p256dh) || !isKey(keys?.auth)) return null

	let url
	try { url = new URL(endpoint) } catch { return null }
	if (url.protocol !== 'https:') return null
	if (!isPushHost(url.hostname)) {
		console.error('[push] servicio de push no admitido:', url.hostname)
		return null
	}
	return { endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

const pushConfigured = () => !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY

// El aviso sale a las 9:00 de La Habana. Vercel solo programa en UTC y Cuba cambia de hora, así que
// el cron corre de sobra y se decide aquí. Va por ventana y no a una hora exacta porque Vercel
// puede saltarse una ejecución: la siguiente del tramo la recupera.
const SEND_FROM_HOUR = 9
const SEND_UNTIL_HOUR = 11

const havanaHour = (ms) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)))

const inSendWindow = (ms) => {
	const hour = havanaHour(ms)
	return hour >= SEND_FROM_HOUR && hour < SEND_UNTIL_HOUR
}

// Mismo criterio que STALE_MS en page.js: si el cron de tasas se paró, no se manda como de hoy
// un dato viejo. CASH puede pasar días sin operaciones y entonces se omite solo esa línea.
const STALE_MS = 30 * 60 * 1000

const trendText = ({ pct, state }) => {
	if (pct === null) return null
	if (state === 'stable') return 'Estable en 24 h'
	return `${pct < 0 ? '▼' : '▲'}${Math.abs(pct).toFixed(2)}% en 24 h`
}

// Valores reales, nunca los de randomize(): este número se queda en la bandeja del teléfono.
const dailyMessage = (coins, dayAgo, now) => {
	const latest = (key) => {
		const row = coins[key]?.[0]
		return row && now - new Date(row.updated_at) <= STALE_MS ? row.value : null
	}
	const cup = latest('cupHistory')
	if (!cup) return null

	const mlc = latest('mlcHistory')
	const cash = latest('cupcashHistory')
	const body = [
		trendText(dayTrend(cup, dayAgo.cupHistory)),
		mlc && `MLC $${mlc.toFixed(3)}`,
		cash && `Efectivo $${cash.toFixed(2)}`,
	].filter(Boolean).join(' · ')

	return { title: `Dólar en CUP: $${cup.toFixed(2)}`, body, url: '/' }
}

// Una tasa de hace más de 12 h ya no sirve: el servicio la descarta si el teléfono sigue sin conexión
const TTL_S = 12 * 60 * 60
const SEND_TIMEOUT_MS = 10 * 1000
const PAGE_SIZE = 500
const BATCH_SIZE = 20

// Una suscripción recién creada puede responder 410 unos segundos y luego funcionar (medido: hasta
// 9 s con el servicio de Chrome), así que 404/410 solo la borra si ya tiene un rato.
const GONE_MIN_AGE_MS = 60 * 60 * 1000

const deliver = async (row, payload, options, now) => {
	try {
		await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, options)
		return 'sent'
	} catch (err) {
		const expired = err.statusCode === 404 || err.statusCode === 410
		if (expired && now - new Date(row.created_at) >= GONE_MIN_AGE_MS) return 'gone'
		console.error('[push] envío fallido:', err.statusCode ?? err.code ?? err.message)
		return 'failed'
	}
}

const sendToAll = async (message, now) => {
	const payload = JSON.stringify(message)
	const options = {
		TTL: TTL_S,
		urgency: 'normal',
		timeout: SEND_TIMEOUT_MS,
		vapidDetails: {
			subject: 'https://www.cambiocup.com',
			publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
			privateKey: process.env.VAPID_PRIVATE_KEY,
		},
	}

	const stats = { sent: 0, gone: 0, failed: 0 }
	let afterId = 0
	let page
	do {
		page = await getPushSubscriptions(afterId, PAGE_SIZE)
		const gone = []
		for (let i = 0; i < page.length; i += BATCH_SIZE) {
			const batch = page.slice(i, i + BATCH_SIZE)
			const results = await Promise.all(batch.map((row) => deliver(row, payload, options, now)))
			results.forEach((result, j) => {
				stats[result]++
				if (result === 'gone') gone.push(batch[j].id)
			})
		}
		if (gone.length) await deletePushSubscriptionsById(gone)
		afterId = page.at(-1)?.id
	} while (page.length === PAGE_SIZE)
	return stats
}

// Se comprueba todo lo que puede fallar ANTES de reclamar el día: una vez reclamado no hay
// reintento, y sin datos frescos conviene que lo intente la siguiente ejecución del tramo.
const sendDailyRates = async (now = Date.now()) => {
	if (!inSendWindow(now)) return { skipped: 'outside-window' }

	const [coins, dayAgo] = await Promise.all([getCoinData(), getDayAgoValues().catch(() => ({}))])
	const message = dailyMessage(coins, dayAgo, now)
	if (!message) return { skipped: 'stale-rates' }

	const day = havanaDay(now)
	if (!await claimPushDay(day)) return { skipped: 'already-sent', day }

	const stats = await sendToAll(message, now)
	await finishPushDay(day, stats)
	return { day, ...stats }
}

export { parseSubscription, pushConfigured, inSendWindow, dailyMessage, sendDailyRates }
