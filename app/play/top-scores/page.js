import Link from 'next/link'
import { getTopScores, countGameRuns } from '@/lib/supabase'

export const revalidate = 30 // el leaderboard se refresca solo cada 30s

export const metadata = {
	title: 'Records — CUP Runner | CambioCUP',
	description: 'Los mejores corredores de la tasa del CUP. ¿Cuántos días sobrevivieron surfeando el precio real del dólar en Cuba?',
	openGraph: {
		title: 'Records — CUP Runner | CambioCUP',
		description: 'Los mejores corredores de la tasa del CUP.',
		images: [{ url: '/api/og/play', width: 1200, height: 630, alt: 'CUP Runner — records' }],
	},
}

const MEDALS = ['🥇', '🥈', '🥉']

// Mejor score por jugador (mismo criterio que el mini-leaderboard del juego),
// hasta 50 puestos. flagged=true (honeypot) ya queda fuera en getTopScores.
const bestPerPlayer = (rows) => {
	const seen = new Set()
	const top = []
	for (const row of rows || []) {
		const key = row.name.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		top.push(row)
		if (top.length === 50) break
	}
	return top
}

export default async function TopScoresPage() {

	const [{ data, error }, { count }] = await Promise.all([getTopScores(500), countGameRuns()])
	const top = error ? [] : bestPerPlayer(data)
	const runs = count || 0

	return (
		<div className="min-h-dvh w-full bg-[#0b0c10] text-white">
			<div className="mx-auto flex max-w-lg flex-col items-center gap-6 px-5 py-10">

				<header className="flex flex-col items-center gap-2 text-center">
					<h1 className="text-3xl font-extrabold tracking-tight">
						CUP <span className="text-malachite-500">RUNNER</span>
					</h1>
					<p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/40">Records mundiales</p>
					{runs > 0 && (
						<p className="rounded-full liquid-glass liquid-glass--dark px-4 py-1 text-xs tabular-nums text-white/70">
							🌍 {runs.toLocaleString('es')} partidas jugadas
						</p>
					)}
				</header>

				{top.length === 0 ? (
					<p className="py-16 text-center text-sm text-white/50">
						{error ? 'No se pudo cargar el ranking 😕' : 'Aún no hay records. ¡Sé el primero!'}
					</p>
				) : (
					<ol className="w-full overflow-hidden rounded-2xl liquid-glass liquid-glass--dark">
						{top.map((row, i) => (
							<li
								key={`${row.name}-${i}`}
								className={`flex items-center gap-3 px-4 py-3 text-sm ${i > 0 ? 'border-t border-white/5' : ''} ${i < 3 ? 'bg-white/[0.03]' : ''}`}
							>
								<span className="w-8 shrink-0 text-center text-base font-bold tabular-nums text-white/50">
									{MEDALS[i] || i + 1}
								</span>
								<span className="min-w-0 flex-1 truncate font-medium text-white/85">{row.name}</span>
								<span className="shrink-0 text-right text-xs tabular-nums text-white/40">día {row.day}</span>
								<span className="w-24 shrink-0 text-right font-bold tabular-nums text-[#ffd75e]">
									{row.score.toLocaleString('es')}
								</span>
							</li>
						))}
					</ol>
				)}

				<div className="flex flex-col items-center gap-3">
					<Link
						href="/play"
						className="rounded-full bg-malachite-500 px-8 py-3 text-base font-extrabold text-black shadow-[0_0_40px_rgba(83,221,108,0.45)] transition-transform hover:scale-105 active:scale-95"
					>
						▶ JUGAR
					</Link>
					<Link href="/" className="text-xs text-white/50 transition-colors hover:text-white">← Volver a las tasas</Link>
				</div>

			</div>
		</div>
	)
}
