import React, { useEffect, useRef, useState } from 'react'
import { Icon, Modal } from './ui'

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
  const active = useRef(true)
  const preview = useRef(null)
  const loadedPreviewId = useRef(null)
  const searchPreviewFrame = useRef(null)
  const previewSequence = useRef(0)
  const closeTimer = useRef(null)
  useEffect(() => {
    active.current = true
    api().then(data => { if (active.current) { setLibrary(data); setSelected(data.assignments[target] || []) } }).catch(e => { if (active.current) setError(e.message) })
    return () => { active.current = false; previewSequence.current++; preview.current?.pause(); clearTimeout(closeTimer.current) }
  }, [api, target, retry])
  function closeDrawer() {
    if (closing) return
    setClosing(true)
    previewSequence.current++
    preview.current?.pause()
    setPlayingTrackId(null)
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
      if (track?.status === 'ready') { setPending(null); setNotice('Song imported. Choose Use song to assign it.') }
      if (track?.status === 'failed') { setPending(null); setError(track.error || 'Import failed. Please retry.') }
    }).catch(e => { if (current) setError(e.message) }).finally(() => { if (current) setPollTick(tick => tick + 1) }), 3000)
    return () => { current = false; clearTimeout(timer) }
  }, [api, library, pending, pollTick])
  async function importSong(videoId) {
    setBusy(true); setError(''); setNotice('')
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
        setSelected(data.assignments[target] || [])
        onAssigned((data.assignments[target] || []).map(id => data.tracks.find(item => item.id === id)).filter(Boolean))
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
      const created = await api('/upload', { title, contentType, size: file.size, duration })
      const uploaded = await fetch(created.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file, signal: AbortSignal.timeout(120000) })
      if (!uploaded.ok) throw new Error('The audio upload failed. Please try again.')
      await api(`/upload/${created.track.id}/complete`, {})
      const data = await api()
      if (active.current) { setLibrary(data); setNotice(`${title} was uploaded to your music library.`) }
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
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
  async function assign(ids) {
    setBusy(true); setError('')
    try {
      await api('/assign', { target, tracks: ids }, 'PUT')
      if (active.current) { onAssigned(ids.map(id => library.tracks.find(t => t.id === id)).filter(Boolean)); closeDrawer() }
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
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
  return <><Modal className={`music-drawer${closing ? ' closing' : ''}`} title={team ? 'Find Music' : 'Walk-up music'} onClose={closeDrawer}>
    <p>{team ? 'Full songs for pregame, postgame, and between innings.' : `Choose the entrance song for ${player.name}.`}</p>
    {error && <p className="validation" role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!library ? <p role="status">Loading your music library…</p> : <>
      {!library.configured && <p role="status">Music imports will be available once the Google music service is connected.</p>}
      <label htmlFor="music-search">SEARCH MUSIC</label><input id="music-search" type="search" placeholder="Song or artist" maxLength={100} value={query} disabled={!library.configured} onChange={e => { setQuery(e.target.value); setSearchPreview(null) }} />
      <label className={`music-upload${busy ? ' disabled' : ''}`}><Icon name="upload" size={22} /><span><strong>{busy ? 'Working…' : 'Upload music'}</strong><small>MP3, M4A, AAC, or WAV · up to 50 MB</small></span><input type="file" accept=".mp3,.m4a,.mp4,.aac,.wav,audio/mpeg,audio/mp4,audio/aac,audio/wav" disabled={busy} onChange={uploadSong} /></label>
      {searching && <p role="status">Searching…</p>}
      {!searching && query.trim().length >= 3 && library.configured && results.length === 0 && <p>No results. Try another song or artist.</p>}
      <div className="music-results">{results.map(result => {
        const track = library.tracks.find(t => t.videoId === result.videoId)
        const previewing = searchPreview?.videoId === result.videoId
        const importLabel = track?.status === 'ready' ? 'In library' : track && track.status !== 'failed' ? 'Importing…' : track ? 'Retry import' : 'Import song'
        return <React.Fragment key={result.videoId}><article className={`music-result${previewing ? ' previewing' : ''}`} tabIndex="0" aria-label={`${previewing ? 'Play' : 'Preview'} ${result.title}`} onClick={() => previewResult(result)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); previewResult(result) } }}><span className="music-result-thumbnail" aria-hidden="true"><img src={result.thumbnail} alt="" loading="lazy" /><span className="music-result-play-cue"><Icon name="play" size={11} /></span></span><div><strong>{result.title} {result.isExplicit === true && <span className="music-explicit" aria-label="Explicit content" title="Explicit content">E</span>}</strong><small>{result.artist} {time(result.duration)}</small>{result.album && <small>{result.album}</small>}</div><button type="button" className="music-import-button button-secondary" title={importLabel} aria-label={`${importLabel}: ${result.title}`} disabled={busy || !!track && track.status !== 'failed'} onClick={event => { event.stopPropagation(); setConfirmation({ type: 'import', track: result }) }}><Icon name="cloudArrowDown" size={16} /></button></article>{previewing && <section className="music-search-preview" aria-label={`Previewing ${result.title}`}><div className="music-search-preview-heading"><span><strong>{result.title}</strong>{result.artist && <small>{result.artist}</small>}</span><button type="button" className="close" onClick={() => setSearchPreview(null)} aria-label="Close preview"><Icon name="close" size={14} /></button></div><iframe ref={searchPreviewFrame} src={`https://www.youtube.com/embed/${encodeURIComponent(result.videoId)}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}&widget_referrer=${encodeURIComponent(window.location.href)}`} title={`Preview ${result.title}`} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="origin-when-cross-origin" onLoad={event => playSearchPreview(event.currentTarget)} allowFullScreen /><small className="music-preview-help">If your iPhone blocks automatic playback, tap the play button once.</small></section>}</React.Fragment>
      })}</div>
      <h2 className="music-library-heading">Your Music</h2>
      {!library.tracks.length && <p>Search above to import your first song.</p>}
      {library.tracks.map(track => <article key={track.id} className="music-library-track"><div><strong>{track.title}</strong><small>{track.artist} {time(track.duration)}{track.status !== 'ready' && ` · ${track.status}`}</small>{track.status === 'failed' && <small>{track.error}</small>}</div>{track.status === 'ready' ? <><button type="button" className={`music-preview button-tertiary${playingTrackId === track.id ? ' playing' : ''}`} aria-label={`${playingTrackId === track.id ? 'Pause' : 'Play'} ${track.title}`} aria-pressed={playingTrackId === track.id} onClick={() => listen(track)}><Icon name={playingTrackId === track.id ? 'pause' : 'play'} size={14} /></button>{team ? <input type="checkbox" aria-label={`Include ${track.title} in team playlist`} checked={selected.includes(track.id)} onChange={e => setSelected(e.target.checked ? [...selected, track.id] : selected.filter(id => id !== track.id))} /> : <button type="button" className="button-secondary" disabled={busy} onClick={() => assign([track.id])}>Use song</button>}</> : track.status === 'failed' ? <button type="button" className="button-secondary" disabled={busy} onClick={() => setConfirmation({ type: 'import', track })}>Retry</button> : <span className="music-pending" role="status">Importing…</span>}{['ready', 'failed'].includes(track.status) && <button type="button" className="music-delete-button" disabled={busy} aria-label={`Delete ${track.title} from Your music`} onClick={() => setConfirmation({ type: 'delete', track })}><Icon name="trash" size={15} /></button>}</article>)}
      <audio ref={preview} className="music-audio-preview" aria-hidden="true" onEnded={() => setPlayingTrackId(null)} onError={() => { setPlayingTrackId(null); setError('Preview could not play. Try again.') }} />
      {team && <><h2>Your Playlist</h2><ol className="music-order">{selected.map((id, index) => <li key={id}><span>{library.tracks.find(t => t.id === id)?.title}</span><button type="button" disabled={index === 0} aria-label="Move song earlier" onClick={() => setSelected(list => { const copy = [...list]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy })}>↑</button><button type="button" disabled={index === selected.length - 1} aria-label="Move song later" onClick={() => setSelected(list => { const copy = [...list]; [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]]; return copy })}>↓</button></li>)}</ol><button type="button" className="sheet-save button-primary" disabled={busy} onClick={() => assign(selected)}>{busy ? 'Saving…' : <><Icon name="save" size={16} />Save Playlist</>}</button></>}
      {!team && <button type="button" className="remove-song" disabled={busy} onClick={() => assign([])}>Remove walk-up song</button>}
    </>}
  </Modal>{confirmation && <Modal className="music-confirm-dialog" iconName={confirmation.type === 'delete' ? 'trash' : 'cloudArrowDown'} title={confirmation.type === 'delete' ? 'Delete this song?' : 'Import this song?'} onClose={() => setConfirmation(null)}><p>{confirmation.type === 'delete' ? <>Delete <strong>“{confirmation.track.title}”</strong> from Your music? This removes the stored audio and clears it from every player and team playlists.</> : <>Import <strong>“{confirmation.track.title}”</strong> to Your music? KingSports will download and store a private copy for your team.</>}</p><div className="music-confirm-actions"><button type="button" className="button-tertiary" onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className={confirmation.type === 'delete' ? 'music-confirm-delete' : 'button-primary'} onClick={() => { const action = confirmation; setConfirmation(null); if (action.type === 'delete') deleteSong(action.track); else importSong(action.track.videoId) }}>{confirmation.type === 'delete' ? 'Delete song' : 'Import song'}</button></div></Modal>}</>
}
