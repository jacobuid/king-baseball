import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Icon } from './ui'
import { createTeamApi } from './teamApi'
import { teamStorage } from './teamStorage'
import { createTeamTheme } from './teamTheme'
import { createMusicApi, mergeMusic } from './musicApi'
import { audioEnvelopeLevel, ensureAudioGain, overlapMusicLevel, resetAudioGain, setAudioGain } from './audioFade'
import { usePressDragReorder } from './usePressDragReorder'
import './team-playlist.css'

function shuffleSongIds(ids) {
  const shuffled = [...ids]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const values = new Uint32Array(1)
    crypto.getRandomValues(values)
    const swap = values[0] % (index + 1)
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]
  }
  if (shuffled.length > 1 && shuffled[0] === ids[0]) shuffled.push(shuffled.shift())
  return shuffled
}

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
  const [savingOrder, setSavingOrder] = useState(false)
  const audio = useRef(null)
  const introAudio = useRef(null)
  const clipTimer = useRef(null)
  const musicGraph = useRef(null)
  const queue = useRef([])
  const teamOrder = useRef(null)
  const previousOrder = useRef(null)
  const playerReorder = usePressDragReorder({
    disabled: loading || savingOrder,
    onStart() { previousOrder.current = teamOrder.current },
    onMove(fromId, toId) {
      setTeam(current => {
        if (!current) return current
        const from = current.players.findIndex(player => player.id === fromId)
        const to = current.players.findIndex(player => player.id === toId)
        if (from < 0 || to < 0 || from === to) return current
        const players = [...current.players]
        const [player] = players.splice(from, 1)
        players.splice(to, 0, player)
        const next = { ...current, players }
        teamOrder.current = next
        return next
      })
    },
    async onDrop() {
      const ordered = teamOrder.current
      if (!ordered) return
      setSavingOrder(true); setError('')
      try {
        const saved = await requestTeam(ordered)
        setTeam(current => current ? { ...current, version: saved.version } : current)
        previousOrder.current = null
      } catch (error) {
        if (previousOrder.current) { teamOrder.current = previousOrder.current; setTeam(previousOrder.current) }
        setError(error.message || 'Could not save the new player order.')
      } finally { setSavingOrder(false) }
    },
  })
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    requestTeam().then(async saved => {
      const local = await teamStorage(userId).catch(() => null)
      const music = await requestMusic()
      if (active) { const merged = saved ? mergeMusic(saved, local, music) : null; teamOrder.current = merged; setTeam(merged) }
    }).catch(error => { if (active) setError(error.message || 'Could not load your team.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [requestTeam, requestMusic, userId, retry])

  const allSongs = useMemo(() => [...(team?.players || []).filter(player => player.song).map(player => ({ ...player.song, playbackId: player.id, playerName: player.name, jerseyNumber: player.jerseyNumber })), ...(team?.teamSongs || []).map(song => ({ ...song, playbackId: 'team-' + song.id }))], [team])
  const activeSong = allSongs.find(song => song.playbackId === activeId)
  useEffect(() => {
    const element = audio.current
    const introElement = introAudio.current
    if (!element || !introElement) return
    element.pause()
    introElement.pause()
    element.removeAttribute('src')
    introElement.removeAttribute('src')
    element.load()
    introElement.load()
    clearInterval(clipTimer.current)
    resetAudioGain(musicGraph.current)
    if (!activeSong) return
    let disposed = false
    let objectUrl
    async function play() {
      try {
        const songUrl = activeSong.id && activeSong.status === 'ready' ? (await requestMusic('/' + activeSong.id + '/play', {})).url : activeSong.file instanceof Blob ? (objectUrl = URL.createObjectURL(activeSong.file)) : null
        if (disposed || (!songUrl && !activeSong.intro)) return
        const playerWalkup = !activeSong.playbackId.startsWith('team-')
        let introUrl = null
        if (playerWalkup && activeSong.intro?.status === 'ready') {
          introUrl = (await requestMusic('/' + activeSong.intro.id + '/play', {})).url
          if (disposed) return
          introElement.src = introUrl
        }
        if (!songUrl) {
          await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(activeSong.introStart) || 0) * 1000))
          if (disposed || !introUrl) return
          await introElement.play()
          await new Promise(resolve => setTimeout(resolve, (Number(activeSong.intro?.duration) || 0) * 1000))
          if (!disposed) { setPlaying(false); setActiveId(null) }
          return
        }
        element.src = songUrl
        if (activeSong.playbackId.startsWith('team-')) { await element.play(); return }
        if (element.readyState < 1) await new Promise((resolve, reject) => {
          const ready = () => { cleanup(); resolve() }
          const failed = () => { cleanup(); reject(new Error('Audio could not load.')) }
          const cleanup = () => { element.removeEventListener('loadedmetadata', ready); element.removeEventListener('error', failed) }
          element.addEventListener('loadedmetadata', ready); element.addEventListener('error', failed)
        })
        const start = Math.max(0, Number(activeSong.clipStart) || 0)
        const duration = Math.max(3, Number(activeSong.clipDuration) || Math.min(15, activeSong.duration || 15))
        element.currentTime = start
        const graph = await ensureAudioGain(element, musicGraph)
        element.volume = 1
        if (introUrl) setTimeout(() => { if (!disposed) introElement.play().catch(() => {}) }, Math.max(0, Number(activeSong.introStart) || 0) * 1000)
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(activeSong.musicStart) || 0) * 1000))
        if (disposed) return
        const initialOverlapLevel = activeSong.intro ? overlapMusicLevel(Number(activeSong.musicStart) || 0, Number(activeSong.introStart) || 0, Number(activeSong.intro.duration) || 0, Number(activeSong.overlapReduction) || 0) : 1
        setAudioGain(graph, audioEnvelopeLevel(0, duration, activeSong.fadeIn !== false, activeSong.fadeOut !== false, initialOverlapLevel))
        await element.play()
        clipTimer.current = setInterval(() => {
          const elapsed = element.currentTime - start
          const remaining = duration - elapsed
          if (remaining <= 0) {
            clearInterval(clipTimer.current); element.pause(); resetAudioGain(musicGraph.current)
            setPlaying(false); setActiveId(null)
            return
          }
          const timelineTime = (Number(activeSong.musicStart) || 0) + elapsed
          const introStart = Number(activeSong.introStart) || 0
          const overlapLevel = activeSong.intro ? overlapMusicLevel(timelineTime, introStart, Number(activeSong.intro.duration) || 0, Number(activeSong.overlapReduction) || 0) : 1
          setAudioGain(graph, audioEnvelopeLevel(elapsed, duration, activeSong.fadeIn !== false, activeSong.fadeOut !== false, overlapLevel))
        }, 50)
      } catch (error) { if (!disposed) {
        if (error.name === 'NotAllowedError') setError('Tap the play button again to start playback.')
        else { queue.current = []; setPlaylistMode(false); setError('Audio could not play. Tap play to try again.'); setActiveId(null) }
      } }
    }
    play()
    return () => { disposed = true; clearInterval(clipTimer.current); introElement.pause(); element.pause(); resetAudioGain(musicGraph.current); introElement.removeAttribute('src'); element.removeAttribute('src'); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [activeSong, requestMusic])
  function playPlayer(id) {
    ensureAudioGain(audio.current, musicGraph).catch(() => {})
    queue.current = []
    setPlaylistMode(false)
    setError('')
    if (activeId === id) {
      if (!introAudio.current?.paused) { introAudio.current.pause(); setActiveId(null); setPlaying(false); return }
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
    if (shuffle) ids = shuffleSongIds(ids)
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
  function toggleShuffle() {
    audio.current?.pause()
    queue.current = []
    setPlaylistMode(false)
    if (activeId?.startsWith('team-')) setActiveId(null)
    setShuffle(value => !value)
  }
  const playable = team?.teamSongs?.some(song => song.status === 'ready')
  const teamSongs = (team?.teamSongs || []).filter(song => song.status === 'ready')
  const playlistIsActive = playlistMode && activeId?.startsWith('team-')
  return <main className="team-view" style={createTeamTheme(team?.primaryColor)}>
    <audio ref={introAudio} hidden onPlaying={() => { setPlaying(true); setError('') }} onPause={() => { if (audio.current?.paused) setPlaying(false) }} />
    <audio ref={audio} crossOrigin="anonymous" hidden onPlaying={() => { setPlaying(true); setError('') }} onPause={() => { if (introAudio.current?.paused) setPlaying(false) }} onEnded={nextSong} onError={() => { queue.current = []; setPlaylistMode(false); setError('This song could not be played. Tap play to retry.'); setActiveId(null) }} />
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
          return <article key={player.id} {...playerReorder.bind(player.id, `view-player ${isPlaying ? 'playing' : ''}`)}>
            <div className="view-jersey"><Icon name="jersey" size={46} /><span>{player.jerseyNumber ?? '--'}</span></div>
            <div className="view-player-info"><h3>{player.name}</h3><p><Icon name="music" size={14} />{available ? 'Walk-up music assigned' : player.song ? 'Add audio in Edit Team' : 'No walk-up music yet'}</p></div>
            {isPlaying && <div className="view-wave" aria-hidden="true">{[10, 20, 30, 16, 26].map((height, index) => <span key={index} style={{ height, animationDelay: `${index * .12}s` }} />)}</div>}
            <button className="view-play" disabled={!available} aria-label={`${isPlaying ? 'Pause' : 'Play'} walk-up music for ${player.name}`} aria-pressed={activeId === player.id && playing} onClick={() => playPlayer(player.id)}><Icon name={isPlaying ? 'pause' : 'play'} size={19} /></button>
          </article>
        })}</div>
        <section className={`view-playlist-panel${playlistOpen ? ' open' : ''}`} aria-label="Team playlist">
          <div className="view-playlist-toolbar">
            <button className="view-playlist" disabled={!playable} aria-label={playlistIsActive && playing ? 'Pause Team Playlist' : 'Play Team Playlist'} onClick={playlist}><span className="view-playlist-icon"><Icon name={playlistIsActive && playing ? 'pause' : 'play'} size={25} /></span><span><strong>Team Playlist</strong><small>{playable ? `${teamSongs.length} ${teamSongs.length === 1 ? 'song' : 'songs'} · ${shuffle ? 'Shuffle play' : 'Play in order'}` : 'No team songs yet. Edit this team to add songs.'}</small></span></button>
            <button className={`view-playlist-tool${shuffle ? ' active' : ''}`} disabled={!playable} aria-label={`${shuffle ? 'Turn off' : 'Turn on'} shuffle`} aria-pressed={shuffle} onClick={toggleShuffle}><Icon name="shuffle" size={20} /></button>
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
