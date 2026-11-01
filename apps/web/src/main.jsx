import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, ClerkLoaded, SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/clerk-react'
import { TeamEdit } from './TeamEdit'
import { TeamView } from './TeamView'
import { Icon } from './ui'
import { AppLoadingProvider, StartupReady, useAppLoading } from './LoadingScreen'
import './style.css'
import './theme.css'
import './zoom.css'
import './orientation.css'

const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
function Header({ account }) {
  return <header className="hero">
    <img className="hero-background" src={`${import.meta.env.BASE_URL}hero-background.png`} alt="" fetchPriority="high" />
    <div className="top">
      <img className="hero-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="KingSports" width="160" height="146" />
      {account && <div className="hero-account">{account}</div>}
    </div>
    <div className="intro">
      <div className="eyebrow">YOUR LINEUP STARTS HERE</div>
      <h1>Create your<br /><em>team.</em></h1>
      <p>Build your roster. Give every player<br />their own walk-up music.</p>
    </div>
  </header>
}
function App() {
  const { user } = useUser()
  const { navigate } = useAppLoading()
  const getRoute = () => window.location.hash === '#/team/edit' ? 'edit' : 'view'
  const [route, setRoute] = useState(getRoute)
  const routeRef = useRef(route)
  const dirty = useRef(false)
  const saving = useRef(false)
  const onDirtyChange = useCallback(value => { dirty.current = value }, [])
  const onSavingChange = useCallback(value => { saving.current = value }, [])
  function canLeave() {
    if (saving.current) { window.alert('Your team is saving. Please wait.'); return false }
    return !dirty.current || window.confirm('Leave without saving your team changes?')
  }
  useEffect(() => {
    const change = () => {
      const next = getRoute()
      if (next !== routeRef.current && !canLeave()) {
        window.history.replaceState(null, '', routeRef.current === 'edit' ? '#/team/edit' : '#/team')
        return
      }
      routeRef.current = next
      setRoute(next)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  function go(href) {
    const next = href === '#/team/edit' ? 'edit' : 'view'
    if (next !== routeRef.current && !canLeave()) return
    // The route listener must not ask twice after a confirmed departure.
    if (next !== routeRef.current) dirty.current = false
    navigate(href)
  }
  if (!user) return null
  return <div className={`app ${route === 'view' ? 'team-view-app' : ''}`}>
    <Header account={<UserButton />} />
    {route === 'edit' ? <TeamEdit key={`edit-${user.id}`} userId={user.id} onDirtyChange={onDirtyChange} onSavingChange={onSavingChange} onSaved={() => go('#/team')} /> : <TeamView key={`view-${user.id}`} userId={user.id} onEdit={() => go('#/team/edit')} />}
    <nav className="bottom-nav" aria-label="Main menu" onClick={event => {
      const link = event.target.closest('a[href]')
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const href = link.getAttribute('href')
      if (!href.startsWith('#/')) return
      event.preventDefault()
      go(href)
    }}><a className="nav-item active" href="#/team" aria-current="page"><Icon /><span>Team</span></a></nav>
  </div>
}
function Welcome() {
  return <div className="app welcome">
    <img className="welcome-background" src={`${import.meta.env.BASE_URL}hero-background.png`} alt="" fetchPriority="high" />
    <header className="welcome-brand"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="KingSports" width="160" height="146" /></header>
    <main className="welcome-panel">
      <p className="welcome-eyebrow">YOUR LINEUP STARTS HERE</p>
      <h1>Your team<br />starts here.</h1>
      <p className="welcome-copy">Sign in to create your roster and give every player their own walk-up music.</p>
      {key ? <SignInButton mode="modal"><button className="save welcome-sign-in">Sign in to KingSports <Icon name="arrowRight" size={15} /></button></SignInButton> : <p>Set VITE_CLERK_PUBLISHABLE_KEY to enable sign-in.</p>}
    </main>
  </div>
}
function OrientationLock() {
  useEffect(() => {
    const lockPortrait = () => {
      const request = window.screen.orientation?.lock?.('portrait-primary')
      request?.catch(() => {})
    }
    lockPortrait()
    window.addEventListener('orientationchange', lockPortrait)
    return () => window.removeEventListener('orientationchange', lockPortrait)
  }, [])
  return <div className="orientation-lock" role="status" aria-live="polite">
    <img src={`${import.meta.env.BASE_URL}logo.png`} alt="KingSports" />
    <strong>Rotate your device</strong>
    <span>KingSports is designed for portrait mode.</span>
  </div>
}
createRoot(document.getElementById('root')).render(<><AppLoadingProvider needsAuthentication={!!key}>{key ? <ClerkProvider publishableKey={key} signInForceRedirectUrl={appUrl} signUpForceRedirectUrl={appUrl} afterSignOutUrl={appUrl}><ClerkLoaded><StartupReady /></ClerkLoaded><SignedOut><Welcome /></SignedOut><SignedIn><App /></SignedIn></ClerkProvider> : <Welcome />}</AppLoadingProvider><OrientationLock /></>)
