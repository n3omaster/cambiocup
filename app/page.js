'use client'

import OneSignal from 'react-onesignal'
import NumberFlow from '@number-flow/react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState, useEffect, useCallback, useMemo } from 'react'

// Components
import FloatingOffers from './components/FloatingOffers'
import BackgroundLiveLine from './components/BackgroundLiveLine'

// Utils
import { randomize, averageData } from './utils/helpers'

// Config
const COIN_CONFIG = {
	CUP: { historyKey: 'cupHistory', decimals: 2, deep: 0.5 },
	MLC: { historyKey: 'mlcHistory', decimals: 3, deep: 0.009 },
	CLASICA: { historyKey: 'clasicaHistory', decimals: 3, deep: 0.005 },
	ETECSA: { historyKey: 'etecsaHistory', decimals: 2, deep: 0.5 },
	TROPICAL: { historyKey: 'bandecprepagoHistory', decimals: 2, deep: 0.5 },
}

const COINS = Object.keys(COIN_CONFIG)

function HomeContent() {

	const searchParams = useSearchParams()
	const noCode = searchParams.get('nocode') === 'true'

	const [coin, setCoin] = useState('CUP')
	const [value, setValue] = useState(0)
	const [bgColor, setBgColor] = useState('bg-crimson')
	const [showModal, setShowModal] = useState(false)
	const [copied, setCopied] = useState(false)

	const decimals = COIN_CONFIG[coin].decimals

	useEffect(() => {
		OneSignal.init({ appId: '04dffeef-fbcd-4c21-95fc-eb358400eff2' })
	}, [])

	useEffect(() => {

		const config = COIN_CONFIG[coin]

		const tick = async () => {
			try {

				const response = await fetch('/api')
				const data = await response.json()

				const history = data[config.historyKey]
				if (!history?.length) return

				const { first, average } = averageData(history)
				const number = Number.parseFloat(randomize(first.value, config.deep))

				setValue(number)
				setBgColor(number < average ? 'bg-malachite' : 'bg-crimson')

			} catch (err) { console.error('Error fetching rates:', err) }
		}

		tick()
		const interval = setInterval(tick, 4000)
		return () => clearInterval(interval)
	}, [coin])

	useEffect(() => {
		if (!showModal) return
		const handleEscape = (e) => { if (e.key === 'Escape') setShowModal(false) }
		window.addEventListener('keydown', handleEscape)
		return () => window.removeEventListener('keydown', handleEscape)
	}, [showModal])

	const iframeCode = `<iframe src="${typeof window !== 'undefined' ? window.location.origin : 'https://www.cambiocup.com'}" width="100%" height="600" frameborder="0" allowfullscreen style="border-radius: 5px;"></iframe>`

	const copyToClipboard = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(iframeCode)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch (err) { console.error('Error al copiar:', err) }
	}, [iframeCode])

	const numberFormat = useMemo(() => ({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }), [decimals])

	return (
		<>
			<FloatingOffers />
			<main className={bgColor + " flex min-h-screen flex-col justify-between p-4 sm:p-8 md:p-12 relative z-20"}>
				<BackgroundLiveLine coin={coin} value={value} opacity={0.18} />
				<div className='flex flex-col sm:flex-row justify-between items-center gap-2 sm:gap-0 text-xs sm:text-sm md:text-base'>
					<h1 className="text-center sm:text-left text-lg sm:text-xl md:text-2xl">Tasas de Cambio en Cuba</h1>
					{!noCode && (
						<button
							type="button"
							onClick={() => setShowModal(true)}
							className="text-white hover:opacity-80 transition-opacity p-2 rounded-lg bg-white/10 backdrop-blur-sm hover:bg-white/20"
							aria-label="Código iframe"
							title="Obtener código iframe"
						>
							<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 sm:h-7 sm:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
							</svg>
						</button>
					)}
				</div>
				<div className="flex-1 flex flex-col items-center justify-center px-2 sm:px-4">
					<div className="flex justify-center items-center flex-wrap gap-2 sm:gap-3 md:gap-4 mb-4 sm:mb-6">
						<p className='text-2xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl text-white font-black flex flex-wrap justify-center items-center gap-2 sm:gap-3 md:gap-4'>
							{COINS.map((name) => (
								<button
									key={name}
									type="button"
									onClick={() => setCoin(name)}
									className={`${coin === name ? "" : "opacity-70 blur-xs"} text-white transition-all hover:opacity-80 whitespace-nowrap bg-transparent`}
								>
									{name}
								</button>
							))}
						</p>
					</div>
					<h2 className="text-6xl sm:text-8xl md:text-8xl lg:text-[10rem] xl:text-[12rem] font-extrabold text-white text-center">
						<NumberFlow
							value={value}
							format={numberFormat}
							prefix="$"
							transformTiming={{ duration: 500, easing: 'ease-out' }}
							spinTiming={{ duration: 500, easing: 'ease-out' }}
							opacityTiming={{ duration: 350, easing: 'ease-out' }}
						/>
					</h2>
				</div>

				<div className='flex flex-col sm:flex-row justify-between items-center gap-2 sm:gap-0 text-xs sm:text-sm md:text-base'>
					<div className='text-center sm:text-left'><p suppressHydrationWarning>{new Date().getFullYear()} - Todos los derechos reservados</p></div>
					<div className='flex items-center gap-4'>
						<a href='https://x.com/qvapay' target='_blank' rel='noopener noreferrer' className='hover:opacity-80 transition-opacity' aria-label='X (Twitter)'>
							<svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
								<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
							</svg>
						</a>
						<a href='https://github.com/n3omaster/cambiocup' target='_blank' rel='noopener noreferrer' className='hover:opacity-80 transition-opacity' aria-label='GitHub'>
							<svg className="size-5" fill="currentColor" viewBox="0 0 24 24">
								<path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
							</svg>
						</a>
					</div>
					<div className='text-center sm:text-right'><p>Cambio CUP - Un servicio gratuito de <a href='https://qvapay.com' className='underline hover:opacity-80'>QvaPay</a></p></div>
				</div>
			</main>

			{/* Modal */}
			{showModal && (
				<div
					className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
					role="button"
					tabIndex={0}
					aria-label="Cerrar modal"
					onClick={() => setShowModal(false)}
					onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowModal(false) }}
				>
					<div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative z-10 opacity-100" style={{ backgroundColor: '#ffffff' }} onClick={(e) => e.stopPropagation()} >
						<div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-20" style={{ backgroundColor: '#ffffff' }}>
							<h3 className="text-xl font-bold" style={{ color: '#111827' }}>Insertar la tasa en tu sitio web</h3>
							<button type="button" onClick={() => setShowModal(false)} className="hover:opacity-70 transition-colors" style={{ color: '#6b7280' }} aria-label="Cerrar modal">
								<svg xmlns="http://www.w3.org/2000/svg" className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						</div>
						<div className="p-6" style={{ backgroundColor: '#ffffff' }}>
							<p className="mb-4 text-sm" style={{ color: '#111827' }}>
								Copia y pega este código HTML en tu página web para insertar este widget:
							</p>
							<div className="relative">
								<pre className="border border-gray-200 p-4 rounded-lg whitespace-pre-wrap break-all text-sm" style={{ backgroundColor: '#f9fafb', color: '#111827' }}>
									<code style={{ color: '#111827' }}>{iframeCode}</code>
								</pre>
								<button type="button" onClick={copyToClipboard} className="absolute top-2 right-2 p-2 rounded-md transition-all flex items-center justify-center bg-yale_blue/65 hover:bg-yale_blue backdrop-blur-sm shadow-sm" style={{ color: '#ffffff' }} aria-label={copied ? '¡Copiado!' : 'Copiar'} title={copied ? '¡Copiado!' : 'Copiar'}>
									{copied ? (
										<svg xmlns="http://www.w3.org/2000/svg" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
										</svg>
									) : (
										<svg xmlns="http://www.w3.org/2000/svg" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										</svg>
									)}
								</button>
							</div>
							<div className="mt-4 p-4 rounded-lg border border-gray-200" style={{ backgroundColor: '#f9fafb' }}>
								<p className="text-sm" style={{ color: '#111827' }}>
									<strong>💡 Tip:</strong> Puedes ajustar el ancho (width) y alto (height) del iframe según tus necesidades.
								</p>
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	)
}

export default function Home() {
	return (
		<Suspense fallback={null}>
			<HomeContent />
		</Suspense>
	)
}
