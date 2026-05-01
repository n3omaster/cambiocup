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

export { randomize, averageData }
