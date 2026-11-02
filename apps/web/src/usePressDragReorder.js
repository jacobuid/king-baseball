import { useEffect, useRef, useState } from 'react'

export function usePressDragReorder({ disabled = false, onStart, onMove, onDrop }) {
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  const gesture = useRef(null)
  const suppressClick = useRef(false)
  const autoScroll = useRef({ frame: null, speed: 0 })
  const reorderAnimations = useRef(new WeakMap())
  const callbacks = useRef({ onStart, onMove, onDrop })
  callbacks.current = { onStart, onMove, onDrop }

  function clearTimer() { if (gesture.current?.timer) clearTimeout(gesture.current.timer) }
  function removeWindowListeners(current) {
    if (!current?.listeners) return
    window.removeEventListener('pointermove', current.listeners.move, true)
    window.removeEventListener('pointerup', current.listeners.up, true)
    window.removeEventListener('pointercancel', current.listeners.cancel, true)
    window.removeEventListener('touchmove', current.listeners.touchMove, true)
    window.removeEventListener('touchend', current.listeners.touchEnd, true)
    window.removeEventListener('touchcancel', current.listeners.touchCancel, true)
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
      if (current.isTouch) return
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
    if (targetId && targetId !== current.overId && performance.now() - (current.lastSwap || 0) > 220) {
      const before = new Map([...document.querySelectorAll('[data-reorder-id]')].map(row => [row.dataset.reorderId, row.getBoundingClientRect()]))
      current.lastSwap = performance.now()
      current.overId = targetId
      setOverId(targetId)
      callbacks.current.onMove?.(current.id, targetId)
      navigator.vibrate?.(7)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelectorAll('[data-reorder-id]').forEach(row => {
          const previous = before.get(row.dataset.reorderId)
          if (!previous) return
          const next = row.getBoundingClientRect()
          const delta = previous.top - next.top
          if (Math.abs(delta) < 1 || !row.animate) return
          reorderAnimations.current.get(row)?.cancel()
          const scale = row.dataset.reorderId === current.id ? ' scale(1.045)' : ''
          const animation = row.animate([{ transform: `translateY(${delta}px)${scale}` }, { transform: `translateY(0)${scale}` }], { duration: 400, easing: 'cubic-bezier(.22, 1, .36, 1)' })
          reorderAnimations.current.set(row, animation)
          animation.onfinish = () => reorderAnimations.current.delete(row)
        })
      }))
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
        const current = { id, pointerId: event.pointerId, isTouch: event.pointerType === 'touch', x: event.clientX, y: event.clientY, lastY: event.clientY, active: false, scrolling: false, suppressClick: false }
        current.listeners = {
          move: moveEvent => moveGesture(moveEvent, current),
          up: upEvent => { if (upEvent.pointerId === current.pointerId) finish(false) },
          cancel: cancelEvent => { if (cancelEvent.pointerId === current.pointerId) finish(true) },
          touchMove: moveEvent => {
            const touch = moveEvent.touches[0]
            if (!touch) return
            if (current.active) moveEvent.preventDefault()
            moveGesture({ clientX: touch.clientX, clientY: touch.clientY, pointerId: current.pointerId, preventDefault: () => moveEvent.preventDefault() }, current)
          },
          touchEnd: () => finish(false),
          touchCancel: () => finish(true),
        }
        if (current.isTouch) {
          window.addEventListener('touchmove', current.listeners.touchMove, { passive: false, capture: true })
          window.addEventListener('touchend', current.listeners.touchEnd, { capture: true })
          window.addEventListener('touchcancel', current.listeners.touchCancel, { capture: true })
        } else {
          window.addEventListener('pointermove', current.listeners.move, { passive: false, capture: true })
          window.addEventListener('pointerup', current.listeners.up, { capture: true })
          window.addEventListener('pointercancel', current.listeners.cancel, { capture: true })
        }
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
