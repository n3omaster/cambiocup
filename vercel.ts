import type { VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
	framework: 'nextjs',
	crons: [
		{ path: '/api/cron', schedule: '*/10 * * * *' },
		// 9:00 en La Habana son las 13:00 o las 14:00 UTC según el horario de Cuba. La ruta decide
		// por la hora local y el día ya enviado, así que el cron puede correr de sobra sin repetir
		{ path: '/api/push/daily', schedule: '*/10 13-15 * * *' },
	],
}
