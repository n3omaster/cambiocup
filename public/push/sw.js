// Worker del aviso diario de tasas. Vive en /push/ a propósito: no controla ninguna página y solo
// atiende push. Así no toca nada de la web y pudo convivir con el worker de OneSignal en /.

self.addEventListener('push', (event) => {
	const { title = 'CambioCUP', body = '', url = '/' } = event.data?.json() ?? {}
	event.waitUntil(self.registration.showNotification(title, {
		body,
		icon: '/android-chrome-192x192.png',
		lang: 'es',
		// El de hoy sustituye al de ayer. Sin renotify, sustituirlo no volvería a avisar
		tag: 'daily-rate',
		renotify: true,
		data: { url },
	}))
})

self.addEventListener('notificationclick', (event) => {
	event.notification.close()
	event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
		const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
		return open ? open.focus() : self.clients.openWindow(event.notification.data?.url ?? '/')
	}))
})

// El navegador puede renovar la suscripción por su cuenta. Sin esto, quien no vuelve a abrir la
// web dejaría de recibir el aviso; la antigua se limpia sola cuando el envío responda 410.
self.addEventListener('pushsubscriptionchange', (event) => {
	const applicationServerKey = event.oldSubscription?.options?.applicationServerKey
	if (!applicationServerKey) return
	event.waitUntil(
		self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
			.then((subscription) => fetch('/api/push/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(subscription),
			})),
	)
})
