import React, { useEffect, useRef, useState } from 'react'
import { Icon, Modal } from './ui'
import { audioEnvelopeLevel, ensureAudioGain, resetAudioGain, setAudioGain } from './audioFade'

const time = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : ''
const audioTypes = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav' }
function audioMetadata(file) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio')
    const url = URL.createObjectURL(file)
    const done = value => { URL.revokeObjectURL(url); audio.removeAttribute('src'); audio.load(); value() }
    const timer = setTimeout(() => done(() => reject(new Error('Could not read this audio file.'))), 12000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => { clearTimeout(timer); const duration = audio.duration; done(() => Number.isFinite(duration) && duration > 0 ? resolve(duration) : reject(new Error('Could not determine the audio duration.'))) }
    audio.onerror = () => { clearTimeout(timer); done(() => reject(new Error('This audio file could not be opened.'))) }
    audio.src = url
  })
}
async function playRecordingCue() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) { await new Promise(resolve => setTimeout(resolve, 450)); return }
  const context = new AudioContext()
  try {
    await context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + .12)
    gain.gain.setValueAtTime(.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(.22, context.currentTime + .02)
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .38)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + .4)
    await new Promise(resolve => setTimeout(resolve, 520))
  } finally { await context.close().catch(() => {}) }
}
const assignmentId = entry => typeof entry === 'string' ? entry : entry?.id
const clampClip = (track, start, duration) => {
  const total = Math.max(3, Number(track?.duration) || 15)
  const nextStart = Math.min(Math.max(0, Number(start) || 0), Math.max(0, total - 3))
  return { start: Math.round(nextStart * 10) / 10, duration: Math.round(Math.min(Math.max(3, Number(duration) || 15), 60, total - nextStart) * 10) / 10 }
}
function SectionToggle({ label, checked, open, onToggle, onOpen }) {
  return <div className="walkup-section-toggle"><button type="button" className={`walkup-switch${checked ? ' on' : ''}`} role="switch" aria-checked={checked} aria-label={`${checked ? 'Disable' : 'Enable'} ${label}`} onClick={onToggle}><span /></button><button type="button" className="walkup-section-name" aria-expanded={open} onClick={onOpen}><strong>{label}</strong><Icon name="chevronDown" size={17} /></button></div>
}
function AnnouncerEditor({ player, intro, previewing, recording, countdown, busy, onPreview, onRecord, onIntroUpload }) {
  return <div className="walkup-intro-editor"><div><span>ANNOUNCEMENT</span><strong>{recording ? 'Recording now' : intro ? 'Announcement ready' : 'Record or upload an announcement'}</strong><small>Suggested: “Now batting, {player.jerseyNumber ? `number ${player.jerseyNumber}, ` : ''}{player.name}!”</small></div>{countdown && <div className="recording-countdown" role="status" aria-live="assertive"><strong key={countdown}>{countdown}</strong><span>{countdown === 'GO' ? 'Wait for the ding…' : 'Get ready'}</span></div>}{recording && <div className="recording-live" role="status"><span aria-hidden="true" />Recording</div>}<div className="walkup-intro-actions"><button type="button" className="button-secondary" disabled={busy} onClick={onRecord}><Icon name={recording ? 'stop' : 'microphone'} size={16} />{recording ? 'Stop recording' : intro ? 'Record again' : 'Record announcement'}</button><label className="button-secondary"><Icon name="upload" size={15} />Upload announcement<input type="file" accept="audio/*,.mp3,.m4a,.mp4,.aac,.wav,.webm,.ogg" disabled={busy || recording} onChange={onIntroUpload} /></label></div>{intro && <button type="button" className="walkup-intro-preview button-secondary" disabled={busy || recording} onClick={onPreview}><Icon name={previewing ? 'pause' : 'play'} size={16} />{previewing ? 'Pause preview' : 'Preview announcement'}</button>}</div>
}
function WalkupClipEditor({ track, start, duration, playing, busy, previewDisabled, onStart, onDuration, onPreview }) {
  if (!track) return <p className="walkup-empty-note">Choose a song from Your Music to set the walk-up clip.</p>
  const total = Number(track.duration) || 15
  const maxStart = Math.max(0, total - 3)
  const maxDuration = Math.max(3, Math.min(60, total - start))
  return <section className="walkup-clip-editor" aria-labelledby="walkup-clip-title">
    <div className="walkup-clip-heading"><span className="walkup-clip-icon"><Icon name="music" size={18} /></span><span><h2 id="walkup-clip-title">Music clip</h2><small>{track.title}</small></span></div>
    <label className="walkup-range"><span><strong>Song starts at</strong><output>{time(start)}</output></span><input type="range" min="0" max={maxStart} step="0.5" value={start} onChange={event => onStart(clampClip(track, event.target.value, duration))} /></label>
    <label className="walkup-range"><span><strong>Clip length</strong><output>{Math.round(duration)} sec</output></span><input type="range" min="3" max={maxDuration} step="1" value={duration} onChange={event => onDuration(clampClip(track, start, event.target.value))} /></label>
    <p className="walkup-clip-summary">Uses {time(start)}–{time(start + duration)} from the selected song.</p>
    <button type="button" className="walkup-preview button-secondary" disabled={busy || previewDisabled} onClick={onPreview}><Icon name={playing ? 'stop' : 'play'} size={16} />{playing ? 'Stop preview' : 'Preview music clip'}</button>
  </section>
}
function TimingClip({ label, icon, start, duration, scale, maxStart, onChange }) {
  const drag = useRef(null)
  const move = event => {
    if (!drag.current) return
    const delta = (event.clientX - drag.current.x) / drag.current.width * scale
    onChange(Math.round(Math.min(maxStart, Math.max(0, drag.current.start + delta)) * 10) / 10)
  }
  const stop = event => { if (drag.current) event.currentTarget.releasePointerCapture?.(event.pointerId); drag.current = null }
  return <div className="walkup-timeline-row"><span className="walkup-timeline-label"><Icon name={icon} size={14} />{label}</span><div className="walkup-timeline-lane"><button type="button" className={`walkup-timeline-clip ${icon}`} style={{ left: `${start / scale * 100}%`, width: `${duration / scale * 100}%` }} role="slider" aria-label={`${label} starts at ${time(start)}`} aria-valuemin="0" aria-valuemax={maxStart} aria-valuenow={start} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, width: event.currentTarget.parentElement.clientWidth, start } }} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onChange(Math.min(maxStart, Math.max(0, start + (event.key === 'ArrowRight' ? .5 : -.5)))) } }}><span>{time(start)}</span><strong>{time(duration)}</strong></button></div></div>
}
function BuildWalkup({ introDuration, musicDuration, introStart, musicStart, fadeIn, fadeOut, overlapReduction, playing, busy, onIntroStart, onMusicStart, onFadeIn, onFadeOut, onOverlapReduction, onPreview }) {
  const scale = Math.max(.1, introDuration + musicDuration)
  const introMaxStart = musicDuration
  const musicMaxStart = introDuration
  return <section className="build-walkup"><div className="build-walkup-heading"><span className="walkup-clip-icon"><Icon name="music" size={18} /></span><div><h2>Build Walk-up</h2><p>Drag either clip to control its timing and overlap.</p></div></div><div className="walkup-timeline" style={{ '--timeline-seconds': scale }}><div className="walkup-timeline-ruler"><span>0:00</span><span>{time(scale / 2)}</span><span>{time(scale)}</span></div><TimingClip label="Announcement" icon="microphone" start={Math.min(introStart, introMaxStart)} duration={introDuration} scale={scale} maxStart={introMaxStart} onChange={onIntroStart} /><TimingClip label="Music" icon="music" start={Math.min(musicStart, musicMaxStart)} duration={musicDuration} scale={scale} maxStart={musicMaxStart} onChange={onMusicStart} /></div><div className="walkup-timing-summary"><span>Total timeline</span><strong>{time(scale)}</strong></div><div className="walkup-fades"><div><span><strong>Fade in</strong><small>Ease the music in</small></span><button type="button" className={`walkup-switch${fadeIn ? ' on' : ''}`} role="switch" aria-checked={fadeIn} onClick={() => onFadeIn(!fadeIn)}><span /></button></div><div><span><strong>Fade out</strong><small>Ease the music out</small></span><button type="button" className={`walkup-switch${fadeOut ? ' on' : ''}`} role="switch" aria-checked={fadeOut} onClick={() => onFadeOut(!fadeOut)}><span /></button></div></div><label className="walkup-ducking"><span><strong>Decrease music volume during overlap</strong><output>{Math.round(overlapReduction * 100)}%</output></span><input type="range" min="0" max="90" step="5" value={Math.round(overlapReduction * 100)} onChange={event => onOverlapReduction(Number(event.target.value) / 100)} /></label><button type="button" className="build-walkup-preview button-secondary" disabled={busy} onClick={onPreview}><Icon name={playing ? 'stop' : 'play'} size={16} />{playing ? 'Stop full preview' : 'Preview full walk-up'}</button></section>
}
export function MusicDrawer({ api, target, player, onClose, onAssigned }) {
  const [library, setLibrary] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState([])
  const [searchPreview, setSearchPreview] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [playingTrackId, setPlayingTrackId] = useState(null)
  const [pending, setPending] = useState(null)
  const [retry, setRetry] = useState(0)
  const [pollTick, setPollTick] = useState(0)
  const [closing, setClosing] = useState(false)
  const [clipTrackId, setClipTrackId] = useState(null)
  const [clipStart, setClipStart] = useState(0)
  const [clipDuration, setClipDuration] = useState(15)
  const [clipPlaying, setClipPlaying] = useState(false)
  const [introTrackId, setIntroTrackId] = useState(null)
  const [recording, setRecording] = useState(false)
  const [recordingCountdown, setRecordingCountdown] = useState(null)
  const [announcerEnabled, setAnnouncerEnabled] = useState(false)
  const [musicEnabled, setMusicEnabled] = useState(false)
  const [announcerOpen, setAnnouncerOpen] = useState(false)
  const [musicOpen, setMusicOpen] = useState(false)
  const [getMusicOpen, setGetMusicOpen] = useState(false)
  const [introPlaying, setIntroPlaying] = useState(false)
  const [introStart, setIntroStart] = useState(0)
  const [musicStart, setMusicStart] = useState(0)
  const [fadeIn, setFadeIn] = useState(true)
  const [fadeOut, setFadeOut] = useState(true)
  const [overlapReduction, setOverlapReduction] = useState(.5)
  const active = useRef(true)
  const preview = useRef(null)
  const introPreview = useRef(null)
  const loadedPreviewId = useRef(null)
  const searchPreviewFrame = useRef(null)
  const previewSequence = useRef(0)
  const closeTimer = useRef(null)
  const clipTimer = useRef(null)
  const musicGraph = useRef(null)
  const recorder = useRef(null)
  const recordingStarted = useRef(0)
  const temporaryIntroIds = useRef(new Set())
  useEffect(() => {
    active.current = true
    api().then(data => { if (active.current) {
      setLibrary(data)
      const entries = data.assignments[target] || []
      if (target === 'team') setSelected(entries)
      else {
        const assignment = entries[0]
        const id = assignmentId(assignment)
        const track = data.tracks.find(item => item.id === id)
        const nextIntroId = typeof assignment === 'object' ? assignment.introId || null : null
        setIntroTrackId(nextIntroId); setAnnouncerEnabled(!!nextIntroId); setMusicEnabled(!!track); setAnnouncerOpen(!!nextIntroId); setMusicOpen(!!track)
        if (typeof assignment === 'object') {
          const intro = data.tracks.find(item => item.id === nextIntroId)
          setIntroStart(Number(assignment.introStart) || 0)
          setMusicStart(Number.isFinite(assignment.musicStart) ? assignment.musicStart : Math.max(0, (Number(intro?.duration) || .9) - .9))
          setFadeIn(assignment.fadeIn !== false); setFadeOut(assignment.fadeOut !== false); setOverlapReduction(Number.isFinite(assignment.overlapReduction) ? assignment.overlapReduction : .5)
        }
        if (track) {
          const clip = clampClip(track, typeof assignment === 'object' ? assignment.start : 0, typeof assignment === 'object' ? assignment.duration : 15)
          setClipTrackId(id); setClipStart(clip.start); setClipDuration(clip.duration)
        }
      }
    } }).catch(e => { if (active.current) setError(e.message) })
    return () => { active.current = false; previewSequence.current++; preview.current?.pause(); introPreview.current?.pause(); clearTimeout(closeTimer.current); clearInterval(clipTimer.current); recorder.current?.state === 'recording' && recorder.current.stop() }
  }, [api, target, retry])
  function closeDrawer() {
    if (closing) return
    setClosing(true)
    previewSequence.current++
    preview.current?.pause()
    introPreview.current?.pause()
    clearInterval(clipTimer.current)
    setClipPlaying(false)
    setPlayingTrackId(null)
    for (const id of temporaryIntroIds.current) api(`/${id}`, {}, 'DELETE').catch(() => {})
    temporaryIntroIds.current.clear()
    closeTimer.current = setTimeout(onClose, 220)
  }
  useEffect(() => {
    if (!library?.configured || query.trim().length < 3) { setResults([]); setSearching(false); return }
    let current = true
    setSearching(true)
    setResults([])
    const timer = setTimeout(() => {
      api(`/search?q=${encodeURIComponent(query.trim())}`).then(data => { if (current) { setResults(data.results || []); setError('') } }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setSearching(false) })
    }, 1600)
    return () => { current = false; clearTimeout(timer) }
  }, [api, query, library?.configured])
  useEffect(() => {
    if (!library?.tracks.some(track => ['queued', 'processing'].includes(track.status))) return
    let current = true
    const timer = setTimeout(() => api().then(data => {
      if (!current) return
      setLibrary(data)
      const track = data.tracks.find(track => track.id === pending)
      if (track?.status === 'ready') { setPending(null); setNotice('Song imported. Choose Set clip to build the walk-up.') }
      if (track?.status === 'failed') { setPending(null); setError(track.error || 'Import failed. Please retry.') }
    }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setPollTick(tick => tick + 1) }), 3000)
    return () => { current = false; clearTimeout(timer) }
  }, [api, library, pending, pollTick])
  async function importSong(videoId) {
    setBusy(true); setError(''); setNotice(''); setQuery(''); setResults([]); setSearchPreview(null); setSearching(false)
    try {
      const { track } = await api('/import', { videoId })
      if (!active.current) return
      setPending(track.id)
      const data = await api()
      if (active.current) { setLibrary(data); setNotice('Import queued. You can close this drawer while it finishes.') }
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
  }
  async function deleteSong(track) {
    setBusy(true); setError(''); setNotice('')
    try {
      if (loadedPreviewId.current === track.id) {
        preview.current?.pause()
        loadedPreviewId.current = null
        setPlayingTrackId(null)
      }
      await api(`/${track.id}`, {}, 'DELETE')
      const data = await api()
      if (active.current) {
        setLibrary(data)
        const entries = data.assignments[target] || []
        if (target === 'team') setSelected(entries)
        else if (!entries.length) setClipTrackId(null)
        onAssigned(entries.map(entry => {
          const item = data.tracks.find(track => track.id === assignmentId(entry))
          const intro = typeof entry === 'object' && entry.introId ? data.tracks.find(track => track.id === entry.introId) : null
          return typeof entry === 'object' && (item || intro) ? { ...(item || { id: null, title: 'Announcement', artist: '', status: 'ready' }), clipStart: entry.start, clipDuration: entry.duration, intro, introStart: entry.introStart || 0, musicStart: entry.musicStart || 0, fadeIn: entry.fadeIn !== false, fadeOut: entry.fadeOut !== false, overlapReduction: Number.isFinite(entry.overlapReduction) ? entry.overlapReduction : .5 } : item
        }).filter(Boolean))
        setNotice(`${track.title} was deleted from Your music.`)
      }
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
  }
  async function uploadSong(event) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setBusy(true); setError(''); setNotice('')
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || ''
      const contentType = audioTypes[extension]
      if (!contentType) throw new Error('Choose an MP3, M4A, AAC, or WAV audio file.')
      if (file.size > 50 * 1024 * 1024) throw new Error('Audio files must be 50 MB or smaller.')
      const duration = await audioMetadata(file)
      if (duration > 1200) throw new Error('Audio must be 20 minutes or shorter.')
      const title = file.name.replace(/\.[^.]+$/, '').trim() || 'Uploaded song'
      const { data } = await storeAudio(file, title, contentType, duration, 'song')
      if (active.current) { setLibrary(data); setNotice(`${title} was uploaded to your music library.`) }
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
  }
  async function storeAudio(file, title, contentType, duration, kind) {
    const created = await api('/upload', { title, contentType, size: file.size, duration, kind })
    const uploaded = await fetch(created.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file, signal: AbortSignal.timeout(120000) })
    if (!uploaded.ok) throw new Error('The audio upload failed. Please try again.')
    await api(`/upload/${created.track.id}/complete`, {})
    return { data: await api(), trackId: created.track.id }
  }
  async function saveIntroBlob(blob, duration) {
    const contentType = blob.type.split(';')[0].toLowerCase()
    if (!['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg'].includes(contentType)) throw new Error('This intro audio format is not supported. Try M4A, MP3, WAV, or record it here.')
    if (duration <= 0 || duration > 30) throw new Error('The announcement must be 30 seconds or shorter.')
    const { data, trackId } = await storeAudio(blob, `Intro for ${player.name}`, contentType, duration, 'intro')
    if (!active.current) return
    const intro = data.tracks.find(track => track.id === trackId)
    if (!intro) throw new Error('The intro uploaded but could not be loaded. Try again.')
    temporaryIntroIds.current.add(intro.id)
    setLibrary(data); setIntroTrackId(intro.id); setNotice('Announcement ready. Preview the full walk-up before saving.')
  }
  async function uploadIntro(event) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Intro audio must be 15 MB or smaller.')
      const duration = await audioMetadata(file)
      await saveIntroBlob(file, duration)
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
  }
  async function toggleRecording() {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return }
    setError(''); setNotice('Get ready…'); setBusy(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microphone recording is not supported in this browser. Use Upload announcement instead.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferred = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type))
      const instance = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream)
      const chunks = []
      instance.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      instance.onerror = () => { stream.getTracks().forEach(track => track.stop()); setRecording(false); setError('Recording failed. Please try again or upload an intro.') }
      instance.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        setRecording(false); setBusy(true)
        try {
          const duration = Math.max(.5, (Date.now() - recordingStarted.current) / 1000)
          const blob = new Blob(chunks, { type: instance.mimeType || chunks[0]?.type || 'audio/webm' })
          await saveIntroBlob(blob, duration)
        } catch (e) { if (active.current) setError(e.message) }
        finally { if (active.current) setBusy(false) }
      }
      recorder.current = instance
      for (const number of [3, 2, 1]) {
        setRecordingCountdown(String(number)); setNotice(`Recording starts in ${number}…`)
        await new Promise(resolve => setTimeout(resolve, 700))
      }
      setRecordingCountdown('GO'); setNotice('Wait for the ding…')
      await playRecordingCue()
      if (!active.current) { stream.getTracks().forEach(track => track.stop()); return }
      setRecordingCountdown(null)
      recordingStarted.current = Date.now()
      instance.start(250); setRecording(true); setBusy(false); setNotice('Recording… Tap Stop recording when the announcement is finished.')
      setTimeout(() => { if (instance.state === 'recording') instance.stop() }, 30000)
    } catch (e) { setRecording(false); setRecordingCountdown(null); setBusy(false); setNotice(''); setError(e.message) }
  }
  function previewResult(result) {
    previewSequence.current++
    preview.current?.pause()
    setPlayingTrackId(null)
    if (searchPreview?.videoId === result.videoId) {
      playSearchPreview(searchPreviewFrame.current)
      return
    }
    setSearchPreview(result)
  }
  function playSearchPreview(frame) {
    if (!frame?.contentWindow) return
    const command = JSON.stringify({ event: 'command', func: 'playVideo', args: [] })
    frame.contentWindow.postMessage(command, 'https://www.youtube.com')
    setTimeout(() => frame.contentWindow?.postMessage(command, 'https://www.youtube.com'), 250)
  }
  function chooseClip(track) {
    previewSequence.current++
    preview.current?.pause()
    introPreview.current?.pause()
    clearInterval(clipTimer.current)
    setClipPlaying(false)
    const current = player.song?.id === track.id ? clampClip(track, player.song.clipStart, player.song.clipDuration) : clampClip(track, 0, 15)
    setClipTrackId(track.id)
    setClipStart(current.start)
    setClipDuration(current.duration)
    setTimeout(() => document.querySelector('.walkup-clip-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }
  async function assign(entries) {
    setBusy(true); setError('')
    try {
      await api('/assign', { target, tracks: entries }, 'PUT')
      if (active.current) {
        if (target !== 'team') {
          const savedIntroId = typeof entries[0] === 'object' ? entries[0].introId : null
          if (savedIntroId) temporaryIntroIds.current.delete(savedIntroId)
          const previousIntroId = player.song?.intro?.id
          if (previousIntroId && previousIntroId !== savedIntroId) await api(`/${previousIntroId}`, {}, 'DELETE').catch(() => {})
        }
        onAssigned(entries.map(entry => {
          const track = library.tracks.find(item => item.id === assignmentId(entry))
          const intro = typeof entry === 'object' && entry.introId ? library.tracks.find(item => item.id === entry.introId) : null
          return typeof entry === 'object' && (track || intro) ? { ...(track || { id: null, title: 'Announcement', artist: '', status: 'ready' }), clipStart: entry.start, clipDuration: entry.duration, intro, introStart: entry.introStart || 0, musicStart: entry.musicStart || 0, fadeIn: entry.fadeIn !== false, fadeOut: entry.fadeOut !== false, overlapReduction: Number.isFinite(entry.overlapReduction) ? entry.overlapReduction : .5 } : track
        }).filter(Boolean))
        closeDrawer()
      }
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
  }
  async function previewWalkup(track, musicOnly = false) {
    const element = preview.current
    const introElement = introPreview.current
    if (!element || !introElement) return
    if (clipPlaying) {
      previewSequence.current++
      clearInterval(clipTimer.current)
      introElement.pause(); element.pause(); resetAudioGain(musicGraph.current); setClipPlaying(false); setPlayingTrackId(null)
      return
    }
    const graphPromise = ensureAudioGain(element, musicGraph)
    const sequence = ++previewSequence.current
    clearInterval(clipTimer.current)
    introElement.pause(); element.pause(); resetAudioGain(musicGraph.current)
    setPlayingTrackId(null); setClipPlaying(true); setError('')
    try {
      const intro = !musicOnly && announcerEnabled ? library.tracks.find(item => item.id === introTrackId) : null
      if (!musicOnly && announcerEnabled && !intro) throw new Error('Record or upload the announcement first.')
      const [introPlayback, songPlayback] = await Promise.all([intro ? api(`/${intro.id}/play`, {}) : null, api(`/${track.id}/play`, {})])
      if (!active.current || sequence !== previewSequence.current) return
      loadedPreviewId.current = track.id
      element.src = songPlayback.url
      element.load()
      if (intro) { introElement.src = introPlayback.url; introElement.load() }
      await Promise.all([
        intro ? new Promise((resolve, reject) => { if (introElement.readyState >= 1) return resolve(); const ready = () => { cleanup(); resolve() }; const failed = () => { cleanup(); reject(new Error('The announcement could not be loaded.')) }; const cleanup = () => { introElement.removeEventListener('loadedmetadata', ready); introElement.removeEventListener('error', failed) }; introElement.addEventListener('loadedmetadata', ready); introElement.addEventListener('error', failed) }) : null,
        new Promise((resolve, reject) => { if (element.readyState >= 1) return resolve(); const ready = () => { cleanup(); resolve() }; const failed = () => { cleanup(); reject(new Error('The song clip could not be loaded.')) }; const cleanup = () => { element.removeEventListener('loadedmetadata', ready); element.removeEventListener('error', failed) }; element.addEventListener('loadedmetadata', ready); element.addEventListener('error', failed) }),
      ])
      if (!active.current || sequence !== previewSequence.current) return
      const graph = await graphPromise
      element.currentTime = clipStart; element.volume = 1
      if (intro) setTimeout(() => { if (active.current && sequence === previewSequence.current) introElement.play().catch(() => {}) }, introStart * 1000)
      await new Promise(resolve => setTimeout(resolve, (musicOnly ? 0 : musicStart) * 1000))
      if (!active.current || sequence !== previewSequence.current) return
      setAudioGain(graph, audioEnvelopeLevel(0, clipDuration, fadeIn, fadeOut))
      await element.play()
      setPlayingTrackId(track.id)
      clipTimer.current = setInterval(() => {
        const elapsed = element.currentTime - clipStart
        const remaining = clipDuration - elapsed
        if (remaining <= 0) {
          clearInterval(clipTimer.current); element.pause(); resetAudioGain(musicGraph.current)
          setClipPlaying(false); setPlayingTrackId(null)
          return
        }
        const timelineTime = (musicOnly ? 0 : musicStart) + elapsed
        const overlapping = !musicOnly && announcerEnabled && timelineTime >= introStart && timelineTime < introStart + (Number(intro?.duration) || 0)
        setAudioGain(graph, audioEnvelopeLevel(elapsed, clipDuration, fadeIn, fadeOut, overlapping, overlapReduction))
      }, 50)
    } catch (e) {
      if (active.current && sequence === previewSequence.current) { setError(e.message || 'The walk-up preview could not play.'); setClipPlaying(false) }
    }
  }
  async function previewIntro() {
    const element = introPreview.current
    if (!element || !introTrackId) return
    if (introPlaying && !element.paused) { element.pause(); setIntroPlaying(false); return }
    const sequence = ++previewSequence.current
    preview.current?.pause(); setPlayingTrackId(null); setClipPlaying(false); setError('')
    try {
      if (!element.src || element.dataset.trackId !== introTrackId) {
        const { url } = await api(`/${introTrackId}/play`, {})
        if (!active.current || sequence !== previewSequence.current) return
        element.src = url; element.dataset.trackId = introTrackId
      }
      await element.play()
      setIntroPlaying(true)
    } catch (e) { if (active.current && sequence === previewSequence.current) { setIntroPlaying(false); setError(e.message || 'The announcement preview could not play.') } }
  }
  async function listen(track) {
    const audio = preview.current
    if (!audio) return
    setError('')
    let sequence = previewSequence.current
    try {
      if (loadedPreviewId.current === track.id && audio.src) {
        if (audio.paused) { await audio.play(); setPlayingTrackId(track.id) }
        else { audio.pause(); setPlayingTrackId(null) }
        return
      }
      sequence = ++previewSequence.current
      audio.pause()
      setPlayingTrackId(null)
      const { url } = await api(`/${track.id}/play`, {})
      if (active.current && sequence === previewSequence.current) {
        loadedPreviewId.current = track.id
        audio.src = url
        await audio.play()
        setPlayingTrackId(track.id)
      }
    } catch (e) { if (active.current && sequence === previewSequence.current) setError(e.message) }
  }
  const team = target === 'team'
  const songTracks = library?.tracks.filter(track => track.kind !== 'intro') || []
  const introTrack = library?.tracks.find(track => track.id === introTrackId)
  const clipTrack = library?.tracks.find(track => track.id === clipTrackId)
  const saveWalkup = () => {
    if (!announcerEnabled && !musicEnabled) return assign([])
    const entry = {
      ...(musicEnabled ? { id: clipTrackId, start: clipStart, duration: clipDuration, musicStart: Math.min(musicStart, Number(introTrack?.duration) || 0), fadeIn, fadeOut, overlapReduction } : {}),
      ...(announcerEnabled ? { introId: introTrackId, introStart: Math.min(introStart, clipDuration) } : {}),
    }
    return assign([entry])
  }
  const playerReady = (!announcerEnabled || !!introTrackId) && (!musicEnabled || !!clipTrackId)
  const toggleAnnouncer = () => setAnnouncerEnabled(value => { const next = !value; setAnnouncerOpen(next); return next })
  const toggleMusic = () => setMusicEnabled(value => { const next = !value; setMusicOpen(next); return next })
  if (!team) return <><Modal className={`music-drawer walkup-drawer${closing ? ' closing' : ''}`} title="Walk-up" onClose={closeDrawer}>
    <p>Build {player.name}’s announcement and entrance music.</p>
    {error && <p className="validation" role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!library ? <p role="status">Loading your music library…</p> : <div className="walkup-sections">
      <section className={`walkup-section${announcerOpen ? ' open' : ''}`}>
        <SectionToggle label="Announcement" checked={announcerEnabled} open={announcerOpen} onToggle={toggleAnnouncer} onOpen={() => setAnnouncerOpen(value => !value)} />
        {announcerOpen && <div className="walkup-section-body"><AnnouncerEditor player={player} intro={introTrack} previewing={introPlaying} recording={recording} countdown={recordingCountdown} busy={busy} onPreview={previewIntro} onRecord={toggleRecording} onIntroUpload={uploadIntro} /></div>}
      </section>
      <section className={`walkup-section${musicOpen ? ' open' : ''}`}>
        <SectionToggle label="Music" checked={musicEnabled} open={musicOpen} onToggle={toggleMusic} onOpen={() => setMusicOpen(value => !value)} />
        {musicOpen && <div className="walkup-section-body">
          <div className="walkup-subhead"><h2>Get Music</h2><button type="button" className="walkup-add-music" aria-label={`${getMusicOpen ? 'Hide' : 'Show'} music search and upload`} aria-expanded={getMusicOpen} onClick={() => setGetMusicOpen(value => !value)}><Icon name={getMusicOpen ? 'close' : 'plus'} size={18} /></button></div>
          {getMusicOpen && <div className="walkup-get-music">
            {!library.configured && <p role="status">Music imports will be available once the Google music service is connected.</p>}
            <label className={`music-upload${busy ? ' disabled' : ''}`}><Icon name="upload" size={28} /><span><strong>{busy ? 'Working…' : 'Upload music'}</strong><small>MP3, M4A, AAC, or WAV · up to 50 MB</small></span><input type="file" accept=".mp3,.m4a,.mp4,.aac,.wav,audio/mpeg,audio/mp4,audio/aac,audio/wav" disabled={busy} onChange={uploadSong} /></label>
            <input id="music-search" aria-label="Search Music" type="search" placeholder="Search Music" maxLength={100} value={query} disabled={!library.configured} onChange={e => { setQuery(e.target.value); setSearchPreview(null) }} />
            {searching && <div className="music-searching" role="status"><span aria-hidden="true" />Searching…</div>}
            {!searching && query.trim().length >= 3 && library.configured && results.length === 0 && <p>No results. Try another song or artist.</p>}
            <div className="music-results">{results.map(result => {
              const track = library.tracks.find(t => t.videoId === result.videoId)
              const previewing = searchPreview?.videoId === result.videoId
              const importLabel = track?.status === 'ready' ? 'In library' : track && track.status !== 'failed' ? 'Importing…' : track ? 'Retry import' : 'Import song'
              return <React.Fragment key={result.videoId}><article className={`music-result${previewing ? ' previewing' : ''}`} tabIndex="0" aria-label={`${previewing ? 'Play' : 'Preview'} ${result.title}`} onClick={() => previewResult(result)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); previewResult(result) } }}><span className="music-result-thumbnail" aria-hidden="true"><img src={result.thumbnail} alt="" loading="lazy" /><span className="music-result-play-cue"><Icon name="play" size={11} /></span></span><div><strong>{result.title} {result.isExplicit === true && <span className="music-explicit" aria-label="Explicit content" title="Explicit content">E</span>}</strong><small>{result.artist} {time(result.duration)}</small>{result.album && <small>{result.album}</small>}</div><button type="button" className="music-import-button button-secondary" title={importLabel} aria-label={`${importLabel}: ${result.title}`} disabled={busy || !!track && track.status !== 'failed'} onClick={event => { event.stopPropagation(); setConfirmation({ type: 'import', track: result }) }}><Icon name="cloudArrowDown" size={16} /></button></article>{previewing && <section className="music-search-preview" aria-label={`Previewing ${result.title}`}><div className="music-search-preview-heading"><span><strong>{result.title}</strong>{result.artist && <small>{result.artist}</small>}</span><button type="button" className="close" onClick={() => setSearchPreview(null)} aria-label="Close preview"><Icon name="close" size={14} /></button></div><iframe ref={searchPreviewFrame} src={`https://www.youtube.com/embed/${encodeURIComponent(result.videoId)}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&widget_referrer=${encodeURIComponent(window.location.href)}`} title={`Preview ${result.title}`} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="origin-when-cross-origin" onLoad={event => playSearchPreview(event.currentTarget)} allowFullScreen /><small className="music-preview-help">If your iPhone blocks automatic playback, tap the play button once.</small></section>}</React.Fragment>
            })}</div>
          </div>}
          <h2 className="music-library-heading">Your Music</h2>
          {!songTracks.length && <p>Use + above to search for or upload your first song.</p>}
          {songTracks.map(track => <article key={track.id} className={`music-library-track${clipTrackId === track.id ? ' selected' : ''}`}>{track.status === 'ready' && <input className="walkup-song-radio" type="radio" name="walkup-song" value={track.id} checked={clipTrackId === track.id} aria-label={`Use ${track.title} for this walk-up`} onChange={() => { chooseClip(track); setMusicEnabled(true) }} />}<div><strong>{track.title}</strong><small>{track.artist} {time(track.duration)}{track.status !== 'ready' && ` · ${track.status}`}</small>{track.status === 'failed' && <small>{track.error}</small>}</div>{track.status === 'ready' ? <button type="button" className={`music-preview button-tertiary${playingTrackId === track.id ? ' playing' : ''}`} aria-label={`${playingTrackId === track.id ? 'Pause' : 'Play'} ${track.title}`} onClick={() => listen(track)}><Icon name={playingTrackId === track.id ? 'pause' : 'play'} size={14} /></button> : track.status === 'failed' ? <button type="button" className="button-secondary" disabled={busy} onClick={() => setConfirmation({ type: 'import', track })}>Retry</button> : <span className="music-pending" role="status">Importing…</span>}{['ready', 'failed'].includes(track.status) && <button type="button" className="music-delete-button" disabled={busy} aria-label={`Delete ${track.title} from Your music`} onClick={() => setConfirmation({ type: 'delete', track })}><Icon name="trash" size={15} /></button>}</article>)}
          {musicEnabled && <WalkupClipEditor track={clipTrack} start={clipStart} duration={clipDuration} playing={clipPlaying} busy={busy} previewDisabled={!clipTrack} onStart={clip => { setClipStart(clip.start); setClipDuration(clip.duration) }} onDuration={clip => setClipDuration(clip.duration)} onPreview={() => previewWalkup(clipTrack, true)} />}
        </div>}
      </section>
      {announcerEnabled && musicEnabled && introTrack && clipTrack && <BuildWalkup introDuration={Number(introTrack.duration) || 1} musicDuration={clipDuration} introStart={introStart} musicStart={musicStart} fadeIn={fadeIn} fadeOut={fadeOut} overlapReduction={overlapReduction} playing={clipPlaying} busy={busy} onIntroStart={setIntroStart} onMusicStart={setMusicStart} onFadeIn={setFadeIn} onFadeOut={setFadeOut} onOverlapReduction={setOverlapReduction} onPreview={() => previewWalkup(clipTrack)} />}
      <button type="button" className="sheet-save button-primary" disabled={busy || !playerReady} onClick={saveWalkup}><Icon name="save" size={16} />{busy ? 'Saving…' : 'Save Walk-up'}</button>
      <button type="button" className="drawer-cancel button-secondary" disabled={busy} onClick={closeDrawer}>Cancel</button>
    </div>}
    <audio ref={introPreview} hidden aria-hidden="true" onEnded={() => setIntroPlaying(false)} onPause={() => setIntroPlaying(false)} /><audio ref={preview} crossOrigin="anonymous" className="music-audio-preview" aria-hidden="true" onEnded={() => setPlayingTrackId(null)} onError={() => { setPlayingTrackId(null); setClipPlaying(false); setError('Preview could not play. Try again.') }} />
  </Modal>{confirmation && <Modal className="music-confirm-dialog" iconName={confirmation.type === 'delete' ? 'trash' : 'cloudArrowDown'} title={confirmation.type === 'delete' ? 'Delete this song?' : 'Import this song?'} onClose={() => setConfirmation(null)}><p>{confirmation.type === 'delete' ? <>Delete <strong>“{confirmation.track.title}”</strong> from Your music? This removes the stored audio and clears it from every player and team playlists.</> : <>Import <strong>“{confirmation.track.title}”</strong> to Your music? KingSports will download and store a private copy for your team.</>}</p><div className="music-confirm-actions"><button type="button" className="button-tertiary" onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className={confirmation.type === 'delete' ? 'music-confirm-delete' : 'button-primary'} onClick={() => { const action = confirmation; setConfirmation(null); if (action.type === 'delete') deleteSong(action.track); else importSong(action.track.videoId) }}>{confirmation.type === 'delete' ? 'Delete song' : 'Import song'}</button></div></Modal>}</>
  return <><Modal className={`music-drawer${closing ? ' closing' : ''}`} title={team ? 'Find Music' : 'Walk-up music'} onClose={closeDrawer}>
    <p>{team ? 'Full songs for pregame, postgame, and between innings.' : `Choose the entrance song for ${player.name}.`}</p>
    {error && <p className="validation" role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!library ? <p role="status">Loading your music library…</p> : <>
      {!library.configured && <p role="status">Music imports will be available once the Google music service is connected.</p>}
      <label htmlFor="music-search">SEARCH MUSIC</label><input id="music-search" type="search" placeholder="Song or artist" maxLength={100} value={query} disabled={!library.configured} onChange={e => { setQuery(e.target.value); setSearchPreview(null) }} />
      <label className={`music-upload${busy ? ' disabled' : ''}`}><Icon name="upload" size={28} /><span><strong>{busy ? 'Working…' : 'Upload music'}</strong><small>MP3, M4A, AAC, or WAV · up to 50 MB</small></span><input type="file" accept=".mp3,.m4a,.mp4,.aac,.wav,audio/mpeg,audio/mp4,audio/aac,audio/wav" disabled={busy} onChange={uploadSong} /></label>
      {searching && <p role="status">Searching…</p>}
      {!searching && query.trim().length >= 3 && library.configured && results.length === 0 && <p>No results. Try another song or artist.</p>}
      <div className="music-results">{results.map(result => {
        const track = library.tracks.find(t => t.videoId === result.videoId)
        const previewing = searchPreview?.videoId === result.videoId
        const importLabel = track?.status === 'ready' ? 'In library' : track && track.status !== 'failed' ? 'Importing…' : track ? 'Retry import' : 'Import song'
        return <React.Fragment key={result.videoId}><article className={`music-result${previewing ? ' previewing' : ''}`} tabIndex="0" aria-label={`${previewing ? 'Play' : 'Preview'} ${result.title}`} onClick={() => previewResult(result)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); previewResult(result) } }}><span className="music-result-thumbnail" aria-hidden="true"><img src={result.thumbnail} alt="" loading="lazy" /><span className="music-result-play-cue"><Icon name="play" size={11} /></span></span><div><strong>{result.title} {result.isExplicit === true && <span className="music-explicit" aria-label="Explicit content" title="Explicit content">E</span>}</strong><small>{result.artist} {time(result.duration)}</small>{result.album && <small>{result.album}</small>}</div><button type="button" className="music-import-button button-secondary" title={importLabel} aria-label={`${importLabel}: ${result.title}`} disabled={busy || !!track && track.status !== 'failed'} onClick={event => { event.stopPropagation(); setConfirmation({ type: 'import', track: result }) }}><Icon name="cloudArrowDown" size={16} /></button></article>{previewing && <section className="music-search-preview" aria-label={`Previewing ${result.title}`}><div className="music-search-preview-heading"><span><strong>{result.title}</strong>{result.artist && <small>{result.artist}</small>}</span><button type="button" className="close" onClick={() => setSearchPreview(null)} aria-label="Close preview"><Icon name="close" size={14} /></button></div><iframe ref={searchPreviewFrame} src={`https://www.youtube.com/embed/${encodeURIComponent(result.videoId)}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&widget_referrer=${encodeURIComponent(window.location.href)}`} title={`Preview ${result.title}`} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="origin-when-cross-origin" onLoad={event => playSearchPreview(event.currentTarget)} allowFullScreen /><small className="music-preview-help">If your iPhone blocks automatic playback, tap the play button once.</small></section>}</React.Fragment>
      })}</div>
      <h2 className="music-library-heading">Your Music</h2>
      {!songTracks.length && <p>Search above to import your first song.</p>}
      {songTracks.map(track => <article key={track.id} className="music-library-track"><div><strong>{track.title}</strong><small>{track.artist} {time(track.duration)}{track.status !== 'ready' && ` · ${track.status}`}</small>{track.status === 'failed' && <small>{track.error}</small>}</div>{track.status === 'ready' ? <><button type="button" className={`music-preview button-tertiary${playingTrackId === track.id ? ' playing' : ''}`} aria-label={`${playingTrackId === track.id ? 'Pause' : 'Play'} ${track.title}`} aria-pressed={playingTrackId === track.id} onClick={() => listen(track)}><Icon name={playingTrackId === track.id ? 'pause' : 'play'} size={14} /></button>{team ? <input type="checkbox" aria-label={`Include ${track.title} in team playlist`} checked={selected.includes(track.id)} onChange={e => setSelected(e.target.checked ? [...selected, track.id] : selected.filter(id => id !== track.id))} /> : <button type="button" className="button-secondary" disabled={busy} onClick={() => chooseClip(track)}>{clipTrackId === track.id ? 'Edit clip' : 'Set clip'}</button>}</> : track.status === 'failed' ? <button type="button" className="button-secondary" disabled={busy} onClick={() => setConfirmation({ type: 'import', track })}>Retry</button> : <span className="music-pending" role="status">Importing…</span>}{['ready', 'failed'].includes(track.status) && <button type="button" className="music-delete-button" disabled={busy} aria-label={`Delete ${track.title} from Your music`} onClick={() => setConfirmation({ type: 'delete', track })}><Icon name="trash" size={15} /></button>}</article>)}
      {!team && <WalkupClipEditor track={library.tracks.find(track => track.id === clipTrackId)} player={player} intro={library.tracks.find(track => track.id === introTrackId)} start={clipStart} duration={clipDuration} playing={clipPlaying} recording={recording} countdown={recordingCountdown} busy={busy} onStart={clip => { setClipStart(clip.start); setClipDuration(clip.duration) }} onDuration={clip => setClipDuration(clip.duration)} onPreview={() => previewWalkup(library.tracks.find(track => track.id === clipTrackId))} onRecord={toggleRecording} onIntroUpload={uploadIntro} onSave={() => assign([{ id: clipTrackId, start: clipStart, duration: clipDuration, introId: introTrackId }])} />}
      <audio ref={introPreview} hidden aria-hidden="true" />
      <audio ref={preview} className="music-audio-preview" aria-hidden="true" onEnded={() => setPlayingTrackId(null)} onError={() => { setPlayingTrackId(null); setClipPlaying(false); setError('Preview could not play. Try again.') }} />
      {team && <><h2 className="music-playlist-heading">Your Playlist</h2><ol className="music-order">{selected.map((id, index) => <li key={id}><span>{library.tracks.find(t => t.id === id)?.title}</span><button type="button" disabled={index === 0} aria-label="Move song earlier" onClick={() => setSelected(list => { const copy = [...list]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy })}>↑</button><button type="button" disabled={index === selected.length - 1} aria-label="Move song later" onClick={() => setSelected(list => { const copy = [...list]; [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]]; return copy })}>↓</button></li>)}</ol><button type="button" className="sheet-save button-primary" disabled={busy} onClick={() => assign(selected)}>{busy ? 'Saving…' : <><Icon name="save" size={16} />Save Playlist</>}</button><button type="button" className="drawer-cancel button-secondary" disabled={busy} onClick={closeDrawer}>Cancel</button></>}
      {!team && <button type="button" className="remove-song" disabled={busy} onClick={() => assign([])}>Remove walk-up song</button>}
    </>}
  </Modal>{confirmation && <Modal className="music-confirm-dialog" iconName={confirmation.type === 'delete' ? 'trash' : 'cloudArrowDown'} title={confirmation.type === 'delete' ? 'Delete this song?' : 'Import this song?'} onClose={() => setConfirmation(null)}><p>{confirmation.type === 'delete' ? <>Delete <strong>“{confirmation.track.title}”</strong> from Your music? This removes the stored audio and clears it from every player and team playlists.</> : <>Import <strong>“{confirmation.track.title}”</strong> to Your music? KingSports will download and store a private copy for your team.</>}</p><div className="music-confirm-actions"><button type="button" className="button-tertiary" onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className={confirmation.type === 'delete' ? 'music-confirm-delete' : 'button-primary'} onClick={() => { const action = confirmation; setConfirmation(null); if (action.type === 'delete') deleteSong(action.track); else importSong(action.track.videoId) }}>{confirmation.type === 'delete' ? 'Delete song' : 'Import song'}</button></div></Modal>}</>
}
