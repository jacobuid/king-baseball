import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Icon, Modal } from './ui'
import { teamStorage } from './teamStorage'
import { createTeamApi } from './teamApi'
import { JerseyPicker } from './JerseyPicker'

function MusicEditor({ player, onSave, onClose }) {
  const [title, setTitle] = useState(player.song?.title || '')
  const [artist, setArtist] = useState(player.song?.artist || '')
  const [file, setFile] = useState(player.song?.file || null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  useEffect(() => { if (!file) { setPreview(''); return } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url) }, [file])
  function submit(event) {
    event.preventDefault()
    const songTitle = title.trim() || file?.name.replace(/\.[^.]+$/, '')
    if (!songTitle) { setError('Enter a song title or choose an audio file.'); return }
    onSave({ title: songTitle, artist: artist.trim(), file })
  }
  return <Modal title="Walk-up music" onClose={onClose}><p>Set the soundtrack for <strong>{player.name}</strong>.</p><form onSubmit={submit}><label htmlFor="song-title">SONG TITLE</label><input autoFocus id="song-title" type="text" placeholder="e.g. Thunderstruck" maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /><label htmlFor="song-artist">ARTIST (OPTIONAL)</label><input id="song-artist" type="text" placeholder="Artist name" maxLength={100} value={artist} onChange={e => setArtist(e.target.value)} /><label htmlFor="song-file">AUDIO FILE (OPTIONAL)</label><div className="upload"><span>{file?.name || 'Choose an audio file from your device'}</span><input id="song-file" type="file" accept="audio/*" onChange={e => { const chosen = e.target.files?.[0]; if (!chosen) return; if (chosen.type && !chosen.type.startsWith('audio/')) { setError('Please choose an audio file.'); return } if (chosen.size > 25 * 1024 * 1024) { setError('Choose an audio file smaller than 25 MB.'); return } setFile(chosen); setError('') }} /></div>{preview && <><audio controls src={preview} /><button type="button" className="remove-song" onClick={() => setFile(null)}>Remove audio file</button></>}{error && <p className="validation" role="alert">{error}</p>}<button className="sheet-save" type="submit">Save Walk-up Music</button>{player.song && <button type="button" className="remove-song" onClick={() => onSave(null)}>Remove music</button>}</form></Modal>
}
export function TeamPage({ userId }) {
  const { getToken } = useAuth()
  const requestTeam = useMemo(() => createTeamApi(getToken), [getToken])
  const [version, setVersion] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [players, setPlayers] = useState([])
  const [playerName, setPlayerName] = useState('')
  const [selected, setSelected] = useState(null)
  const [jerseyPlayer, setJerseyPlayer] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const teamInput = useRef(null)
  const playerInput = useRef(null)
  const dirty = useRef(false)
  const loadTeam = useCallback(async (isActive = () => true) => {
    setLoading(true)
    setLoadFailed(false)
    setError('')
    try {
      // A server failure must never be treated as an empty team.
      const saved = await requestTeam()
      const local = await teamStorage(userId).catch(() => null)
      if (!isActive()) return
      const source = saved || local
      setVersion(saved?.version || 0)
      setTeamName(source?.name || '')
      setPlayers((source?.players || []).map(player => ({ ...player, song: local?.players?.find(p => p.id === player.id)?.song || null })))
      dirty.current = !saved && !!local
      setStatus(saved ? 'Team loaded from your account.' : local ? 'Device roster loaded as a draft. Save Team to add it to your account.' : '')
    } catch (error) {
      if (isActive()) { setLoadFailed(true); setError(error.message || 'Could not load your team. Check your connection and retry.') }
    } finally { if (isActive()) setLoading(false) }
  }, [requestTeam, userId])
  useEffect(() => {
    let active = true
    loadTeam(() => active)
    const beforeUnload = e => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { active = false; window.removeEventListener('beforeunload', beforeUnload) }
  }, [loadTeam])
  function changed() { dirty.current = true; setStatus('Unsaved changes'); setError('') }
  function addPlayer(event) {
    event.preventDefault()
    const name = playerName.trim().replace(/\s+/g, ' ')
    if (!name) { setError('Enter a player name.'); playerInput.current.focus(); return }
    if (players.length >= 100) { setError('A team can have up to 100 players.'); return }
    if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) { setError('This player is already on the roster.'); return }
    setPlayers([...players, { id: crypto.randomUUID(), name, song: null }]); setPlayerName(''); changed(); playerInput.current.focus()
  }
  async function save() {
    if (!teamName.trim()) { setError('Enter a team name to continue.'); teamInput.current.focus(); return }
    if (!players.length) { setError('Add at least one player to your roster.'); playerInput.current.focus(); return }
    setSaving(true); setError('')
    try {
      const saved = await requestTeam({ name: teamName.trim(), version, players })
      setVersion(saved.version)
      setTeamName(saved.name)
      dirty.current = false
      setStatus('Team and players saved to your account.')
      // Retain existing device-only music behavior; send no music to the API.
      try { await teamStorage(userId, { name: saved.name, players }) }
      catch { setStatus('Team and players saved online. Device-only music could not be saved.') }
      setSuccess(true)
    }
    catch (error) { setError(error.message || 'Could not save your team. Your changes are still open here.') }
    finally { setSaving(false) }
  }
  return <><main id="team" className="form-panel">{loadFailed && <div className="team-connection-notice" role="status">Your saved team could not be loaded. You can enter a draft below. Use Retry loading team before saving to your account.</div>}{error && <p className="validation" role="alert">{error}</p>}<fieldset disabled={loading || saving} className="team-fields"><label className="label" htmlFor="team-name"><span>TEAM NAME</span><span className="required">* REQUIRED</span></label><div className="field"><Icon name="ball" size={20} /><input ref={teamInput} id="team-name" required placeholder="e.g. King Sluggers" maxLength={48} autoComplete="organization" value={teamName} onChange={e => { setTeamName(e.target.value); changed() }} /></div><div className="section-head"><div><h2>Players</h2><p>Add everyone on the roster</p></div><span className="count">{players.length} {players.length === 1 ? 'PLAYER' : 'PLAYERS'}</span></div><form className="add-row" onSubmit={addPlayer}><div className="field"><Icon size={20} /><input ref={playerInput} aria-label="Player name" placeholder="Enter player's name" maxLength={55} autoComplete="off" value={playerName} onChange={e => setPlayerName(e.target.value)} /></div><button className="add-btn" type="submit" aria-label="Add player"><Icon name="plus" size={24} /></button></form><div className="helper">Tap + or press Enter to add a player</div><div className="roster">{players.length ? players.map((player, i) => <div key={player.id} className="player"><button type="button" className="number jersey-number" aria-label={`Set jersey number for ${player.name}${player.jerseyNumber ? `, currently ${player.jerseyNumber}` : ""}`} onClick={() => setJerseyPlayer(player)}>{player.jerseyNumber ?? "--"}</button><div className="player-info"><strong>{player.name}</strong><small className={player.song ? 'assigned' : ''}>{player.song ? `${player.song.title}${player.song.artist ? ' · ' + player.song.artist : ''}` : 'No walk-up music yet'}</small></div><button className={`music-btn ${player.song ? 'assigned' : ''}`} aria-label={`${player.song ? 'Edit' : 'Add'} walk-up music for ${player.name}`} onClick={() => setSelected(player)}><Icon name="music" size={13} />{player.song ? 'Edit music' : 'Add music'}</button><button className="remove-btn" aria-label={`Remove ${player.name}`} onClick={() => { setPlayers(players.filter(p => p.id !== player.id)); changed() }}>×</button></div>) : <div className="empty"><div className="empty-icon"><Icon name="ball" size={69} /></div><strong>{loading ? 'Loading your team…' : 'Your roster is empty'}</strong><p>Every great team starts with<br />the first player.</p></div>}</div><div className="tip"><div className="tip-icon"><Icon name="music" size={20} /></div><p><strong>Make their entrance count.</strong><br />Add team songs for pregame, postgame, and between-inning transitions.</p></div></fieldset></main><footer className="bottom"><button className="save" disabled={loading || saving || loadFailed} onClick={save}>{saving ? 'Saving…' : 'Save Team →'}</button><p role="status">{status || 'Your lineup can be edited anytime.'}</p><p>Team and players sync to your account. Music stays on this device.</p><button className="reload-team" disabled={loading || saving} onClick={() => { if (!dirty.current || window.confirm("Discard unsaved changes and reload your saved team?")) loadTeam() }}>{loadFailed ? "Retry loading team" : "Reload saved team"}</button></footer>{jerseyPlayer && <JerseyPicker player={jerseyPlayer} onClose={() => setJerseyPlayer(null)} onSave={jerseyNumber => { setPlayers(players.map(p => p.id === jerseyPlayer.id ? { ...p, jerseyNumber } : p)); setJerseyPlayer(null); changed() }} />}{selected && <MusicEditor player={selected} onClose={() => setSelected(null)} onSave={song => { setPlayers(players.map(p => p.id === selected.id ? { ...p, song } : p)); setSelected(null); changed() }} />}{success && <Modal title="Lineup ready!" className="success-dialog" onClose={() => setSuccess(false)}><p><strong>{teamName.trim()}</strong> has {players.length} {players.length === 1 ? 'player' : 'players'} and {players.filter(p => p.song).length} walk-up songs assigned.</p><div className="note">Team and players saved to your account. Music remains on this device only.</div><button className="sheet-save" onClick={() => setSuccess(false)}>Back to Team</button></Modal>}</>
}
