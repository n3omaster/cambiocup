import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const COIN_IDS = {
	CUP: 1,
	MLC: 2,
	CLASICA: 3,
	ETECSA: 4,
	TROPICAL: 5,
	GAS: 6,
	CASH: 7,
}

const fetchHistory = (coinId) =>
	supabase
		.from('exchange')
		.select()
		.eq('coin_id', coinId)
		.order('updated_at', { ascending: false })
		.limit(6)
		.then(({ data }) => data)

const getCoinData = async () => {
	const [cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory, gasHistory, cupcashHistory] = await Promise.all([
		fetchHistory(1),
		fetchHistory(2),
		fetchHistory(3),
		fetchHistory(4),
		fetchHistory(5),
		fetchHistory(6),
		fetchHistory(7),
	])
	return { cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory, gasHistory, cupcashHistory }
}

const saveOffer = async (type, status, value, coin) => {
	const { data, error } = await supabase
		.from('offers')
		.insert({ type, status, value, coin })
		.select()
	return { data: data?.[0], error }
}

// flagged=true rows are the honeypot (curl'd or implausible runs): stored for
// the record, excluded from every read below. nonce enforces single-use tokens
// via a partial unique index.
const saveGameScore = async (name, score, day, flagged = false, nonce = null) => {
	const { data, error } = await supabase
		.from('game_scores')
		.insert({ name, score, day, flagged, nonce })
		.select()
	return { data: data?.[0], error }
}

const getTopScores = async (limit = 100) => {
	const { data, error } = await supabase
		.from('game_scores')
		.select('name, score, day, created_at')
		.eq('flagged', false)
		.order('score', { ascending: false })
		.limit(limit)
	return { data, error }
}

const countScoresAbove = async (score) => {
	const { count, error } = await supabase
		.from('game_scores')
		.select('*', { count: 'exact', head: true })
		.eq('flagged', false)
		.gt('score', score)
	return { count, error }
}

const countGameRuns = async () => {
	const { count, error } = await supabase
		.from('game_scores')
		.select('*', { count: 'exact', head: true })
		.eq('flagged', false)
	return { count, error }
}

// Para el verificador de replays: las ofertas EN VIVO que una traza dice haber
// enfrentado deben existir de verdad y haber ocurrido durante el run
const getOffersByIds = async (ids) => {
	const { data, error } = await supabase
		.from('offers')
		.select('id, value, created_at')
		.in('id', ids)
	return { data, error }
}

const getRecentOffers = async (limit = 10) => {
	const { data, error } = await supabase
		.from('offers')
		.select()
		.order('created_at', { ascending: false })
		.limit(limit)
	return { data, error }
}

const getHistoricalData = async (coin = 'CUP', days = 7) => {

	const coinId = COIN_IDS[coin.toUpperCase()] || 1
	const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

	const { data, error } = await supabase
		.from('exchange')
		.select('value, updated_at')
		.eq('coin_id', coinId)
		.gte('updated_at', startDate)
		.order('updated_at', { ascending: false }) // newest first so the implicit 1000-row cap keeps recent data
		.limit(1000)

	return { data: data ? data.reverse() : data, error } // back to chronological order for the chart
}

const saveCoinData = async (cupValue, mlcValue, clasicaValue, etecsaValue, bandecprepagoValue, gasValue, cupcashValue) => {

	// Coins whose source had no market data this tick (null/NaN) are skipped, not saved
	const rows = [
		{ coin_id: 1, value: cupValue },
		{ coin_id: 2, value: mlcValue },
		{ coin_id: 3, value: clasicaValue },
		{ coin_id: 4, value: etecsaValue },
		{ coin_id: 5, value: bandecprepagoValue },
		{ coin_id: 6, value: gasValue },
		{ coin_id: 7, value: cupcashValue },
	].filter((row) => Number.isFinite(row.value))

	const { data, error } = await supabase
		.from('exchange')
		.insert(rows)
		.select()

	if (error || !data) return { cup: null, mlc: null, clasica: null, etecsa: null, bandecprepago: null, gas: null, cupcash: null, error }

	const byCoin = Object.fromEntries(data.map((row) => [row.coin_id, row]))
	return {
		cup: byCoin[1] ?? null,
		mlc: byCoin[2] ?? null,
		clasica: byCoin[3] ?? null,
		etecsa: byCoin[4] ?? null,
		bandecprepago: byCoin[5] ?? null,
		gas: byCoin[6] ?? null,
		cupcash: byCoin[7] ?? null,
	}
}

export { getCoinData, saveCoinData, saveOffer, getRecentOffers, getOffersByIds, getHistoricalData, saveGameScore, getTopScores, countScoresAbove, countGameRuns, supabase, COIN_IDS }
