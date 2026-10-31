export function createTeamApi(getToken) {
  return async function teamApi(team) {
    const api = import.meta.env.VITE_API_URL
    if (!api) throw new Error('The team API is not configured. Set VITE_API_URL and rebuild the app.')
    const token = await getToken()
    if (!token) throw new Error('Your session expired. Sign in again to access your team.')
    const response = await fetch(`${api.replace(/\/$/, '')}/api/team`, {
      method: team === undefined ? 'GET' : 'PUT',
      headers: { Authorization: `Bearer ${token}`, ...(team === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(team === undefined ? {} : { body: JSON.stringify({ name: team.name, logoDataUrl: team.logoDataUrl, version: team.version, players: team.players.map(({ id, name, jerseyNumber }) => ({ id, name, jerseyNumber: jerseyNumber ?? null })) }) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new Error(result?.error || `Team request failed (${response.status}). Please try again.`)
    if (!result || !Object.hasOwn(result, 'team')) throw new Error('Unexpected team response. Please try again.')
    return result.team
  }
}
