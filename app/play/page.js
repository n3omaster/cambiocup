import Game from './Game'

export const metadata = {
	title: 'CUP Runner — El juego de la tasa | CambioCUP',
	description: 'Surfea la historia real de la tasa de cambio del CUP. Esquiva los picos de las subidas y los huecos de las caídas del mercado. ¿Cuántos días sobrevives?',
	openGraph: {
		title: 'CUP Runner — El juego de la tasa | CambioCUP',
		description: '¿Cuántos días sobrevives surfeando la tasa real del CUP?',
		images: [{ url: '/api/og/play', width: 1200, height: 630, alt: 'CUP Runner — surfea la historia real del dólar en Cuba' }],
	},
	twitter: {
		card: 'summary_large_image',
		title: 'CUP Runner — El juego de la tasa | CambioCUP',
		description: '¿Cuántos días sobrevives surfeando la tasa real del CUP?',
		images: ['/api/og/play'],
	},
}

export default function PlayPage() { return <Game /> }
