import React, { useEffect, useRef, useState } from 'react'
import { Icon, Modal } from './ui'

const ROW_HEIGHT = 56
const numbers = Array.from({ length: 100 }, (_, number) => String(number).padStart(2, '0'))
const clamp = number => Math.max(0, Math.min(99, number))
export function JerseyPicker({ player, onSave, onClose }) {
  const initial = Number(player.jerseyNumber || 0)
  const [selected, setSelected] = useState(initial)
  const current = useRef(initial)
  const wheel = useRef(null)
  const typed = useRef('')
  const lastTyped = useRef(0)
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      wheel.current.scrollTop = initial * ROW_HEIGHT
      wheel.current.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [initial])
  function update(number) {
    if (number === current.current) return
    current.current = number
    setSelected(number)
    // Unsupported browsers simply keep the visual detent without vibration.
    if (!reduceMotion()) { try { navigator.vibrate?.(6) } catch { /* Device may disallow vibration. */ } }
  }
  function moveTo(number) {
    wheel.current.scrollTo({ top: clamp(number) * ROW_HEIGHT, behavior: reduceMotion() ? 'instant' : 'smooth' })
  }
  function keyDown(event) {
    const actions = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }
    if (Object.hasOwn(actions, event.key)) { event.preventDefault(); moveTo(current.current + actions[event.key]) }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); moveTo(event.key === 'Home' ? 0 : 99) }
    else if (/^\d$/.test(event.key)) {
      event.preventDefault()
      typed.current = Date.now() - lastTyped.current < 900 ? (typed.current + event.key).slice(-2) : event.key
      lastTyped.current = Date.now()
      moveTo(Number(typed.current))
    } else if (event.key === 'Enter') { event.preventDefault(); commit() }
  }
  function commit() {
    const number = clamp(Math.round(wheel.current.scrollTop / ROW_HEIGHT))
    onSave(numbers[number])
  }
  return <Modal title="Pick their number" iconName="team" className="jersey-sheet" onClose={onClose}>
    <p className="jersey-player">{player.name}<span>JERSEY NUMBER</span></p>
    <div className="jersey-wheel-frame">
      <div className="jersey-selection" aria-hidden="true"><span>›</span><span>‹</span></div>
      <div ref={wheel} className="jersey-wheel" role="spinbutton" tabIndex={0} aria-label={`Jersey number for ${player.name}`} aria-valuemin={0} aria-valuemax={99} aria-valuenow={selected} aria-valuetext={numbers[selected]} onKeyDown={keyDown} onScroll={event => update(clamp(Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)))}>
        {numbers.map((number, index) => <div key={number} aria-hidden="true" className={`jersey-option ${selected === index ? 'selected' : ''}`} onClick={() => moveTo(index)}>{number}</div>)}
      </div>
    </div>
    <p className="jersey-hint">Swipe to spin · Flick to move faster<br />Or use arrow keys and type a number.</p>
    <button className="sheet-save jersey-confirm" onClick={commit}>Use number {numbers[selected]}</button>
    <button className="jersey-clear" onClick={() => onSave(null)}>Clear jersey number</button>
    <p className="jersey-save-note">Then use Save Team to keep your changes.</p>
  </Modal>
}
