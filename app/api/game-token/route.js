import { NextResponse } from 'next/server'
import { issueToken } from '@/lib/gameToken'

export const dynamic = 'force-dynamic'

// GET → signed run token. The client requests one the moment a run starts and
// sends it back with the score; its age lets /api/game-score bound how long the
// run really lasted (a curl'd score with a fresh token is physically impossible).
export async function GET() { return NextResponse.json({ token: issueToken() }, { headers: { 'Cache-Control': 'no-store' } }) }
