'use client'

// Suscripción al aviso diario de tasas (lado cliente). El permiso de notificaciones es del origen,
// no de quien lo pidió: quien lo concedió a OneSignal pasa aquí sin ver ningún diálogo.

const SW_URL = '/push/sw.js'
const SW_SCOPE = '/push/'
const API = '/api/push/subscribe'
const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

const OFF_KEY = 'cambiocup:push:off' // lo apagó a propósito: el permiso sigue concedido y hay que respetarlo
const SNOOZE_KEY = 'cambiocup:push:snooze'
const SYNCED_KEY = 'cambiocup:push:synced'
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000

// En un iframe de otra web el navegador no deja pedir permiso. El iPhone solo expone PushManager
// a la web instalada en la pantalla de inicio.
const pushSupported = () => !!PUBLIC_KEY && window.self === window.top
	&& 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const optedOut = () => !!localStorage.getItem(OFF_KEY)

// `navigator.serviceWorker.ready` no sirve aquí: espera al worker que controla esta página, y el
// nuestro no controla ninguna. Se escucha directamente al que se está instalando.
const register = async () => {
	const registration = await navigator.serviceWorker.register(SW_URL, { updateViaCache: 'none' })
	const worker = registration.installing ?? registration.waiting
	if (!registration.active && worker) {
		await new Promise((resolve) => {
			worker.addEventListener('statechange', () => {
				if (worker.state === 'activated' || worker.state === 'redundant') resolve()
			})
		})
	}
	return registration
}

const keyBytes = () => Uint8Array.from(atob(PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0))

const subscribe = (registration) => registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes() })

const save = async (subscription) => {
	const response = await fetch(API, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(subscription),
	})
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	sessionStorage.setItem(SYNCED_KEY, subscription.endpoint)
}

// Al cargar, sin interacción. Devuelve 'unsupported' | 'denied' | 'off' | 'on'. Vuelve a enviar la
// suscripción una vez por sesión para que se recupere sola si el servidor llegó a perderla.
export const syncPush = async () => {
	if (!pushSupported()) return 'unsupported'
	if (Notification.permission === 'denied') return 'denied'
	try {
		// Se registra también sin permiso: Safari solo deja suscribirse pegado al toque, y así ese
		// toque no tiene que esperar a que se descargue el worker
		const registration = await register()
		if (Notification.permission !== 'granted' || optedOut()) return 'off'
		const subscription = await registration.pushManager.getSubscription() ?? await subscribe(registration)
		if (sessionStorage.getItem(SYNCED_KEY) !== subscription.endpoint) await save(subscription)
		return 'on'
	} catch (err) {
		console.error('[push] sync:', err?.name, err?.message)
		return 'off'
	}
}

// Siempre desde un toque. subscribe() pide el permiso si hace falta, y va directo porque pedirlo
// aparte con Notification.requestPermission() gastaría el gesto que Safari exige para suscribirse.
export const enablePush = async () => {
	try {
		const registration = await register()
		const subscription = await registration.pushManager.getSubscription() ?? await subscribe(registration)
		await save(subscription)
		localStorage.removeItem(OFF_KEY)
		return 'on'
	} catch (err) {
		console.error('[push] enable:', err?.name, err?.message)
		return Notification.permission === 'denied' ? 'denied' : 'off'
	}
}

// Primero se da de baja en el navegador, que es lo que garantiza que no lleguen más avisos. Si el
// DELETE falla, el siguiente envío responde 410 y la fila se limpia sola.
export const disablePush = async () => {
	localStorage.setItem(OFF_KEY, '1')
	sessionStorage.removeItem(SYNCED_KEY)
	try {
		const registration = await navigator.serviceWorker.getRegistration(SW_SCOPE)
		const subscription = await registration?.pushManager.getSubscription()
		if (subscription) {
			await subscription.unsubscribe()
			await fetch(API, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ endpoint: subscription.endpoint }),
			})
		}
	} catch (err) { console.error('[push] disable:', err?.name, err?.message) }
	return 'off'
}

export const shouldPrompt = (state) => state === 'off' && !optedOut()
	&& Date.now() - Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > SNOOZE_MS

export const snoozePrompt = () => localStorage.setItem(SNOOZE_KEY, String(Date.now()))
