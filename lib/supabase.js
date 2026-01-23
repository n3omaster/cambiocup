
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

const getCoinData = async () => {

	const { data: cupHistory, error: cupError } = await supabase
		.from('exchange')
		.select()
		.eq('coin_id', 1)
		.order('updated_at', { ascending: false })
		.limit(6)

	const { data: mlcHistory, error: mlcError } = await supabase
		.from('exchange')
		.select()
		.eq('coin_id', 2)
		.order('updated_at', { ascending: false })
		.limit(6)

	const { data: clasicaHistory, error: clasicaError } = await supabase
		.from('exchange')
		.select()
		.eq('coin_id', 3)
		.order('updated_at', { ascending: false })
		.limit(6)

	const { data: etecsaHistory, error: etecsaError } = await supabase
		.from('exchange')
		.select()
		.eq('coin_id', 4)
		.order('updated_at', { ascending: false })
		.limit(6)

	const { data: bandecprepagoHistory, error: bandecprepagoError } = await supabase
		.from('exchange')
		.select()
		.eq('coin_id', 5)
		.order('updated_at', { ascending: false })
		.limit(6)

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

// Coin ID mapping
const COIN_IDS = {
	CUP: 1,
	MLC: 2,
	CLASICA: 3,
	ETECSA: 4,
	TROPICAL: 5,
}

const getHistoricalData = async (coin = 'CUP', days = 7) => {
	const coinId = COIN_IDS[coin.toUpperCase()] || 1
	const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

	const { data, error } = await supabase
		.from('exchange')
		.select('value, updated_at')
		.eq('coin_id', coinId)
		.gte('updated_at', startDate)
		.order('updated_at', { ascending: true })

	return { data, error }
}

const saveCoinData = async (cupValue, mlcValue, clasicaValue, etecsaValue, bandecprepagoValue) => {

	const { data: rspCup, error: cupError } = await supabase
		.from('exchange')
		.insert({ coin_id: 1, value: cupValue })
		.select()
	const cup = rspCup[0]

	const { data: rspMlc, error: mlcError } = await supabase
		.from('exchange')
		.insert({ coin_id: 2, value: mlcValue })
		.select()
	const mlc = rspMlc[0]

	const { data: rspClasica, error: clasicaError } = await supabase
		.from('exchange')
		.insert({ coin_id: 3, value: clasicaValue })
		.select()
	const clasica = rspClasica[0]

	const { data: rspEtecsa, error: etecsaError } = await supabase
		.from('exchange')
		.insert({ coin_id: 4, value: etecsaValue })
		.select()
	const etecsa = rspEtecsa[0]

	const { data: rspBandecprepago, error: bandecprepagoError } = await supabase
		.from('exchange')
		.insert({ coin_id: 5, value: bandecprepagoValue })
		.select()
	const bandecprepago = rspBandecprepago[0]

	return { cup, mlc, clasica, etecsa, bandecprepago }
}

export { getCoinData, saveCoinData, saveOffer, getRecentOffers, getHistoricalData, supabase }