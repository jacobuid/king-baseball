import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Icon } from './ui'
import { MusicDrawer } from './MusicDrawer'
import { createMusicApi, mergeMusic } from './musicApi'
import { teamStorage } from './teamStorage'
import { createTeamApi } from './teamApi'
import { JerseyPicker } from './JerseyPicker'
import { DivisionPicker } from './DivisionPicker'
import { TeamLogoUpload } from './TeamLogoUpload'
import { usePressDragReorder } from './usePressDragReorder'

export function TeamEdit({ userId, teamId, onSaved, onCancel, onDirtyChange, onSavingChange }) {
  const { getToken } = useAuth()
  const requestTeam = useMemo(() => createTeamApi(getToken), [getToken])
  const requestMusic = useMemo(() => createMusicApi(getToken), [getToken])
  const [teamSongs, setTeamSongs] = useState([])
  const [version, setVersion] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [division, setDivision] = useState(null)
  const [primaryColor, setPrimaryColor] = useState('#041c36')
  const [divisionOpen, setDivisionOpen] = useState(false)
  const [logoDataUrl, setLogoDataUrl] = useState(undefined)
  const [logoUrl, setLogoUrl] = useState(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [players, setPlayers] = useState([])
  const [playerName, setPlayerName] = useState('')
  const [selected, setSelectedState] = useState(null)
  const setSelected = value => setSelectedState(value?.id === 'team' && teamId ? { ...value, assignmentTarget: `team:${teamId}` } : value)
  const [jerseyPlayer, setJerseyPlayer] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  useEffect(() => { onSavingChange(saving); return () => onSavingChange(false) }, [saving, onSavingChange])
  const teamInput = useRef(null)
  const playerInput = useRef(null)
  const dirty = useRef(false)
  const loadTeam = useCallback(async (isActive = () => true) => {
    setLoading(true)
    setLoadFailed(false)
    setError('')
    try {
      if (!teamId) {
        if (!isActive()) return
        setVersion(0); setTeamName(''); setDivision(null); setPrimaryColor('#041c36'); setLogoDataUrl(undefined); setLogoUrl(null); setPlayers([]); setTeamSongs([])
        dirty.current = false; onDirtyChange(false)
        return
      }
      // A server failure must never be treated as an empty team.
      const saved = await requestTeam(undefined, teamId)
      const local = await teamStorage(userId, undefined, teamId).catch(() => null)
      if (!isActive()) return
      const music = await requestMusic()
      if (!isActive()) return
      const source = saved || local
      setVersion(saved?.version || 0)
      setTeamName(source?.name || '')
      setDivision(source?.division || null)
      setPrimaryColor(source?.primaryColor || '#041c36')
      setLogoDataUrl(saved ? undefined : local?.logoDataUrl || undefined)
      setLogoUrl(saved?.logoUrl || saved?.logoDataUrl || null)
      const merged = mergeMusic(source || { players: [] }, local, music)
      setPlayers(merged.players)
      setTeamSongs(merged.teamSongs)
      dirty.current = !saved && !!local
      onDirtyChange(dirty.current)
      setStatus(saved ? '' : local ? 'Device roster loaded as a draft. Save Team to add it to your account.' : '')
    } catch (error) {
      if (isActive()) { setLoadFailed(true); setError(error.message || 'Could not load your team. Check your connection and retry.') }
    } finally { if (isActive()) setLoading(false) }
  }, [requestTeam, requestMusic, userId, teamId, onDirtyChange])
  useEffect(() => {
    let active = true
    loadTeam(() => active)
    const beforeUnload = e => { if (dirty.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { active = false; onDirtyChange(false); window.removeEventListener('beforeunload', beforeUnload) }
  }, [loadTeam])
  function changed() { dirty.current = true; onDirtyChange(true); setStatus('Unsaved changes'); setError('') }
  const playerReorder = usePressDragReorder({
    disabled: loading || saving,
    onMove(fromId, toId) {
      setPlayers(current => {
        const from = current.findIndex(player => player.id === fromId)
        const to = current.findIndex(player => player.id === toId)
        if (from < 0 || to < 0 || from === to) return current
        const next = [...current]
        const [player] = next.splice(from, 1)
        next.splice(to, 0, player)
        return next
      })
      changed()
    },
    onDrop() { setStatus('Player order changed. Save Team to keep it.') },
  })
  function addPlayer(event) {
    event.preventDefault()
    const name = playerName.trim().replace(/\s+/g, ' ')
    if (!name) { setError('Enter a player name.'); playerInput.current.focus(); return }
    if (players.length >= 100) { setError('A team can have up to 100 players.'); return }
    if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) { setError('This player is already on the roster.'); return }
    setPlayers([...players, { id: crypto.randomUUID(), name, song: null }]); setPlayerName(''); changed(); playerInput.current.focus()
  }
  async function save(nextPlayers = players, showConfirmation = true) {
    if (!teamName.trim()) { setError('Enter a team name to continue.'); teamInput.current.focus(); return false }
    if (!nextPlayers.length) { setError('Add at least one player to your roster.'); playerInput.current.focus(); return false }
    if (loadFailed || logoBusy) { setError('Wait for your team and logo to finish loading before saving.'); return false }
    setSaving(true); setError('')
    try {
      const saved = await requestTeam({ name: teamName.trim(), division, primaryColor, logoDataUrl, version, players: nextPlayers }, teamId, !teamId)
      setVersion(saved.version)
      setTeamName(saved.name)
      setLogoUrl(saved.logoUrl || saved.logoDataUrl || null)
      setLogoDataUrl(undefined)
      setPlayers(nextPlayers)
      dirty.current = false
      onDirtyChange(false)
      setStatus('Team and players saved to your account.')
      // Preserve legacy device audio while imported songs sync independently.
      try { await teamStorage(userId, { ...saved, players: nextPlayers }, saved.id) }
      catch { setStatus('Team and players saved online. Device-only music could not be saved.') }
      if (showConfirmation) { onSavingChange(false); onSaved(saved) }
      return true
    }
    catch (error) { setError(error.message || 'Could not save your team. Your changes are still open here.'); return false }
    finally { setSaving(false) }
  }
  return <><main id="team" className="form-panel">{loadFailed && <div className="team-connection-notice" role="status">Your saved team could not be loaded. You can enter a draft below. Refresh the page to reconnect before saving to your account.</div>}{error && <p className="validation" role="alert">{error}</p>}<fieldset disabled={loading || saving} className="team-fields"><div className="team-identity-row"><div className="team-name-control"><label className="label" htmlFor="team-name"><span>TEAM NAME</span><span className="required">* REQUIRED</span></label><div className="field"><Icon name="team" size={20} /><input ref={teamInput} id="team-name" required placeholder="e.g. King Sluggers" maxLength={48} autoComplete="organization" value={teamName} onChange={e => { setTeamName(e.target.value); changed() }} /></div><div className="team-name-options"><label className="team-color-control" title="Choose team primary color"><span className="sr-only">Team primary color</span><input type="color" value={primaryColor} aria-label="Team primary color" onChange={event => { setPrimaryColor(event.target.value); changed() }} /></label><button type="button" className="division-button button-tertiary" aria-label={`Choose team division${division ? `, currently ${division}` : ""}`} onClick={() => setDivisionOpen(true)}><Icon name="league" size={14} /><span>{division || "Select division"}</span><Icon name="chevronDown" size={12} /></button></div></div><TeamLogoUpload value={logoDataUrl === undefined ? logoUrl : logoDataUrl} onChange={logo => { setLogoDataUrl(logo); changed() }} onError={setError} onBusy={setLogoBusy} /></div><div className="section-head"><div><h2>Players</h2><p>Add everyone on the roster</p></div><span className="count">{players.length} {players.length === 1 ? 'PLAYER' : 'PLAYERS'}</span></div><form className="add-row" onSubmit={addPlayer}><div className="field"><Icon name="user" size={20} /><input ref={playerInput} aria-label="Player name" placeholder="Enter player's name" maxLength={55} autoComplete="off" value={playerName} onChange={e => setPlayerName(e.target.value)} /></div><button className="add-btn" type="submit" aria-label="Add player"><Icon name="plus" size={24} /></button></form><div className="helper">Tap + or press Enter to add a player</div><div className="roster">{players.length ? players.map((player, i) => <div key={player.id} {...playerReorder.bind(player.id, 'player')}><button type="button" className="number jersey-number button-tertiary" aria-label={`Set jersey number for ${player.name}${player.jerseyNumber ? `, currently ${player.jerseyNumber}` : ""}`} onClick={() => { setError(''); setJerseyPlayer(player) }}>{player.jerseyNumber ?? "--"}</button><div className="player-info"><strong>{player.name}</strong><small className={player.song ? 'assigned' : ''}>{player.song ? `${player.song.title}${player.song.artist ? ' · ' + player.song.artist : ''}` : 'No walk-up music yet'}</small></div><button className={`music-btn button-secondary ${player.song ? 'assigned' : ''}`} aria-label={`${player.song ? 'Edit' : 'Add'} walk-up music for ${player.name}`} onClick={() => setSelected(player)}><Icon name="music" size={13} />{player.song ? 'Edit walk-up' : 'Add walk-up'}</button><button className="remove-btn" aria-label={`Remove ${player.name}`} onClick={() => { setPlayers(players.filter(p => p.id !== player.id)); changed() }}><Icon name="trash" size={18} /></button></div>) : <div className="empty"><div className="empty-icon"><Icon name="peopleGroup" size={69} /></div><strong>{loading ? 'Loading your team…' : 'Your roster is empty'}</strong><p>Every great team starts with<br />the first player.</p></div>}</div><button type="button" className="tip team-music-button" onClick={() => setSelected({ id: 'team' })}><div className="tip-icon"><Icon name="music" size={20} /></div><p><strong>Team Playlist{teamSongs.length ? ` (${teamSongs.length})` : ''}</strong><br />Add team songs to playlist.</p><span className="team-music-edit" aria-hidden="true"><Icon name="edit" size={16} /></span></button></fieldset></main><footer className="bottom"><button className="save button-primary" disabled={loading || saving || loadFailed || logoBusy} onClick={() => save()}>{saving ? 'Saving...' : <><Icon name="save" size={16} />Save Team</>}</button><button type="button" className="team-cancel button-secondary" disabled={saving} onClick={onCancel}>Cancel</button>{status && <p role="status">{status}</p>}</footer>{divisionOpen && <DivisionPicker value={division} onClose={() => setDivisionOpen(false)} onSave={value => { setDivision(value); setDivisionOpen(false); changed() }} />}{jerseyPlayer && <JerseyPicker player={jerseyPlayer} onClose={() => setJerseyPlayer(null)} saving={saving} error={error} onSave={async jerseyNumber => { const nextPlayers = players.map(p => p.id === jerseyPlayer.id ? { ...p, jerseyNumber } : p); if (await save(nextPlayers, false)) { setJerseyPlayer(null); setStatus(`Jersey number saved for ${jerseyPlayer.name}.`) } }} />}{selected && <MusicDrawer api={requestMusic} target={selected.id} player={selected} onClose={() => setSelected(null)} onAssigned={songs => { if (selected.id === 'team') setTeamSongs(songs); else setPlayers(current => current.map(p => p.id === selected.id ? { ...p, song: songs[0] || null } : p)) }} />}</>
}
