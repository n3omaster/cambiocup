// Given a number, return the number with a random small variation
// deep represents the percentage variation (e.g., 0.5 = 0.5% variation)
// This is to simulate the price fluctuation
const randomize = (num, deep = 0.1) => {
	// Calculate variation as percentage: -deep/2 to +deep/2
	const variation = (Math.random() - 0.5) * deep / 100
	return num * (1 + variation)
}

// take the first object.value and store it in a variable
// take the rest of the objects and create a average of the object.value
// return both values
const averageData = (arr) => {
	const [first, ...rest] = arr || []
	if (rest.length === 0) return { first, average: first.value }
	const average = rest.reduce((acc, curr) => acc + curr.value, 0) / rest.length
	return { first, average }
}

export { randomize, averageData }