import React, { useEffect, useRef, useState } from 'react'
import { DIVISIONS } from '../../../shared/divisions'
import { Icon, Modal } from './ui'

const ROW_HEIGHT = 56
const clamp = index => Math.max(0, Math.min(DIVISIONS.length - 1, index))
export function DivisionPicker({ value, onSave, onClose }) {
  const initial = Math.max(0, DIVISIONS.indexOf(value))
  const [selected, setSelected] = useState(initial)
  const current = useRef(initial)
  const wheel = useRef(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      wheel.current.scrollTop = initial * ROW_HEIGHT
      wheel.current.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [initial])
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  function update(index) {
    if (index === current.current) return
    current.current = index
    setSelected(index)
    if (!reducedMotion()) { try { navigator.vibrate?.(6) } catch {} }
  }
  function moveTo(index) {
    wheel.current.scrollTo({ top: clamp(index) * ROW_HEIGHT, behavior: reducedMotion() ? 'instant' : 'smooth' })
  }
  function commit() { onSave(DIVISIONS[clamp(Math.round(wheel.current.scrollTop / ROW_HEIGHT))]) }
  function keyDown(event) {
    const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }
    if (Object.hasOwn(steps, event.key)) { event.preventDefault(); moveTo(current.current + steps[event.key]) }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); moveTo(event.key === 'Home' ? 0 : DIVISIONS.length - 1) }
    else if (event.key === 'Enter') { event.preventDefault(); commit() }
    else if (/^[a-z0-9]$/i.test(event.key)) {
      event.preventDefault()
      const index = DIVISIONS.findIndex((name, i) => i > current.current && name.toLowerCase().startsWith(event.key.toLowerCase()))
      const fallback = DIVISIONS.findIndex(name => name.toLowerCase().startsWith(event.key.toLowerCase()))
      if (index >= 0 || fallback >= 0) moveTo(index >= 0 ? index : fallback)
    }
  }
  return <Modal title="Pick your division" iconName="team" className="jersey-sheet division-sheet" onClose={onClose}>
    <p className="jersey-player">Find your team's level<span>TEAM DIVISION</span></p>
    <div className="jersey-wheel-frame">
      <div className="jersey-selection" aria-hidden="true"><Icon name="chevronRight" size={15} /><Icon name="chevronLeft" size={15} /></div>
      <div ref={wheel} className="jersey-wheel" role="spinbutton" tabIndex={0} aria-label="Team division" aria-valuemin={0} aria-valuemax={DIVISIONS.length - 1} aria-valuenow={selected} aria-valuetext={DIVISIONS[selected]} onKeyDown={keyDown} onScroll={event => update(clamp(Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)))}>
        {DIVISIONS.map((division, index) => <div key={division} aria-hidden="true" className={`jersey-option ${selected === index ? 'selected' : ''}`} onClick={() => moveTo(index)}>{division}</div>)}
      </div>
    </div>
    <p className="jersey-hint">Swipe to spin. Flick to move faster.<br />Use arrow keys or type a first letter.</p>
    <button className="sheet-save jersey-confirm" onClick={commit}>Use {DIVISIONS[selected]}</button>
    <button className="jersey-clear" onClick={() => onSave(null)}>Clear division</button>
    <p className="jersey-save-note">Then use Save Team to keep your changes.</p>
  </Modal>
}
