'use client'

// cambiocup dentro de la app de QvaPay (mini-app) — helper ÚNICO del lado cliente.
//
// La app de QvaPay abre cambiocup en un WebView e inyecta `window.QvaPay` (el SDK) ANTES de
// cargar la página; el simulador de QvaPay lo hace después y avisa con el evento
// `qvapay:ready`. Fuera de la app no existe nada de esto y cada función de aquí degrada a
// no-op: en un navegador normal cambiocup se comporta exactamente igual que siempre.
// El atributo `data-qvapay` en <html> lo pone un script en el <head> (app/layout.js), así
// el CSS (`in-qvapay:` en globals.css) oculta cosas sin parpadeo y sin esperar a React.

import { useSyncExternalStore } from 'react'

export const qp = () => (typeof window !== 'undefined' && window.QvaPay) || null
export const inQvaPay = () => !!qp()

const subscribeSdk = (cb) => {
	window.addEventListener('qvapay:ready', cb)
	return () => window.removeEventListener('qvapay:ready', cb)
}

// En el servidor (y durante la hidratación) siempre false: nada de lo que dependa de esto
// puede descuadrar el HTML
export const useInQvaPay = () => useSyncExternalStore(subscribeSdk, inQvaPay, () => false)

// Oculta el loader nativo. Una vez por carga: cualquier página que monte puede llamarlo.
let readySent = false
export const signalReady = () => {
	const sdk = qp()
	if (!sdk || readySent) return
	readySent = true
	try { Promise.resolve(sdk.ready()).catch(() => { }) } catch { /* SDK viejo */ }
}

// Vibración discreta en momentos clave (cambiar de moneda, caer, ganar, récord). NUNCA por
// salto ni por frame. Tipos: light | medium | heavy | success | warning | error.
export const haptic = (type = 'light') => {
	const sdk = qp()
	if (!sdk?.ui?.haptic) return
	try { Promise.resolve(sdk.ui.haptic(type)).catch(() => { }) } catch { /* SDK viejo */ }
}

// --- Sesión verificada de QvaPay (CUP Runner) ------------------------------------
// { token, name, exp }: la firma cambiocup (/api/qvapay-session) tras verificar el
// init_data. Memoria + sessionStorage, que en el WebView puede no existir.
const SESSION_KEY = 'cambiocup:qvapay'

const sessionStore = (() => {
	const listeners = new Set()
	let current
	const fresh = (s) => (s?.token && s?.name && Number(s.exp) * 1000 > Date.now() ? s : null)
	const hydrate = () => {
		if (current !== undefined) return
		try { current = fresh(JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')) } catch { current = null }
	}
	return {
		subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
		get: () => { hydrate(); return current },
		set: (value) => {
			current = fresh(value)
			try { current ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(current)) : sessionStorage.removeItem(SESSION_KEY) } catch { /* sin storage: queda en memoria */ }
			listeners.forEach((cb) => cb())
		},
		fresh,
	}
})()

export const useQvaPaySession = () => useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => null)

// La sesión si sigue vigente (la caducada se descarta al leerla)
export const getQvaPaySession = () => {
	const s = sessionStore.get()
	if (s && !sessionStore.fresh(s)) { sessionStore.set(null); return null }
	return s
}

export const clearQvaPaySession = () => sessionStore.set(null)

// ¿El servidor tiene configurado el login con QvaPay? Se pregunta una vez por carga.
let enabledPromise = null
export const qvapayLoginEnabled = () => {
	if (!inQvaPay()) return Promise.resolve(false)
	if (!enabledPromise) {
		enabledPromise = fetch('/api/qvapay-session', { cache: 'no-store' })
			.then((res) => (res.ok ? res.json() : null))
			.then((json) => !!json?.enabled)
			.catch(() => { enabledPromise = null; return false })
	}
	return enabledPromise
}

// Permiso nativo de QvaPay → init_data → sesión de cambiocup. Lanza { code, message };
// `USER_CANCELLED` si el jugador cierra la hoja de permiso.
export const loginWithQvaPay = async () => {
	const sdk = qp()
	if (!sdk?.auth?.requestLogin) throw { code: 'NOT_IN_QVAPAY', message: 'Abre cambiocup desde la app de QvaPay' }
	const { init_data } = await sdk.auth.requestLogin({ scopes: ['profile'] })
	const res = await fetch('/api/qvapay-session', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ init_data }),
	})
	const json = await res.json().catch(() => null)
	if (!res.ok || !json?.token) throw { code: 'LOGIN_FAILED', message: json?.error || 'No se pudo entrar con QvaPay' }
	sessionStore.set({ token: json.token, name: json.name, exp: json.exp })
	return sessionStore.get()
}
