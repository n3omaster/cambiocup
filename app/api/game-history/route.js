import { NextResponse } from 'next/server'
import { supabase, COIN_IDS } from '@/lib/supabase'

const PAGE_SIZE = 1000
const MAX_PAGES = 150 // safety cap: up to 150k raw rows
const CONCURRENCY = 10
const TARGET_POINTS = 2000

// Full history for the game terrain: counts the rows, pages past the implicit
// 1000-row cap in parallel batches, then buckets down to ~TARGET_POINTS averaged
// values so the payload stays small. Cached at the edge for an hour.
export async function GET(request) {

	const { searchParams } = new URL(request.url)
	const coin = (searchParams.get('coin') || 'CUP').toUpperCase()
	const coinId = COIN_IDS[coin] || 1

	const { count, error: countError } = await supabase
		.from('exchange')
		.select('*', { count: 'exact', head: true })
		.eq('coin_id', coinId)

	if (countError || !count) {
		if (countError) console.error('Error counting game history:', countError)
		return NextResponse.json({ data: [], coin })
	}

	const totalPages = Math.min(Math.ceil(count / PAGE_SIZE), MAX_PAGES)
	const fetchPage = (page) =>
		supabase
			.from('exchange')
			.select('value, updated_at')
			.eq('coin_id', coinId)
			.order('updated_at', { ascending: true })
			.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

	const rows = []
	for (let start = 0; start < totalPages; start += CONCURRENCY) {
		const batch = Array.from(
			{ length: Math.min(CONCURRENCY, totalPages - start) },
			(_, i) => fetchPage(start + i),
		)
		const results = await Promise.all(batch)
		for (const { data, error } of results) {
			if (error) { console.error('Error fetching game history page:', error); continue }
			if (data?.length) rows.push(...data)
		}
	}

	if (!rows.length) return NextResponse.json({ data: [], coin })

	const first = new Date(rows[0].updated_at).getTime()
	const last = new Date(rows[rows.length - 1].updated_at).getTime()
	const span = Math.max(last - first, 1)
	const bucketMs = Math.max(Math.ceil(span / TARGET_POINTS), 10 * 60 * 1000)

	const buckets = new Map()
	for (const row of rows) {
		const key = Math.floor((new Date(row.updated_at).getTime() - first) / bucketMs)
		const bucket = buckets.get(key) || { sum: 0, count: 0 }
		bucket.sum += row.value
		bucket.count++
		buckets.set(key, bucket)
	}

	const points = [...buckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([key, bucket]) => ({
			time: Math.floor((first + key * bucketMs + bucketMs / 2) / 1000),
			value: Number((bucket.sum / bucket.count).toFixed(4)),
		}))

	return NextResponse.json(
		{ data: points, coin },
		{ headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
	)
}
