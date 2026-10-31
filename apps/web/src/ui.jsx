import React, { useEffect, useRef } from 'react'

export function Icon({ name = 'team', size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name === 'plus' ? <path d="M12 5v14M5 12h14" /> : name === 'trash' ? <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></> : name === 'music' ? <><path d="M9 18V5l12-2v13M9 9l12-2" /><ellipse cx="6" cy="18" rx="3" ry="3" /><ellipse cx="18" cy="16" rx="3" ry="3" /></> : name === 'ball' ? <><circle cx="12" cy="12" r="10" fill="white" /><path d="M6.5 4c4 5 4 11 0 16M17.5 4c-4 5-4 11 0 16" stroke="#df5844" strokeDasharray="2 2" /></> : <><circle cx="9" cy="7" r="3" /><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 4a3 3 0 0 1 0 6M18 14a6 6 0 0 1 4 5v2" /></>}</svg>
}
export function Modal({ title, children, onClose, className = '' }) {
  const ref = useRef(null)
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className={`sheet ${className}`} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }} aria-labelledby="dialog-title"><div className="sheet-top"><div className="sheet-icon"><Icon name="music" /></div><button className="close" onClick={onClose} aria-label="Close dialog">×</button></div><h2 id="dialog-title">{title}</h2>{children}</dialog>
}
