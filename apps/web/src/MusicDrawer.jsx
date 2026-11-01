import React, { useEffect, useRef, useState } from 'react'
import { Icon, Modal } from './ui'

const time = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : ''
export function MusicDrawer({ api, target, player, onClose, onAssigned }) {
  const [library, setLibrary] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState([])
  const [pending, setPending] = useState(null)
  const [retry, setRetry] = useState(0)
  const [pollTick, setPollTick] = useState(0)
  const active = useRef(true)
  const preview = useRef(null)
  const previewSequence = useRef(0)
  useEffect(() => {
    active.current = true
    api().then(data => { if (active.current) { setLibrary(data); setSelected(data.assignments[target] || []) } }).catch(e => { if (active.current) setError(e.message) })
    return () => { active.current = false; previewSequence.current++; preview.current?.pause() }
  }, [api, target, retry])
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
  async function assign(ids) {
    setBusy(true); setError('')
    try {
      await api('/assign', { target, tracks: ids }, 'PUT')
      if (active.current) { onAssigned(ids.map(id => library.tracks.find(t => t.id === id)).filter(Boolean)); onClose() }
    } catch (e) { if (active.current) setError(e.message) }
    finally { if (active.current) setBusy(false) }
  }
  async function listen(track) {
    const sequence = ++previewSequence.current
    preview.current?.pause(); setError('')
    try {
      const { url } = await api(`/${track.id}/play`, {})
      if (active.current && sequence === previewSequence.current) { preview.current.src = url; await preview.current.play() }
    } catch (e) { if (active.current && sequence === previewSequence.current) setError(e.message) }
  }
  const team = target === 'team'
  return <Modal className="music-drawer" title={team ? 'Team songs' : 'Walk-up music'} onClose={onClose}>
    <p>{team ? 'Full songs for pregame, postgame, and between innings.' : `Choose the entrance song for ${player.name}.`}</p>
    {error && <p className="validation" role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!library ? <p role="status">Loading your music library…</p> : <>
      {!library.configured && <p role="status">Music imports will be available once the Google music service is connected.</p>}
      <label htmlFor="music-search">SEARCH YOUTUBE</label><input id="music-search" autoFocus type="search" placeholder="Song or artist" maxLength={100} value={query} disabled={!library.configured} onChange={e => setQuery(e.target.value)} />
      {searching && <p role="status">Searching…</p>}
      {!searching && query.trim().length >= 3 && library.configured && results.length === 0 && <p>No results. Try another song or artist.</p>}
      <div className="music-results">{results.map(result => {
        const track = library.tracks.find(t => t.videoId === result.videoId)
        return <article className="music-result" key={result.videoId}><img src={result.thumbnail} alt="" loading="lazy" /><div><strong>{result.title}</strong><small>{result.artist} {time(result.duration)}</small></div><button type="button" className="button-secondary" disabled={busy || !!track && track.status !== 'failed'} onClick={() => importSong(result.videoId)}>{track?.status === 'ready' ? 'In library' : track && track.status !== 'failed' ? 'Importing…' : track ? 'Retry' : 'Import'}</button></article>
      })}</div>
      <h3>Your music</h3>
      {!library.tracks.length && <p>Search above to import your first song.</p>}
      {library.tracks.map(track => <article key={track.id} className="music-library-track"><div><strong>{track.title}</strong><small>{track.artist} {time(track.duration)}{track.status !== 'ready' && ` · ${track.status}`}</small>{track.status === 'failed' && <small>{track.error}</small>}</div>{track.status === 'ready' ? <><button type="button" className="music-preview button-tertiary" aria-label={`Preview ${track.title}`} onClick={() => listen(track)}><Icon name="play" size={14} /></button>{team ? <input type="checkbox" aria-label={`Include ${track.title} in team playlist`} checked={selected.includes(track.id)} onChange={e => setSelected(e.target.checked ? [...selected, track.id] : selected.filter(id => id !== track.id))} /> : <button type="button" className="button-secondary" disabled={busy} onClick={() => assign([track.id])}>Use song</button>}</> : track.status === 'failed' ? <button type="button" className="button-secondary" disabled={busy} onClick={() => importSong(track.videoId)}>Retry</button> : <span className="music-pending" role="status">Importing…</span>}</article>)}
      <audio ref={preview} controls className="music-audio-preview" onError={() => setError('Preview could not play. Try again.')} />
      {team && <><h3>Playlist order</h3><ol className="music-order">{selected.map((id, index) => <li key={id}><span>{library.tracks.find(t => t.id === id)?.title}</span><button type="button" disabled={index === 0} aria-label="Move song earlier" onClick={() => setSelected(list => { const copy = [...list]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy })}>↑</button><button type="button" disabled={index === selected.length - 1} aria-label="Move song later" onClick={() => setSelected(list => { const copy = [...list]; [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]]; return copy })}>↓</button></li>)}</ol><button type="button" className="sheet-save button-primary" disabled={busy} onClick={() => assign(selected)}>{busy ? 'Saving…' : 'Save team playlist'}</button></>}
      {!team && <button type="button" className="remove-song" disabled={busy} onClick={() => assign([])}>Remove walk-up song</button>}
    </>}
  </Modal>
}
