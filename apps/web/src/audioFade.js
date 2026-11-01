export async function ensureAudioGain(element, graphRef) {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext || !element) return null
  if (!graphRef.current) {
    const context = new AudioContext()
    const source = context.createMediaElementSource(element)
    const gain = context.createGain()
    source.connect(gain).connect(context.destination)
    graphRef.current = { context, gain }
  }
  if (graphRef.current.context.state === 'suspended') await graphRef.current.context.resume()
  return graphRef.current
}

export function scheduleAudioFade(graph, duration, fadeIn, fadeOut) {
  if (!graph) return
  const { context, gain } = graph
  const now = context.currentTime
  const length = Math.max(.1, Number(duration) || 0)
  const fadeLength = Math.min(1.5, length / 3)
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(fadeIn ? .0001 : 1, now)
  if (fadeIn) gain.gain.linearRampToValueAtTime(1, now + fadeLength)
  if (fadeOut) {
    gain.gain.setValueAtTime(1, now + Math.max(fadeLength, length - fadeLength))
    gain.gain.linearRampToValueAtTime(.0001, now + length)
  }
}

export function resetAudioGain(graph) {
  if (!graph) return
  const now = graph.context.currentTime
  graph.gain.gain.cancelScheduledValues(now)
  graph.gain.gain.setValueAtTime(1, now)
}
