import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const COIN_IDS = {
	CUP: 1,
	MLC: 2,
	CLASICA: 3,
	ETECSA: 4,
	TROPICAL: 5,
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
	const [cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory] = await Promise.all([
		fetchHistory(1),
		fetchHistory(2),
		fetchHistory(3),
		fetchHistory(4),
		fetchHistory(5),
	])
	return { cupHistory, mlcHistory, clasicaHistory, etecsaHistory, bandecprepagoHistory }
}

const saveOffer = async (type, status, value, coin) => {
	const { data, error } = await supabase
		.from('offers')
		.insert({ type, status, value, coin })
		.select()
	return { data: data?.[0], error }
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

const saveCoinData = async (cupValue, mlcValue, clasicaValue, etecsaValue, bandecprepagoValue) => {
	
	const { data, error } = await supabase
		.from('exchange')
		.insert([
			{ coin_id: 1, value: cupValue },
			{ coin_id: 2, value: mlcValue },
			{ coin_id: 3, value: clasicaValue },
			{ coin_id: 4, value: etecsaValue },
			{ coin_id: 5, value: bandecprepagoValue },
		])
		.select()

	if (error || !data) return { cup: null, mlc: null, clasica: null, etecsa: null, bandecprepago: null, error }

	const byCoin = Object.fromEntries(data.map((row) => [row.coin_id, row]))
	return {
		cup: byCoin[1],
		mlc: byCoin[2],
		clasica: byCoin[3],
		etecsa: byCoin[4],
		bandecprepago: byCoin[5],
	}
}

export { getCoinData, saveCoinData, saveOffer, getRecentOffers, getHistoricalData, supabase, COIN_IDS }
