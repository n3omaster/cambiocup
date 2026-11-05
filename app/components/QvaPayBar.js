'use client'

import { useQvaPayBar } from '@/app/utils/qvapay'

// La barra de QvaPay para páginas de servidor. Fuera de la app no pinta ni hace nada.
export default function QvaPayBar(props) {
	useQvaPayBar(props)
	return null
}
