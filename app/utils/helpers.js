// Apply a small percentage variation around `num` to simulate price fluctuation.
// `deep` is the total percentage span (e.g. 0.5 means ±0.25%).
const randomize = (num, deep = 0.1) => {
	const variation = (Math.random() - 0.5) * deep / 100
	return num * (1 + variation)
}

// Splits a history array into the most-recent entry and the average of the rest.
const averageData = (arr) => {
	if (!arr?.length) return { first: null, average: 0 }
	const [first, ...rest] = arr
	if (rest.length === 0) return { first, average: first.value }
	const average = rest.reduce((acc, curr) => acc + curr.value, 0) / rest.length
	return { first, average }
}

// Relative age of a timestamp in Spanish ("hace 5 min", "hace 2h", "hace 3d").
const getTimeAgo = (date) => {
	const seconds = Math.floor((new Date() - new Date(date)) / 1000)
	if (seconds < 60) return 'hace segundos'
	if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`
	if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`
	return `hace ${Math.floor(seconds / 86400)}d`
}

export { randomize, averageData, getTimeAgo }
