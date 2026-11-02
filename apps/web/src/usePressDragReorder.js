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
  function removeWindowListeners(current) {
    if (!current?.listeners) return
    window.removeEventListener('pointermove', current.listeners.move, true)
    window.removeEventListener('pointerup', current.listeners.up, true)
    window.removeEventListener('pointercancel', current.listeners.cancel, true)
  }
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
    removeWindowListeners(current)
    gesture.current = null
    setDraggingId(null)
    setOverId(null)
    if (current.suppressClick) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
    if (current.active && !cancelled) callbacks.current.onDrop?.(current.id)
  }
  function moveGesture(event, current) {
    if (gesture.current !== current || event.pointerId !== current.pointerId) return
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
      callbacks.current.onMove?.(current.id, targetId)
      navigator.vibrate?.(7)
    }
    updateAutoScroll(event.clientY)
  }
  useEffect(() => () => {
    const current = gesture.current
    clearTimer(); stopAutoScroll(); removeWindowListeners(current); gesture.current = null
  }, [])

  function bind(id, baseClass = '') {
    const className = `${baseClass}${draggingId === id ? ' reorder-dragging' : ''}${overId === id && draggingId !== id ? ' reorder-over' : ''}`
    return {
      'data-reorder-id': id,
      className,
      onPointerDown(event) {
        if (disabled || event.button > 0 || event.target.closest('button,input,a,label')) return
        finish(true)
        const current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, active: false, scrolling: false, suppressClick: false }
        current.listeners = {
          move: moveEvent => moveGesture(moveEvent, current),
          up: upEvent => { if (upEvent.pointerId === current.pointerId) finish(false) },
          cancel: cancelEvent => { if (cancelEvent.pointerId === current.pointerId) finish(true) },
        }
        window.addEventListener('pointermove', current.listeners.move, { passive: false, capture: true })
        window.addEventListener('pointerup', current.listeners.up, { capture: true })
        window.addEventListener('pointercancel', current.listeners.cancel, { capture: true })
        current.timer = setTimeout(() => {
          if (gesture.current !== current) return
          current.active = true
          current.suppressClick = true
          setDraggingId(id); setOverId(id)
          callbacks.current.onStart?.(id)
          navigator.vibrate?.(18)
        }, 425)
        gesture.current = current
      },
      onContextMenu(event) { if (gesture.current?.active) event.preventDefault() },
      onClickCapture(event) {
        if (suppressClick.current) { event.preventDefault(); event.stopPropagation() }
      },
    }
  }
  return { bind, dragging: !!draggingId }
}
