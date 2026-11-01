import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Icon } from './ui'
import { createTeamApi } from './teamApi'
import { teamStorage } from './teamStorage'
import { createTeamTheme } from './teamTheme'
import { createMusicApi, mergeMusic } from './musicApi'
import './team-playlist.css'

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
  const [playlistMode, setPlaylistMode] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [shuffle, setShuffle] = useState(false)
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
        if (error.name === 'NotAllowedError') setError('Tap the play button again to start playback.')
        else { queue.current = []; setPlaylistMode(false); setError('Audio could not play. Tap play to try again.'); setActiveId(null) }
      } }
    }
    play()
    return () => { disposed = true; element.pause(); element.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [activeSong, requestMusic])
  function playPlayer(id) {
    queue.current = []
    setPlaylistMode(false)
    setError('')
    if (activeId === id) {
      if (audio.current?.paused) audio.current.play().catch(() => setError('Audio could not play. Tap play to try again.'))
      else audio.current?.pause()
      return
    }
    setActiveId(id)
  }
  function playlist() {
    if (playlistMode && activeId?.startsWith('team-')) {
      if (audio.current?.paused) audio.current.play().catch(() => setError('Audio could not play. Tap play to try again.'))
      else audio.current?.pause()
      return
    }
    let ids = (team.teamSongs || []).filter(song => song.status === 'ready').map(song => 'team-' + song.id)
    if (shuffle) {
      ids = [...ids]
      for (let index = ids.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1))
        ;[ids[index], ids[swap]] = [ids[swap], ids[index]]
      }
    }
    queue.current = ids.slice(1)
    setPlaylistMode(true)
    setError('')
    setActiveId(ids[0] || null)
  }
  function playTeamSong(id) {
    queue.current = []
    setPlaylistMode(false)
    setError('')
    const playbackId = 'team-' + id
    if (activeId === playbackId) {
      if (audio.current?.paused) audio.current.play().catch(() => setError('Audio could not play. Tap play to try again.'))
      else audio.current?.pause()
      return
    }
    setActiveId(playbackId)
  }
  function nextSong() {
    const next = queue.current.shift() || null
    if (!next) setPlaylistMode(false)
    setActiveId(next)
  }
  const playable = team?.teamSongs?.some(song => song.status === 'ready')
  const teamSongs = (team?.teamSongs || []).filter(song => song.status === 'ready')
  const playlistIsActive = playlistMode && activeId?.startsWith('team-')
  return <main className="team-view" style={createTeamTheme(team?.primaryColor)}>
    <audio ref={audio} hidden onPlaying={() => { setPlaying(true); setError('') }} onPause={() => setPlaying(false)} onEnded={nextSong} onError={() => { queue.current = []; setPlaylistMode(false); setError('This song could not be played. Tap play to retry.'); setActiveId(null) }} />
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
            <button className="view-play" disabled={!available} aria-label={`${isPlaying ? 'Pause' : 'Play'} walk-up music for ${player.name}`} aria-pressed={activeId === player.id && playing} onClick={() => playPlayer(player.id)}><Icon name={isPlaying ? 'pause' : 'play'} size={19} /></button>
          </article>
        })}</div>
        <section className={`view-playlist-panel${playlistOpen ? ' open' : ''}`} aria-label="Team playlist">
          <div className="view-playlist-toolbar">
            <button className="view-playlist" disabled={!playable} onClick={playlist}><span className="view-playlist-icon"><Icon name={playlistIsActive && playing ? 'pause' : 'playlist'} size={25} /></span><span><strong>{playlistIsActive ? playing ? 'Pause Team Playlist' : 'Resume Team Playlist' : 'Play Team Playlist'}</strong><small>{playable ? `${teamSongs.length} ${teamSongs.length === 1 ? 'song' : 'songs'} · ${shuffle ? 'Shuffle play' : 'Play in order'}` : 'No team songs yet. Edit this team to add songs.'}</small></span></button>
            <button className={`view-playlist-tool${shuffle ? ' active' : ''}`} disabled={!playable} aria-label={`${shuffle ? 'Turn off' : 'Turn on'} shuffle`} aria-pressed={shuffle} onClick={() => setShuffle(value => !value)}><Icon name="shuffle" size={20} /></button>
            <button className="view-playlist-tool playlist-expand" disabled={!playable} aria-label={`${playlistOpen ? 'Hide' : 'Show'} team songs`} aria-expanded={playlistOpen} onClick={() => setPlaylistOpen(value => !value)}><Icon name="chevronDown" size={19} /></button>
          </div>
          {playlistOpen && <div className="view-playlist-songs">{teamSongs.map((song, index) => {
            const songActive = activeId === 'team-' + song.id
            const songPlaying = songActive && playing
            return <article className={`view-playlist-song${songActive ? ' active' : ''}`} key={song.id}><span className="playlist-track-number">{index + 1}</span><span><strong>{song.title}</strong><small>{song.artist || 'Team song'}{song.duration ? ` · ${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}` : ''}</small></span><button className="view-play" aria-label={`${songPlaying ? 'Pause' : 'Play'} ${song.title}`} aria-pressed={songPlaying} onClick={() => playTeamSong(song.id)}><Icon name={songPlaying ? 'pause' : 'play'} size={15} /></button></article>
          })}</div>}
        </section>
        <button className="view-edit" onClick={onEdit}>Edit Team <Icon name="arrowRight" size={20} /></button>
      </>}
    </>}
  </main>
}
