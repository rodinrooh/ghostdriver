import { createSign } from 'crypto'

export const runtime = 'nodejs'

function signJWT(pem: string, teamId: string, keyId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: now, exp: now + 3600 })).toString('base64url')
  const unsigned = `${header}.${payload}`
  const sign = createSign('SHA256')
  sign.update(unsigned)
  const sig = sign.sign({ key: pem, dsaEncoding: 'ieee-p1363' })
  return `${unsigned}.${Buffer.from(sig).toString('base64url')}`
}

export async function GET() {
  const teamId = process.env.MAPKIT_TEAM_ID!
  const keyId = process.env.MAPKIT_KEY_ID!
  const pem = Buffer.from(process.env.MAPKIT_PRIVATE_KEY_B64!, 'base64').toString('utf8')
  const token = signJWT(pem, teamId, keyId)
  return Response.json({ token }, { headers: { 'Cache-Control': 'private, max-age=3000' } })
}
