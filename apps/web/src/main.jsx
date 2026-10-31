import React from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, ClerkLoaded, SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/clerk-react'
import { TeamPage } from './TeamPage'
import { Icon } from './ui'
import { AppLoadingProvider, StartupReady, useAppLoading } from './LoadingScreen'
import './style.css'

const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
function Header({ account }) {
  return <header className="hero">
    <img className="hero-background" src={`${import.meta.env.BASE_URL}hero-background.png`} alt="" fetchPriority="high" />
    <div className="top">
      <img className="hero-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="King Baseball" width="160" height="146" />
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
  if (!user) return null
  return <div className="app"><Header account={<UserButton />} /><TeamPage key={user.id} userId={user.id} /><nav className="bottom-nav" aria-label="Main menu" onClick={event => { const link = event.target.closest("a[href]"); if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; const href = link.getAttribute("href"); if (!href.startsWith("#/")) return; event.preventDefault(); navigate(href) }}><a className="nav-item active" href="#/team" aria-current="page"><Icon /><span>Team</span></a></nav></div>
}
function Welcome() {
  return <div className="app welcome"><Header /><main className="form-panel"><h2>Your team starts here.</h2><p className="welcome-copy">Sign in to create your roster and assign walk-up music.</p>{key ? <SignInButton mode="modal"><button className="save">Sign in to King Baseball <Icon name="arrowRight" size={15} /></button></SignInButton> : <p>Set VITE_CLERK_PUBLISHABLE_KEY to enable sign-in.</p>}</main></div>
}
createRoot(document.getElementById('root')).render(<AppLoadingProvider needsAuthentication={!!key}>{key ? <ClerkProvider publishableKey={key} signInForceRedirectUrl={appUrl} signUpForceRedirectUrl={appUrl} afterSignOutUrl={appUrl}><ClerkLoaded><StartupReady /></ClerkLoaded><SignedOut><Welcome /></SignedOut><SignedIn><App /></SignedIn></ClerkProvider> : <Welcome />}</AppLoadingProvider>)
