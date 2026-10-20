import { NextResponse } from 'next/server'
import { qvapayConfigured, verifyInitData, verifiedName, signQvaPaySession, MINI_APP_SLUG } from '@/lib/qvapay'

// GET → ¿está activo el login con QvaPay? La UI lo pregunta antes de enseñar el botón,
// para no abrir el permiso nativo de QvaPay y fallar después con un 503.
export async function GET() {
	return NextResponse.json({ enabled: qvapayConfigured() })
}

// POST { init_data } → sesión de cambiocup con el @usuario verificado de QvaPay.
// Un init_data de otra App de QvaPay o de otra mini-app no vale aunque la firma sea buena.
export async function POST(request) {

	if (!qvapayConfigured()) { return NextResponse.json({ error: 'Login con QvaPay no disponible' }, { status: 503 }) }

	let initData = ''
	try { initData = (await request.json())?.init_data || '' } catch { initData = '' }

	const check = verifyInitData(initData, process.env.QVAPAY_APP_SECRET)
	if (!check.ok) { return NextResponse.json({ error: 'No se pudo verificar tu cuenta de QvaPay', reason: check.reason }, { status: 401 }) }
	if (check.data.app_uuid !== process.env.QVAPAY_APP_UUID || check.data.mini_app !== MINI_APP_SLUG) {
		return NextResponse.json({ error: 'No se pudo verificar tu cuenta de QvaPay', reason: 'wrong_app' }, { status: 401 })
	}

	const uuid = check.data.user?.uuid
	const name = verifiedName(check.data.user?.username)
	// Sin el permiso de perfil no viaja el username, y el ranking necesita un nombre
	if (!uuid || !name) { return NextResponse.json({ error: 'Hace falta el permiso de perfil de QvaPay para el ranking' }, { status: 400 }) }

	const { token, exp } = signQvaPaySession({ uuid, name })
	return NextResponse.json({ token, name, exp })
}
