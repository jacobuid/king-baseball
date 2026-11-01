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
    const id = music.assignments[player.id]?.[0]
    return { ...player, song: id ? byId.get(id) || null : Object.hasOwn(music.assignments, player.id) ? null : local?.players?.find(p => p.id === player.id)?.song || null }
  }) }
}
