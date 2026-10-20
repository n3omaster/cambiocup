import { createHmac, timingSafeEqual } from 'crypto'
import { deriveSecret } from '@/lib/gameToken'

// Identidad de QvaPay para CUP Runner — SOLO servidor.
//
// Dentro de la app de QvaPay, cambiocup es una mini-app: el SDK (window.QvaPay) le da al
// jugador un `init_data` firmado con el secret de NUESTRA App de QvaPay. Aquí se verifica
// con el mismo algoritmo que publica QvaPay (qpweb scripts/miniapps/sign.js, estilo Telegram
// WebApp) y se canjea por una sesión propia de cambiocup. Con esa sesión el ranking guarda el
// @usuario VERIFICADO en vez del @ de Telegram que cualquiera podía teclear.
//
//   secret_key        = HMAC_SHA256(key="QvaPayMiniApp", msg=app_secret)
//   hash              = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
//   data_check_string = campos salvo `hash`, ordenados por clave, `clave=valor` unidos por "\n"
//
// Sin QVAPAY_APP_UUID / QVAPAY_APP_SECRET todo esto queda apagado (la ruta responde 503 y el
// juego sigue con el @ de Telegram tecleado).

export const MINI_APP_SLUG = 'cambiocup'
const INIT_DATA_KEY = 'QvaPayMiniApp'
// El init_data se pide al tocar "Entrar con QvaPay" y se canjea enseguida
const INIT_DATA_MAX_AGE_S = 600
const SESSION_TTL_S = 2 * 60 * 60

export const qvapayConfigured = () => !!(process.env.QVAPAY_APP_UUID && process.env.QVAPAY_APP_SECRET)

const dataCheckString = (fields) => Object.keys(fields)
	.filter((k) => k !== 'hash')
	.sort()
	.map((k) => `${k}=${fields[k]}`)
	.join('\n')

const signFields = (fields, appSecret) => {
	const secretKey = createHmac('sha256', INIT_DATA_KEY).update(String(appSecret)).digest()
	return createHmac('sha256', secretKey).update(dataCheckString(fields)).digest('hex')
}

// → { ok: true, data } | { ok: false, reason }
export const verifyInitData = (initData, appSecret, { maxAgeSeconds = INIT_DATA_MAX_AGE_S, now = Date.now() } = {}) => {
	let params
	try { params = new URLSearchParams(String(initData ?? '')) } catch { return { ok: false, reason: 'malformed' } }
	const fields = {}
	for (const [k, v] of params) fields[k] = v
	const received = fields.hash
	if (!received || !/^[a-f0-9]{64}$/i.test(received)) return { ok: false, reason: 'missing_hash' }

	const expected = Buffer.from(signFields(fields, appSecret), 'hex')
	const given = Buffer.from(received.toLowerCase(), 'hex')
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_hash' }

	const authDate = Number(fields.auth_date)
	if (!Number.isFinite(authDate)) return { ok: false, reason: 'malformed' }
	if (maxAgeSeconds && Math.floor(now / 1000) - authDate > maxAgeSeconds) return { ok: false, reason: 'expired' }

	let user = null
	try { user = JSON.parse(fields.user) } catch { return { ok: false, reason: 'malformed' } }

	return {
		ok: true,
		data: {
			auth_date: authDate,
			app_uuid: fields.app_uuid,
			mini_app: fields.mini_app,
			scopes: fields.scopes ? fields.scopes.split(',') : [],
			user,
		},
	}
}

// Usuario de QvaPay → nombre del ranking ("@usuario", minúsculas, igual que el de Telegram).
// Los usuarios de QvaPay no siguen las reglas de Telegram (pueden empezar por número o ser
// cortos), así que se valida aparte. null si no sirve para mostrar.
export const verifiedName = (username) => {
	const user = String(username || '').trim().replace(/^@+/, '')
	return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,39}$/.test(user) ? `@${user.toLowerCase()}` : null
}

// --- Sesión de cambiocup -------------------------------------------------------
// base64url(JSON {uuid, name, exp}) + "." + HMAC. Clave derivada del secreto del juego con
// etiqueta propia: un run token no vale como sesión ni al revés.
const sessionKey = () => deriveSecret('cambiocup-qvapay-session-v1')
const mac = (body) => createHmac('sha256', sessionKey()).update(body).digest('base64url')

export const signQvaPaySession = ({ uuid, name }, now = Date.now()) => {
	const exp = Math.floor(now / 1000) + SESSION_TTL_S
	const body = Buffer.from(JSON.stringify({ uuid, name, exp })).toString('base64url')
	return { token: `${body}.${mac(body)}`, exp }
}

// → { uuid, name, exp } o null
export const verifyQvaPaySession = (token, now = Date.now()) => {
	const [body, sig] = String(token ?? '').split('.')
	if (!body || !sig) return null
	const expected = Buffer.from(mac(body))
	const given = Buffer.from(sig)
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
	let payload
	try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
	if (!payload?.uuid || !verifiedName(payload.name) || !Number.isFinite(payload.exp) || payload.exp < Math.floor(now / 1000)) return null
	return payload
}
