import { Barlow } from 'next/font/google'
import './globals.css'

const barlow = Barlow({ weight: ['500', '800', '900'], subsets: ['latin'] })

export const metadata = {
	title: 'Tasa de cambio CUP, MLC, CLASICA y ETECSA en tiempo real',
	description: 'Obtén la tasa de cambio CUP, MLC, CLASICA y ETECSA de Cuba en tiempo real',
	keywords: ['Cambio CUP', 'Tasa CUP USD', 'Cambio MLC USD', 'Cambio CLASICA USD', 'Cambio ETECSA USD', 'Cambio CUP Cuba', 'Cambio MLC Cuba', 'Cambio CLASICA Cuba', 'Cambio ETECSA Cuba', 'Precio gasolina Cuba', 'Precio GAS Cuba'],
	creator: 'Erich Garcia Cruz',
	metadataBase: new URL('https://www.cambiocup.com'),
	manifest: '/site.webmanifest',
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

// Dentro de la app de QvaPay (mini-app) el SDK `window.QvaPay` existe antes de que cargue la
// página: marcar <html> aquí, antes de pintar, deja que el CSS (`in-qvapay:`) oculte lo que no
// pinta nada dentro de la app sin parpadeo. El simulador de QvaPay lo inyecta después y avisa
// con `qvapay:ready`. `data-qvapay-bar` marca además que la barra de QvaPay es personalizable
// (app 3.7.0+): el título propio de la página solo se puede quitar si esa barra lo sustituye.
// El SDK del simulador (qvapay.com/dev y la ficha en admin) lo cargamos nosotros, y solo si quien
// nos abre en un iframe es QvaPay: sdk-sim.js define `window.QvaPay` en CUALQUIER iframe, así que
// sin ese filtro el widget embebido en otras webs se comportaría como si estuviera en la app.
// Los hosts son los mismos que acepta sdk-sim.js. Ver app/utils/qvapay.js.
const QVAPAY_FLAG = `(function(){var d=document.documentElement;function m(){var q=window.QvaPay;if(!q)return;d.setAttribute('data-qvapay','');if(q.ui&&q.ui.header)d.setAttribute('data-qvapay-bar','')}m();window.addEventListener('qvapay:ready',m);if(window.parent===window||window.QvaPay)return;try{var a=location.ancestorOrigins,h=new URL(a&&a.length?a[0]:document.referrer).hostname;if(['www.qvapay.com','qvapay.com','localhost','127.0.0.1'].indexOf(h)<0)return;var s=document.createElement('script');s.src='https://www.qvapay.com/miniapps/sdk-sim.js';document.head.appendChild(s)}catch(e){}})()`

export default function RootLayout({ children }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Script en línea a propósito (no next/script): tiene que correr antes de pintar */}
				<script dangerouslySetInnerHTML={{ __html: QVAPAY_FLAG }} />
			</head>
			<body className={barlow.className}>{children}</body>
		</html>
	)
}
