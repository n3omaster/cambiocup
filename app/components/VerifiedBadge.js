// Insignia del ranking de CUP Runner: el @ salió de una cuenta de QvaPay verificada (el
// jugador entró con QvaPay dentro de la app), no de un @ de Telegram tecleado a mano.
export default function VerifiedBadge({ className = '' }) {
	return (
		<span className={`inline-flex shrink-0 items-center align-middle ${className}`} title="Verificado con QvaPay">
			<svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
				<circle cx="8" cy="8" r="8" fill="currentColor" className="text-qvapay" />
				<path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			<span className="sr-only">verificado con QvaPay</span>
		</span>
	)
}
