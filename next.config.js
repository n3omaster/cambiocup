// La zona de Cloudflare da un año de caché de navegador a lo que no diga lo contrario, y el worker
// de OneSignal ya salía con `max-age=31536000`. Un worker tiene que poder sustituirse: es la única
// forma de retirar el de OneSignal de los navegadores que ya lo tienen.
const WORKERS = ['/push/sw.js', '/OneSignalSDKWorker.js']

/** @type {import('next').NextConfig} */
const nextConfig = {
	async headers() {
		return WORKERS.map((source) => ({
			source,
			headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
		}))
	},
}

module.exports = nextConfig
