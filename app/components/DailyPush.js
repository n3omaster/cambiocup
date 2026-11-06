'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { inQvaPay } from '@/app/utils/qvapay'
import { syncPush, enablePush, disablePush, shouldPrompt, snoozePrompt } from '@/app/utils/push'

const PROMPT_DELAY_MS = 3000

// Interruptor del aviso diario en el pie de la home, y el aviso que lo ofrece a los 3 s. Pedir el
// permiso del navegador solo tras "Si, dale!" evita gastar su diálogo con quien iba a decir que no:
// si lo rechaza en el navegador, la web ya no puede volver a preguntarle.
export default function DailyPush() {
	const [state, setState] = useState('unsupported')
	const [prompting, setPrompting] = useState(false)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		// La app de QvaPay no tiene push web
		if (inQvaPay()) return
		let timer
		let cancelled = false
		syncPush().then((next) => {
			if (cancelled) return
			setState(next)
			if (shouldPrompt(next)) timer = setTimeout(() => setPrompting(true), PROMPT_DELAY_MS)
		})
		return () => { cancelled = true; clearTimeout(timer) }
	}, [])

	const run = async (action) => {
		setPrompting(false)
		setBusy(true)
		setState(await action())
		setBusy(false)
	}

	if (state === 'unsupported' || state === 'denied') return null

	return (
		<>
			<button
				type="button"
				disabled={busy}
				onClick={() => run(state === 'on' ? disablePush : enablePush)}
				className="underline hover:text-white transition-colors disabled:opacity-60"
			>
				{/* La primera suscripción puede tardar decenas de segundos: el aviso ya se cerró y sin esto no pasaría nada visible */}
				{busy ? 'Un momento...' : state === 'on' ? 'Desactivar aviso diario' : 'Recibir aviso diario'}
			</button>

			{prompting && createPortal(
				<div className="fixed inset-x-4 bottom-4 z-40 flex justify-center sm:bottom-8">
					<div role="dialog" aria-label="Aviso diario de tasas" className="w-full max-w-md rounded-3xl liquid-glass liquid-glass--dark p-5 text-white">
						<p className="font-medium leading-snug">¿Quieres que te enviemos una notificación a diario con las tasas de CUP y MLC? ¡GRATIS!</p>
						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => { snoozePrompt(); setPrompting(false) }}
								className="rounded-2xl px-4 py-2 text-sm font-bold text-white/70 hover:text-white transition-colors"
							>
								No gracias...
							</button>
							<button
								type="button"
								onClick={() => run(enablePush)}
								className="rounded-2xl bg-white px-4 py-2 text-sm font-bold text-black hover:scale-105 active:scale-95 transition-transform"
							>
								Si, dale!
							</button>
						</div>
					</div>
				</div>,
				document.body,
			)}
		</>
	)
}
