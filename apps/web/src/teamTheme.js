const DEFAULT_COLOR = '#041c36'

export function createTeamTheme(value) {
  const color = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR
  function mix(target, amount) {
    const channels = [1, 3, 5].map(offset => Math.round(parseInt(color.slice(offset, offset + 2), 16) * (1 - amount) + parseInt(target.slice(offset, offset + 2), 16) * amount))
    return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
  }
  // Tint dark surfaces and lighten accents so black/white choices stay usable.
  return {
    '--team-color': color,
    '--team-panel': mix('#041c36', .84),
    '--team-panel-bright': mix('#041c36', .65),
    '--team-accent': mix('#ffffff', .4),
    '--team-border': mix('#ffffff', .2),
    '--team-jersey': mix('#041c36', .4),
    '--team-glow': `${mix('#ffffff', .2)}55`,
  }
}
