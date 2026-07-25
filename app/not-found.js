import Link from 'next/link'
import Image from 'next/image'

export const metadata = {
	title: 'Página no encontrada | CambioCUP',
	description: 'Esta página no existe, pero las tasas de cambio de Cuba en tiempo real y el juego CUP Runner te esperan.',
}

export default function NotFound() {
	return (
		<main className="bg-delft_blue flex min-h-screen flex-col items-center justify-center p-4 sm:p-8 md:p-12 relative z-20 overflow-hidden">

			{/* Ambient light + vignette */}
			<div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
				<div className="absolute -top-1/4 left-1/2 h-[70vh] w-[90vw] -translate-x-1/2 rounded-full bg-white/15 blur-[120px]" />
				<div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/25" />
			</div>

			<div className="relative z-10 flex flex-col items-center text-center px-2 sm:px-4">

				<span className="inline-flex items-center gap-2 rounded-full liquid-glass px-4 py-1.5 text-xs sm:text-sm font-medium text-white/90 mb-6 sm:mb-8">
					<span className="relative flex size-2">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-crimson-600 opacity-75" />
						<span className="relative inline-flex size-2 rounded-full bg-crimson-600" />
					</span>
					Página no encontrada
				</span>

				<h1 className="text-8xl sm:text-9xl md:text-[10rem] lg:text-[12rem] font-extrabold text-white tracking-tighter drop-shadow-[0_10px_50px_rgba(0,0,0,0.3)] leading-none">
					404
				</h1>

				<p className="mt-4 sm:mt-6 max-w-md text-sm sm:text-base md:text-lg text-white/80 font-medium">
					Esta tasa no cotiza en ningún mercado. Pero no te vayas con las manos vacías:
				</p>

				<div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-2xl">
					<Link
						href="/"
						className="group flex flex-col rounded-3xl liquid-glass p-3 text-white text-left"
					>
						<span className="block overflow-hidden rounded-2xl border border-white/20">
							<Image
								src="/api/og"
								alt="Vista previa de las tasas de cambio en tiempo real"
								width={1200}
								height={630}
								unoptimized
								className="w-full h-auto brightness-90 group-hover:brightness-110 transition-[filter] duration-300"
							/>
						</span>
						<span className="flex items-center gap-2 px-2 pt-3 pb-1">
							<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
							</svg>
							<span className="flex flex-col">
								<span className="text-base sm:text-lg font-bold tracking-tight">Ver las tasas</span>
								<span className="text-xs sm:text-sm text-white/70 font-medium">CUP, MLC, CLASICA y más en tiempo real</span>
							</span>
						</span>
					</Link>

					<Link
						href="/play"
						className="group flex flex-col rounded-3xl liquid-glass p-3 text-white text-left"
					>
						<span className="block overflow-hidden rounded-2xl border border-white/20">
							<Image
								src="/api/og/play"
								alt="Vista previa del juego CUP Runner"
								width={1200}
								height={630}
								unoptimized
								className="w-full h-auto brightness-90 group-hover:brightness-110 transition-[filter] duration-300"
							/>
						</span>
						<span className="flex items-center gap-2 px-2 pt-3 pb-1">
							<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
								<path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l11.2-6.86a1.03 1.03 0 000-1.76L9.56 4.26A1.03 1.03 0 008 5.14z" />
							</svg>
							<span className="flex flex-col">
								<span className="text-base sm:text-lg font-bold tracking-tight">Jugar CUP Runner</span>
								<span className="text-xs sm:text-sm text-white/70 font-medium">Surfea la historia real de la tasa</span>
							</span>
						</span>
					</Link>
				</div>
			</div>

			<footer className="absolute bottom-4 sm:bottom-8 z-10 text-xs sm:text-sm text-white/60 text-center px-4">
				Cambio CUP - Un servicio gratuito de <a href="https://qvapay.com" className="underline hover:text-white transition-colors">QvaPay</a>
			</footer>
		</main>
	)
}
