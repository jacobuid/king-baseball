export function createMusicApi(getToken) {
  return async (path = '', body, method) => {
    const base = import.meta.env.VITE_API_URL
    if (!base) throw new Error('The music API is not configured.')
    const token = await getToken()
    if (!token) throw new Error('Sign in again to access your music.')
    const response = await fetch(`${base.replace(/\/$/, '')}/api/music${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', signal: AbortSignal.timeout(30000),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error || 'Music request failed. Please try again.')
    return result
  }
}
export function mergeMusic(team, local, music) {
  const byId = new Map(music.tracks.map(track => [track.id, track]))
  return { ...team, teamSongs: (music.assignments.team || []).map(id => byId.get(id)).filter(Boolean), players: team.players.map(player => {
    const assignment = music.assignments[player.id]?.[0]
    const id = typeof assignment === 'string' ? assignment : assignment?.id
    const track = id ? byId.get(id) : null
    const intro = typeof assignment === 'object' && assignment.introId ? byId.get(assignment.introId) : null
    const song = track ? { ...track, clipStart: typeof assignment === 'object' ? assignment.start : 0, clipDuration: typeof assignment === 'object' ? assignment.duration : Math.min(15, track.duration || 15), intro: intro || null } : null
    return { ...player, song: song || (Object.hasOwn(music.assignments, player.id) ? null : local?.players?.find(p => p.id === player.id)?.song || null) }
  }) }
}
