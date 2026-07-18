import { Barlow } from 'next/font/google'
import './globals.css'

const barlow = Barlow({ weight: ['500', '800', '900'], subsets: ['latin'] })

export const metadata = {
	title: 'Tasa de cambio CUP, MLC, CLASICA y ETECSA en tiempo real',
	description: 'Obtén la tasa de cambio CUP, MLC, CLASICA y ETECSA de Cuba en tiempo real',
	keywords: ['Cambio CUP', 'Tasa CUP USD', 'Cambio MLC USD', 'Cambio CLASICA USD', 'Cambio ETECSA USD', 'Cambio CUP Cuba', 'Cambio MLC Cuba', 'Cambio CLASICA Cuba', 'Cambio ETECSA Cuba', 'Precio gasolina Cuba', 'Precio GAS Cuba'],
	creator: 'Erich Garcia Cruz',
	metadataBase: new URL('https://www.cambiocup.com'),
	openGraph: {
		title: 'Tasa de cambio CUP, MLC, CLASICA y ETECSA de Cuba en tiempo real',
		description: 'Obtén la tasa de cambio CUP, MLC, CLASICA y ETECSA de Cuba en tiempo real',
		url: 'https://www.cambiocup.com',
		siteName: 'Cambiocup.com',
		images: [
			{
				url: 'https://www.cambiocup.com/api/og',
				width: 1200,
				height: 630,
			},
		],
		locale: 'es_ES',
		type: 'website',
	},
	icons: {
		icon: '/favicon.ico',
		shortcut: '/favicon-32x32.png',
		apple: '/apple-touch-icon.png',
	},
	twitter: {
		card: 'summary_large_image',
		creator: '@erichgarciacruz',
	},
}

export default function RootLayout({ children }) {
	return (
		<html lang="en">
			<body className={barlow.className}>{children}</body>
		</html>
	)
}
