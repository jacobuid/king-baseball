import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const LoadingContext = createContext(null)
export const useAppLoading = () => useContext(LoadingContext)

export function LoadingScreen() {
  return <div className="loading-screen" role="status" aria-label="Loading KingSports">
    <img className="loading-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="KingSports" fetchPriority="high" />
    <span className="sr-only">Loading, please wait.</span>
  </div>
}

export function StartupReady() {
  const { markReady } = useAppLoading()
  useEffect(() => { markReady() }, [markReady])
  return null
}

export function AppLoadingProvider({ children, needsAuthentication }) {
  const [ready, setReady] = useState(!needsAuthentication)
  const [minimumElapsed, setMinimumElapsed] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const navigationTimer = useRef(null)
  const restoreFocus = useRef(null)
  const markReady = useCallback(() => setReady(true), [])
  useEffect(() => {
    let startupTimer
    let stopped = false
    const image = new Image()
    const startMinimum = () => {
      if (stopped || startupTimer) return
      startupTimer = setTimeout(() => setMinimumElapsed(true), 1000)
    }
    // Start the minimum after the logo loads so a cold cache still shows it.
    image.onload = image.onerror = startMinimum
    image.src = `${import.meta.env.BASE_URL}logo.png`
    if (image.complete) startMinimum()
    return () => { stopped = true; image.onload = image.onerror = null; clearTimeout(startupTimer); clearTimeout(navigationTimer.current) }
  }, [])
  const navigate = useCallback(href => {
    restoreFocus.current = document.activeElement
    clearTimeout(navigationTimer.current)
    setTransitioning(true)
    // Keep the existing page mounted so navigating to Team preserves its draft.
    window.location.hash = href.slice(href.indexOf('#'))
    navigationTimer.current = setTimeout(() => {
      setTransitioning(false)
      window.scrollTo({ top: 0, behavior: 'instant' })
    }, 1000)
  }, [])
  const loading = !ready || !minimumElapsed || transitioning
  useEffect(() => {
    if (!loading && restoreFocus.current?.isConnected) {
      restoreFocus.current.focus({ preventScroll: true })
      restoreFocus.current = null
    }
  }, [loading])
  return <LoadingContext.Provider value={{ markReady, navigate }}>
    <div inert={loading ? '' : undefined} aria-hidden={loading ? true : undefined}>{children}</div>
    {loading && <LoadingScreen key={transitioning ? 'navigation' : 'startup'} />}
  </LoadingContext.Provider>
}
