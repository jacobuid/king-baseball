import React, { useEffect, useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { config } from '@fortawesome/fontawesome-svg-core'
import { faUsers, faUser, faPlus, faTrashCan, faMusic, faBaseball, faBaseballBatBall, faXmark, faChevronRight, faChevronDown, faChevronLeft, faArrowRight, faImage } from '@fortawesome/free-solid-svg-icons'
import '@fortawesome/fontawesome-svg-core/styles.css'

config.autoAddCss = false

const icons = { team: faUsers, user: faUser, plus: faPlus, trash: faTrashCan, music: faMusic, ball: faBaseball, league: faBaseballBatBall, close: faXmark, chevronRight: faChevronRight, chevronDown: faChevronDown, chevronLeft: faChevronLeft, arrowRight: faArrowRight, image: faImage }

export function Icon({ name = 'team', size = 24 }) {
  return <FontAwesomeIcon className={`app-icon icon-${name}`} icon={icons[name] || icons.team} aria-hidden="true" style={{ width: size, height: size }} />
}
export function Modal({ title, children, onClose, className = '', iconName = 'music' }) {
  const ref = useRef(null)
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className={`sheet ${className}`} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }} aria-labelledby="dialog-title"><div className="sheet-top"><div className="sheet-icon"><Icon name={iconName} /></div><button className="close" onClick={onClose} aria-label="Close dialog"><Icon name="close" size={17} /></button></div><h2 id="dialog-title">{title}</h2>{children}</dialog>
}
