import React, { useRef, useState } from 'react'
import { Icon } from './ui'

async function resizeLogo(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG, or WebP image.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    for (const edge of [384, 256, 128]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight))
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of [.84, .68, .5]) {
        const logo = canvas.toDataURL('image/webp', quality)
        if (logo.length <= 180000) return logo
      }
    }
    throw new Error('Unable to compress this image. Try another logo.')
  } finally { URL.revokeObjectURL(url) }
}

export function TeamLogoUpload({ value, onChange, onError, onBusy }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  async function choose(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    onBusy(true)
    try { onChange(await resizeLogo(file)) }
    catch (error) { onError(error.message || 'Unable to open this image. Choose another logo.') }
    finally { setBusy(false); onBusy(false) }
  }
  return <div className="team-logo-control">
    <span className="label" id="team-logo-label">TEAM LOGO</span>
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Choose team logo" accept="image/png,image/jpeg,image/webp" onChange={choose} />
    <button type="button" className={`team-logo-upload ${value ? 'has-logo' : ''}`} aria-labelledby="team-logo-label team-logo-action" disabled={busy} onClick={() => input.current.click()}>
      {value ? <img src={value} alt="Team logo preview" /> : <Icon name="image" size={25} />}
      <span id="team-logo-action">{busy ? 'Preparing...' : value ? 'Change logo' : 'Add logo'}</span>
    </button>
    {value && <button type="button" className="remove-team-logo" disabled={busy} onClick={() => onChange(null)}>Remove logo</button>}
  </div>
}
