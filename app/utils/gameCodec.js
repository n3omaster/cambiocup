// Shared client/server codec for game-score submissions: XOR-scrambles the
// payload with a keystream derived from the run token, so the request body is
// not readable/replayable JSON in the network tab. This is obfuscation, not
// cryptography — the real defense is the server-side token signature and
// plausibility checks in /api/game-score.

const seedFrom = (str) => {
	let h = 2166136261
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

const mulberry32 = (seed) => () => {
	seed |= 0; seed = (seed + 0x6D2B79F5) | 0
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const xorBytes = (bytes, token) => {
	const rand = mulberry32(seedFrom(token))
	const out = new Uint8Array(bytes.length)
	for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ Math.floor(rand() * 256)
	return out
}

const encodePayload = (obj, token) => {
	const out = xorBytes(new TextEncoder().encode(JSON.stringify(obj)), token)
	let bin = ''
	for (const b of out) bin += String.fromCharCode(b)
	return btoa(bin)
}

const decodePayload = (b64, token) => {
	const bin = atob(b64)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return JSON.parse(new TextDecoder().decode(xorBytes(bytes, token)))
}

export { encodePayload, decodePayload }
