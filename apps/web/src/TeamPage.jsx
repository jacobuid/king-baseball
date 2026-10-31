import React, { useEffect, useRef, useState } from 'react'
import { Icon, Modal } from './ui'
import { teamStorage } from './teamStorage'

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
  const [teamName, setTeamName] = useState('')
  const [players, setPlayers] = useState([])
  const [playerName, setPlayerName] = useState('')
  const [selected, setSelected] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const teamInput = useRef(null)
  const playerInput = useRef(null)
  const dirty = useRef(false)
  useEffect(() => {
    let active = true
    teamStorage(userId).then(saved => { if (active && saved) { setTeamName(saved.name); setPlayers(saved.players); setStatus('Saved team loaded from this device.') } }).catch(() => { if (active) setError('Could not load device storage. You can edit, but saving may be unavailable.') }).finally(() => { if (active) setLoading(false) })
    const beforeUnload = e => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { active = false; window.removeEventListener('beforeunload', beforeUnload) }
  }, [userId])
  function changed() { dirty.current = true; setStatus('Unsaved changes'); setError('') }
  function addPlayer(event) {
    event.preventDefault()
    const name = playerName.trim().replace(/\s+/g, ' ')
    if (!name) { setError('Enter a player name.'); playerInput.current.focus(); return }
    if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) { setError('This player is already on the roster.'); return }
    setPlayers([...players, { id: crypto.randomUUID(), name, song: null }]); setPlayerName(''); changed(); playerInput.current.focus()
  }
  async function save() {
    if (!teamName.trim()) { setError('Enter a team name to continue.'); teamInput.current.focus(); return }
    if (!players.length) { setError('Add at least one player to your roster.'); playerInput.current.focus(); return }
    setSaving(true); setError('')
    try { await teamStorage(userId, { name: teamName.trim(), players }); dirty.current = false; setStatus('Team saved on this device.'); setSuccess(true) }
    catch { setError('Could not save your team. Device storage may be full or unavailable. Your changes are still open here.') }
    finally { setSaving(false) }
  }
  return <><main id="team" className="form-panel"><fieldset disabled={loading || saving} className="team-fields"><label className="label" htmlFor="team-name"><span>TEAM NAME</span><span className="required">* REQUIRED</span></label><div className="field"><Icon name="ball" size={20} /><input ref={teamInput} id="team-name" required placeholder="e.g. King Sluggers" maxLength={48} autoComplete="organization" value={teamName} onChange={e => { setTeamName(e.target.value); changed() }} /></div><div className="section-head"><div><h2>Players</h2><p>Add everyone on the roster</p></div><span className="count">{players.length} {players.length === 1 ? 'PLAYER' : 'PLAYERS'}</span></div><form className="add-row" onSubmit={addPlayer}><div className="field"><Icon size={20} /><input ref={playerInput} aria-label="Player name" placeholder="Enter player's name" maxLength={55} autoComplete="off" value={playerName} onChange={e => setPlayerName(e.target.value)} /></div><button className="add-btn" type="submit" aria-label="Add player">+</button></form><div className="helper">Tap + or press Enter to add a player</div><div className="roster">{players.length ? players.map((player, i) => <div key={player.id} className="player"><div className="number">{String(i + 1).padStart(2, '0')}</div><div className="player-info"><strong>{player.name}</strong><small className={player.song ? 'assigned' : ''}>{player.song ? `${player.song.title}${player.song.artist ? ' · ' + player.song.artist : ''}` : 'No walk-up music yet'}</small></div><button className={`music-btn ${player.song ? 'assigned' : ''}`} aria-label={`${player.song ? 'Edit' : 'Add'} walk-up music for ${player.name}`} onClick={() => setSelected(player)}><Icon name="music" size={13} />{player.song ? 'Edit music' : 'Add music'}</button><button className="remove-btn" aria-label={`Remove ${player.name}`} onClick={() => { setPlayers(players.filter(p => p.id !== player.id)); changed() }}>×</button></div>) : <div className="empty"><div className="empty-icon"><Icon name="ball" size={69} /></div><strong>{loading ? 'Loading your team…' : 'Your roster is empty'}</strong><p>Every great team starts with<br />the first player.</p></div>}</div><div className="tip"><div className="tip-icon"><Icon name="music" size={20} /></div><p><strong>Make their entrance count.</strong><br />Add a walk-up song to each player using the music button beside their name.</p></div></fieldset></main><footer className="bottom">{error && <p className="validation" role="alert">{error}</p>}<button className="save" disabled={loading || saving} onClick={save}>{saving ? 'Saving…' : 'Save Team →'}</button><p role="status">{status || 'Your lineup can be edited anytime.'}</p><p>Team and audio files save on this device only.</p></footer>{selected && <MusicEditor player={selected} onClose={() => setSelected(null)} onSave={song => { setPlayers(players.map(p => p.id === selected.id ? { ...p, song } : p)); setSelected(null); changed() }} />}{success && <Modal title="Lineup ready!" className="success-dialog" onClose={() => setSuccess(false)}><p><strong>{teamName.trim()}</strong> has {players.length} {players.length === 1 ? 'player' : 'players'} and {players.filter(p => p.song).length} walk-up songs assigned.</p><div className="note">Saved on this device for your account. Use Save Team again after editing your lineup.</div><button className="sheet-save" onClick={() => setSuccess(false)}>Back to Team</button></Modal>}</>
}
