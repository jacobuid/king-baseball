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

export function setAudioGain(graph, value) {
  if (!graph) return
  graph.gain.gain.setValueAtTime(Math.max(.0001, Math.min(1, value)), graph.context.currentTime)
}

export function overlapMusicLevel(timelineTime, announcementStart, announcementDuration, overlapReduction) {
  const reduction = Math.max(0, Math.min(.9, overlapReduction))
  if (!reduction || !announcementDuration) return 1
  const attack = .25
  const release = 1
  const end = announcementStart + announcementDuration
  if (timelineTime < announcementStart - attack || timelineTime >= end + release) return 1
  if (timelineTime < announcementStart) return 1 - reduction * ((timelineTime - (announcementStart - attack)) / attack)
  if (timelineTime < end) return 1 - reduction
  return 1 - reduction + reduction * ((timelineTime - end) / release)
}

export function audioEnvelopeLevel(elapsed, duration, fadeIn, fadeOut, overlapLevel = 1) {
  const length = Math.max(.1, Number(duration) || 0)
  const fadeLength = Math.min(1.5, length / 3)
  const remaining = length - elapsed
  const fadeLevel = Math.max(0, Math.min(1, fadeIn ? elapsed / fadeLength : 1, fadeOut ? remaining / fadeLength : 1))
  return fadeLevel * Math.max(.1, Math.min(1, overlapLevel))
}
