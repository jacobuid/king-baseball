type TeamRow = { id: string; name: string; version: number; mutation_id: string; logo_data_url: string | null; created_at: string; updated_at: string }
type PlayerInput = { id: string; name: string; jerseyNumber: string | null }
type TeamInput = { name: string; version: number; players: PlayerInput[]; logoDataUrl?: string | null }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export function validateTeam(body: unknown): TeamInput | string {
  if (!body || typeof body !== 'object') return 'Invalid team data'
  const input = body as Record<string, unknown>
  if (typeof input.name !== 'string') return 'Enter a team name'
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (!name || name.length > 48) return 'Team name must be 1–48 characters'
  if (!Number.isSafeInteger(input.version) || (input.version as number) < 0) return 'Invalid team version'
  if (!Array.isArray(input.players) || input.players.length < 1 || input.players.length > 100) return 'A team must have 1–100 players'
  if (input.logoDataUrl !== undefined && input.logoDataUrl !== null) {
    if (typeof input.logoDataUrl !== 'string' || input.logoDataUrl.length > 180000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.logoDataUrl)) return 'Choose a PNG, JPG, or WebP team logo'
    const [header, encoded] = input.logoDataUrl.split(',')
    let bytes: string
    try { bytes = atob(encoded) } catch { return 'Invalid team logo' }
    const valid = header.includes('/png') ? bytes.startsWith('\x89PNG\r\n\x1a\n') : header.includes('/jpeg') ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
    if (!valid) return 'Invalid team logo image'
  }
  const players: PlayerInput[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const player of input.players) {
    if (!player || typeof player !== 'object' || typeof player.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(player.id)) return 'Invalid player ID'
    if (typeof player.name !== 'string') return 'Enter a player name'
    const playerName = player.name.trim().replace(/\s+/g, ' ')
    if (!playerName || playerName.length > 55) return 'Player names must be 1–55 characters'
    if (ids.has(player.id) || names.has(playerName.toLowerCase())) return 'Duplicate player in roster'
    ids.add(player.id)
    names.add(playerName.toLowerCase())
    // Deliberately select only roster fields. Music never enters this data model.
    const jerseyNumber = player.jerseyNumber ?? null
    if (jerseyNumber !== null && (typeof jerseyNumber !== 'string' || !/^\d{2}$/.test(jerseyNumber))) return 'Jersey numbers must be two digits from 00 to 99'
    players.push({ id: player.id, name: playerName, jerseyNumber })
  }
  return { name, version: input.version as number, players, logoDataUrl: input.logoDataUrl as string | null | undefined }
}

async function readTeam(db: D1Database, userId: string) {
  const result = await db.batch([
    db.prepare('SELECT id,name,version,logo_data_url AS logoDataUrl,created_at,updated_at FROM teams WHERE owner_user_id = ?').bind(userId),
    db.prepare('SELECT p.id,p.name,p.jersey_number AS jerseyNumber,p.roster_order AS rosterOrder FROM players p JOIN teams t ON t.id = p.team_id WHERE t.owner_user_id = ? ORDER BY p.roster_order').bind(userId),
  ])
  const team = result[0].results[0]
  return team ? { ...team, players: result[1].results } : null
}

export async function handleTeamRequest(request: Request, db: D1Database, userId: string): Promise<Response> {
  if (request.method === 'GET') return json({ team: await readTeam(db, userId) })
  if (request.method !== 'PUT') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { Allow: 'GET, PUT', 'Content-Type': 'application/json' } })
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Use application/json' }, 415)
  // Bound the complete body, including unknown fields, before parsing it.
  const reader = request.body?.getReader()
  if (!reader) return json({ error: 'Missing request body' }, 400)
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 256 * 1024) { await reader.cancel(); return json({ error: 'Team data is too large' }, 413) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { return json({ error: 'Invalid JSON' }, 400) }
  const input = validateTeam(body)
  if (typeof input === 'string') return json({ error: input }, 400)

  const existing = await db.prepare('SELECT id,name,version,mutation_id,logo_data_url FROM teams WHERE owner_user_id = ?').bind(userId).first<TeamRow>()
  if ((!existing && input.version !== 0) || (existing && input.version !== existing.version)) return json({ error: 'This team changed in another session. Reload the saved team before saving again.' }, 409)
  const teamId = existing?.id || crypto.randomUUID()
  const mutationId = crypto.randomUUID()
  const logoDataUrl = input.logoDataUrl === undefined ? existing?.logo_data_url ?? null : input.logoDataUrl
  const statements = existing ? [
    db.prepare('UPDATE teams SET name = ?,logo_data_url = ?,version = version + 1,mutation_id = ?,updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ? AND version = ?').bind(input.name, logoDataUrl, mutationId, teamId, userId, input.version),
  ] : [
    db.prepare('INSERT INTO teams(id,owner_user_id,name,mutation_id,logo_data_url) VALUES(?,?,?,?,?) ON CONFLICT(owner_user_id) DO NOTHING').bind(teamId, userId, input.name, mutationId, logoDataUrl),
  ]
  // All roster writes are conditional on this save winning the version check.
  // D1 executes the batch transactionally, including deletions and insertions.
  statements.push(db.prepare('DELETE FROM players WHERE team_id = ? AND EXISTS(SELECT 1 FROM teams WHERE id = ? AND owner_user_id = ? AND mutation_id = ?)').bind(teamId, teamId, userId, mutationId))
  input.players.forEach((player, order) => {
    statements.push(db.prepare('INSERT INTO players(team_id,id,name,roster_order,jersey_number) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM teams WHERE id = ? AND owner_user_id = ? AND mutation_id = ?)').bind(teamId, player.id, player.name, order, player.jerseyNumber, teamId, userId, mutationId))
  })
  const results = await db.batch(statements)
  if (results[0].meta.changes !== 1) return json({ error: 'This team changed in another session. Reload the saved team before saving again.' }, 409)
  // Return this mutation's result, rather than a separate read which could race a later save.
  return json({ team: { id: teamId, name: input.name, logoDataUrl, version: input.version + 1, players: input.players.map((player, rosterOrder) => ({ ...player, rosterOrder })) } }, existing ? 200 : 201)
}
