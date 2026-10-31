import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton, useAuth } from '@clerk/clerk-react'
import './style.css'

const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const api = import.meta.env.VITE_API_URL
// GitHub Pages serves this app below /king-baseball/, not at the origin root.
const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href

function App() {
  const { getToken } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [profile, setProfile] = useState(null)
  const [media, setMedia] = useState([])
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  async function request(path, options = {}) {
    const token = await getToken()
    const response = await fetch(`${api}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers } })
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    return response.json()
  }
  useEffect(() => { request('/api/profiles').then(setProfiles).catch(e => setError(e.message)) }, [])
  useEffect(() => { if (profile) request('/api/library').then(setMedia).catch(e => setError(e.message)) }, [profile])
  async function play(item) {
    try {
      const result = await request(`/api/media/${item.id}/play`, { method: 'POST', body: JSON.stringify({ profileId: profile.id }) })
      setSelected({ ...item, ...result })
    } catch (e) { setError(e.message) }
  }
  async function saveProgress(event) {
    if (!selected || !profile || !Number.isFinite(event.target.currentTime)) return
    try { await request('/api/progress', { method: 'POST', body: JSON.stringify({ profileId: profile.id, mediaId: selected.id, positionSeconds: Math.floor(event.target.currentTime) }) }) } catch (e) { setError(e.message) }
  }
  async function addProfile() { const name = prompt('Profile name'); if (name?.trim()) try { const created = await request('/api/profiles', { method: 'POST', body: JSON.stringify({ name }) }); setProfiles([...profiles, created]) } catch(e) { setError(e.message) } }
  return <main><header><h1>Media Library</h1><UserButton /></header>{error && <p role="alert">{error}</p>}{!profile ? <section><h2>Who's watching?</h2><div className="grid">{profiles.map(p => <button key={p.id} onClick={() => setProfile(p)}>{p.name}</button>)}<button onClick={addProfile}>Add profile</button></div></section> : <><nav><button onClick={() => { setProfile(null); setSelected(null) }}>Switch profile</button><span>{profile.name}</span></nav><input aria-label="Search movies" placeholder="Search movies" value={query} onChange={e => setQuery(e.target.value)} />{selected && <section><h2>{selected.title}</h2><video controls autoPlay src={selected.url} onPause={saveProgress} onEnded={saveProgress} onSeeked={saveProgress} /> <button onClick={() => setSelected(null)}>Close</button></section>}<section><h2>Library</h2><div className="grid">{media.filter(m => m.title.toLowerCase().includes(query.toLowerCase())).map(m => <button className="card" key={m.id} onClick={() => play(m)}>{m.thumbnailUrl && <img src={m.thumbnailUrl} alt="" />}<strong>{m.title}</strong><small>{m.category || 'Movie'}</small></button>)}</div>{!media.length && <p>No media yet. Add a movie to the catalog to begin.</p>}</section></>}</main>
}

createRoot(document.getElementById('root')).render(key && api ? <ClerkProvider publishableKey={key} signInForceRedirectUrl={appUrl} signUpForceRedirectUrl={appUrl} afterSignOutUrl={appUrl}><SignedOut><main><h1>Media Library</h1><SignInButton mode="modal"><button>Sign in</button></SignInButton></main></SignedOut><SignedIn><App /></SignedIn></ClerkProvider> : <main><h1>Media Library</h1><p>Set VITE_CLERK_PUBLISHABLE_KEY and VITE_API_URL to configure this app.</p></main>)
