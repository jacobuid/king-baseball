export function createTeamApi(getToken) {
  async function request(path, options = {}) {
    const api = import.meta.env.VITE_API_URL
    if (!api) throw new Error('The team API is not configured. Set VITE_API_URL and rebuild the app.')
    const token = await getToken()
    if (!token) throw new Error('Your session expired. Sign in again to access your team.')
    const response = await fetch(`${api.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error || `Team request failed (${response.status}). Please try again.`)
    return result
  }
  async function teamApi(team, teamId, createNew = false) {
    const query = teamId ? `?id=${encodeURIComponent(teamId)}` : createNew ? '?new=1' : ''
    const result = await request(`/api/team${query}`, team === undefined ? {} : {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: team.name, primaryColor: team.primaryColor, division: team.division, logoDataUrl: team.logoDataUrl, version: team.version, players: team.players.map(({ id, name, jerseyNumber }) => ({ id, name, jerseyNumber: jerseyNumber ?? null })) }),
    })
    if (!result || !Object.hasOwn(result, 'team')) throw new Error('Unexpected team response. Please try again.')
    return result.team
  }
  teamApi.list = async () => (await request('/api/teams')).teams || []
  teamApi.remove = async teamId => request(`/api/team?id=${encodeURIComponent(teamId)}`, { method: 'DELETE' })
  return teamApi
}
