import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Icon } from './ui'
import { createTeamApi } from './teamApi'
import { teamStorage } from './teamStorage'
import { createTeamTheme } from './teamTheme'
import { createMusicApi, mergeMusic } from './musicApi'

export function TeamView({ userId, onEdit }) {
  const { getToken } = useAuth()
  const requestTeam = useMemo(() => createTeamApi(getToken), [getToken])
  const requestMusic = useMemo(() => createMusicApi(getToken), [getToken])
  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [activeId, setActiveId] = useState(null)
  const [playing, setPlaying] = useState(false)
  const audio = useRef(null)
  const queue = useRef([])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    requestTeam().then(async saved => {
      const local = await teamStorage(userId).catch(() => null)
      const music = await requestMusic()
      if (active) setTeam(saved ? mergeMusic(saved, local, music) : null)
    }).catch(error => { if (active) setError(error.message || 'Could not load your team.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [requestTeam, requestMusic, userId, retry])

  const allSongs = useMemo(() => [...(team?.players || []).map(player => ({ ...player.song, playbackId: player.id })), ...(team?.teamSongs || []).map(song => ({ ...song, playbackId: 'team-' + song.id }))], [team])
  const activeSong = allSongs.find(song => song.playbackId === activeId)
  useEffect(() => {
    const element = audio.current
    if (!element) return
    element.pause()
    element.removeAttribute('src')
    element.load()
    if (!activeSong) return
    let disposed = false
    let objectUrl
    async function play() {
      try {
        const url = activeSong.status === 'ready' ? (await requestMusic('/' + activeSong.id + '/play', {})).url : activeSong.file instanceof Blob ? (objectUrl = URL.createObjectURL(activeSong.file)) : null
        if (disposed || !url) return
        element.src = url
        await element.play()
      } catch (error) { if (!disposed) {
        if (error.name === 'NotAllowedError') setError('Tap play in the audio controls to start playback.')
        else { queue.current = []; setError('Audio could not play. Tap play to try again.'); setActiveId(null) }
      } }
    }
    play()
    return () => { disposed = true; element.pause(); element.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [activeSong, requestMusic])
  function playPlayer(id) {
    queue.current = []
    setError('')
    setActiveId(current => current === id ? null : id)
  }
  function playlist() {
    if (activeId?.startsWith('team-')) { queue.current = []; setActiveId(null); return }
    const ids = (team.teamSongs || []).filter(song => song.status === 'ready').map(song => 'team-' + song.id)
    queue.current = ids.slice(1)
    setError('')
    setActiveId(ids[0] || null)
  }
  const playable = team?.teamSongs?.some(song => song.status === 'ready')
  return <main className="team-view" style={createTeamTheme(team?.primaryColor)}>
    <audio ref={audio} controls={!!activeId} hidden={!activeId} style={{ width: '100%', marginBottom: activeId ? 16 : 0 }} onPlaying={() => { setPlaying(true); setError('') }} onPause={() => setPlaying(false)} onEnded={() => setActiveId(queue.current.shift() || null)} onError={() => { queue.current = []; setError('This song could not be played. Tap play to retry.'); setActiveId(null) }} />
    {loading ? <div className="view-empty" role="status"><Icon name="ball" size={42} /><h2>Loading your lineup...</h2></div> : <>
      {error && <div className="view-error" role="alert"><p>{error}</p>{!team && <button className="view-retry" onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
      {!team ? !error && <div className="view-empty"><Icon name="team" size={46} /><h2>Your team starts here.</h2><p>Create your team and build your first lineup.</p><button className="view-edit" onClick={onEdit}>Create Team <Icon name="plus" size={18} /></button></div> : <>
        <section className="team-summary" aria-label="Team details">
          <img className="summary-background" src={`${import.meta.env.BASE_URL}hero-background.png`} alt="" />
          <div className="view-team-logo">{team.logoUrl || team.logoDataUrl ? <img src={team.logoUrl || team.logoDataUrl} alt={`${team.name} logo`} /> : <Icon name="team" size={48} />}</div>
          <div className="team-summary-copy"><p>TEAM</p><h2>{team.name}</h2>{team.division && <span className="view-division"><Icon name="league" size={17} />{team.division}</span>}</div>
        </section>
        <div className="view-roster-heading"><div><h2>Players</h2><p>Tap play for their walk-up music.</p></div><span className="view-player-count">{team.players.length} {team.players.length === 1 ? 'PLAYER' : 'PLAYERS'}</span></div>
        <div className="view-roster">{team.players.map(player => {
          const available = player.song?.status === 'ready' || player.song?.file instanceof Blob
          const isPlaying = activeId === player.id && playing
          return <article key={player.id} className={`view-player ${isPlaying ? 'playing' : ''}`}>
            <div className="view-jersey"><Icon name="jersey" size={46} /><span>{player.jerseyNumber ?? '--'}</span></div>
            <div className="view-player-info"><h3>{player.name}</h3><p><Icon name="music" size={14} />{available ? 'Walk-up music assigned' : player.song ? 'Add audio in Edit Team' : 'No walk-up music yet'}</p></div>
            {isPlaying && <div className="view-wave" aria-hidden="true">{[10, 20, 30, 16, 26].map((height, index) => <span key={index} style={{ height, animationDelay: `${index * .12}s` }} />)}</div>}
            <button className="view-play" disabled={!available} aria-label={`${isPlaying ? 'Stop' : 'Play'} walk-up music for ${player.name}`} aria-pressed={activeId === player.id} onClick={() => playPlayer(player.id)}><Icon name={isPlaying ? 'stop' : 'play'} size={19} /></button>
          </article>
        })}</div>
        <button className="view-playlist" disabled={!playable} onClick={playlist}><span className="view-playlist-icon"><Icon name="playlist" size={27} /></span><span><strong>{activeId?.startsWith('team-') ? 'Stop Team Playlist' : 'Team Playlist'}</strong><small>{playable ? 'Play your team songs in order, in full.' : 'No team songs yet. Edit this team to add songs for pregame, postgame, and transitions.'}</small></span></button>
        <button className="view-edit" onClick={onEdit}>Edit Team <Icon name="arrowRight" size={20} /></button>
      </>}
    </>}
  </main>
}
