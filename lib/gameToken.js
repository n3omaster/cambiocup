import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

// HMAC secret for game run tokens — server-only, never shipped to the client.
// Falls back to SUPABASE_KEY so it works with zero config; set GAME_SCORE_SECRET
// to rotate it independently of the database key.
const SECRET = process.env.GAME_SCORE_SECRET || process.env.SUPABASE_KEY || 'cambiocup-dev-secret'

const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url')

// Token: base64url({t: issuedAtMs, n: nonce}) + "." + HMAC. Issued when a run
// starts; at submit time its age is the proof of how long the run really lasted,
// and the nonce (unique-indexed in game_scores) makes each token single-use.
const issueToken = () => {
	const payload = Buffer.from(JSON.stringify({ t: Date.now(), n: randomBytes(9).toString('base64url') })).toString('base64url')
	return `${payload}.${sign(payload)}`
}

const verifyToken = (token) => {
	const [payload, sig] = String(token || '').split('.')
	if (!payload || !sig) return null
	const expected = Buffer.from(sign(payload))
	const given = Buffer.from(sig)
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
	try {
		const { t, n } = JSON.parse(Buffer.from(payload, 'base64url').toString())
		return Number.isFinite(t) && typeof n === 'string' && n ? { t, n } : null
	} catch {
		return null
	}
}

export { issueToken, verifyToken }
