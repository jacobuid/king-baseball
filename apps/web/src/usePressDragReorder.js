import { useEffect, useRef, useState } from 'react'

export function usePressDragReorder({ disabled = false, onStart, onMove, onDrop }) {
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  const gesture = useRef(null)
  const suppressClick = useRef(false)
  const callbacks = useRef({ onStart, onMove, onDrop })
  callbacks.current = { onStart, onMove, onDrop }

  function clearTimer() { if (gesture.current?.timer) clearTimeout(gesture.current.timer) }
  function finish(cancelled = false) {
    const current = gesture.current
    if (!current) return
    clearTimer()
    gesture.current = null
    setDraggingId(null)
    setOverId(null)
    if (current.suppressClick) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
    if (current.active && !cancelled) callbacks.current.onDrop?.(current.id)
  }
  useEffect(() => () => clearTimer(), [])

  function bind(id, baseClass = '') {
    const className = `${baseClass}${draggingId === id ? ' reorder-dragging' : ''}${overId === id && draggingId !== id ? ' reorder-over' : ''}`
    return {
      'data-reorder-id': id,
      className,
      onPointerDown(event) {
        if (disabled || event.button > 0 || event.target.closest('button,input,a,label')) return
        const row = event.currentTarget
        const current = { id, row, x: event.clientX, y: event.clientY, active: false, suppressClick: false }
        current.timer = setTimeout(() => {
          if (gesture.current !== current) return
          current.active = true
          current.suppressClick = true
          row.setPointerCapture?.(event.pointerId)
          setDraggingId(id); setOverId(id)
          callbacks.current.onStart?.(id)
          navigator.vibrate?.(18)
        }, 425)
        gesture.current = current
      },
      onPointerMove(event) {
        const current = gesture.current
        if (!current || current.id !== id) return
        if (!current.active) {
          if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 9) finish(true)
          return
        }
        event.preventDefault()
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-reorder-id]')
        const targetId = target?.dataset.reorderId
        if (targetId && targetId !== current.overId) {
          current.overId = targetId
          setOverId(targetId)
          callbacks.current.onMove?.(id, targetId)
          navigator.vibrate?.(7)
        }
        const edge = 74
        if (event.clientY < edge) window.scrollBy({ top: -10 })
        else if (event.clientY > window.innerHeight - edge) window.scrollBy({ top: 10 })
      },
      onPointerUp() { finish(false) },
      onPointerCancel() { finish(true) },
      onContextMenu(event) { if (gesture.current?.active) event.preventDefault() },
      onClickCapture(event) {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation() }
      },
    }
  }
  return { bind, dragging: !!draggingId }
}
