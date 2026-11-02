import { useEffect, useRef, useState } from 'react'

export function usePressDragReorder({ disabled = false, onStart, onMove, onDrop }) {
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  const gesture = useRef(null)
  const suppressClick = useRef(false)
  const autoScroll = useRef({ frame: null, speed: 0 })
  const callbacks = useRef({ onStart, onMove, onDrop })
  callbacks.current = { onStart, onMove, onDrop }

  function clearTimer() { if (gesture.current?.timer) clearTimeout(gesture.current.timer) }
  function stopAutoScroll() {
    if (autoScroll.current.frame) cancelAnimationFrame(autoScroll.current.frame)
    autoScroll.current = { frame: null, speed: 0 }
  }
  function updateAutoScroll(pointerY) {
    const edge = Math.min(120, window.innerHeight * .2)
    const maxSpeed = 18
    let speed = 0
    if (pointerY < edge) speed = -maxSpeed * Math.pow((edge - Math.max(0, pointerY)) / edge, 1.5)
    else if (pointerY > window.innerHeight - edge) speed = maxSpeed * Math.pow((Math.min(window.innerHeight, pointerY) - (window.innerHeight - edge)) / edge, 1.5)
    autoScroll.current.speed = speed
    if (!speed) { stopAutoScroll(); return }
    if (autoScroll.current.frame) return
    const scroll = () => {
      if (!gesture.current?.active || !autoScroll.current.speed) { stopAutoScroll(); return }
      window.scrollBy({ top: autoScroll.current.speed })
      autoScroll.current.frame = requestAnimationFrame(scroll)
    }
    autoScroll.current.frame = requestAnimationFrame(scroll)
  }
  function finish(cancelled = false) {
    const current = gesture.current
    if (!current) return
    clearTimer()
    stopAutoScroll()
    gesture.current = null
    setDraggingId(null)
    setOverId(null)
    if (current.suppressClick) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
    if (current.active && !cancelled) callbacks.current.onDrop?.(current.id)
  }
  useEffect(() => () => { clearTimer(); stopAutoScroll() }, [])

  function bind(id, baseClass = '') {
    const className = `${baseClass}${draggingId === id ? ' reorder-dragging' : ''}${overId === id && draggingId !== id ? ' reorder-over' : ''}`
    return {
      'data-reorder-id': id,
      className,
      onPointerDown(event) {
        if (disabled || event.button > 0 || event.target.closest('button,input,a,label')) return
        const row = event.currentTarget
        const current = { id, row, x: event.clientX, y: event.clientY, lastY: event.clientY, active: false, scrolling: false, suppressClick: false }
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
          if (!current.scrolling && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 9) {
            clearTimer()
            current.scrolling = true
          }
          if (current.scrolling) {
            event.preventDefault()
            window.scrollBy({ top: current.lastY - event.clientY })
            current.lastY = event.clientY
          }
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
        updateAutoScroll(event.clientY)
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
