const BARE_STYLE_KEYS = new Set([
  'cloud',
  'cylinder',
  'ellipse',
  'group',
  'hexagon',
  'rhombus',
  'swimlane',
  'text',
  'triangle',
])

export function parseDrawioStyle(value: string | undefined): Record<string, string> {
  const style: Record<string, string> = {}
  let previousKey: string | undefined
  for (const rawPart of (value ?? '').split(';')) {
    const part = rawPart.trim()
    if (!part) continue
    const separator = part.indexOf('=')
    const candidateKey = separator >= 0 ? part.slice(0, separator) : part
    if (separator >= 0 && /^[A-Za-z_][\w.-]*$/.test(candidateKey)) {
      previousKey = candidateKey
      style[candidateKey] = part.slice(separator + 1)
      continue
    }
    if (previousKey === 'image') {
      style.image = `${style.image};${part}`
      continue
    }
    previousKey = part
    style[part] = '1'
  }
  return style
}

export function serializeDrawioStyle(style: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => BARE_STYLE_KEYS.has(key) && String(value) === '1'
      ? key
      : `${key}=${String(value)}`)
  return entries.length > 0 ? `${entries.join(';')};` : ''
}

export function drawioShapeName(style: Readonly<Record<string, string>>): string {
  if (style.ellipse === '1') return 'ellipse'
  if (style.rhombus === '1') return 'diamond'
  if (style.triangle === '1') return 'triangle'
  if (style.hexagon === '1') return 'hexagon'
  if (style.cloud === '1') return 'cloud'
  if (style.cylinder === '1') return 'cylinder'
  const shape = style.shape
  if (!shape || shape === 'rectangle') return 'rectangle'
  if (shape === 'rhombus') return 'diamond'
  return shape
}

export function styleForInteropShape(
  shape: string,
  source: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const style = { ...source }
  delete style.url
  for (const key of BARE_STYLE_KEYS) delete style[key]
  if (shape === 'ellipse') style.ellipse = '1'
  else if (shape === 'diamond') style.rhombus = '1'
  else if (shape === 'triangle') style.triangle = '1'
  else if (shape === 'hexagon') style.hexagon = '1'
  else if (shape === 'cloud') style.cloud = '1'
  else if (shape === 'cylinder') style.cylinder = '1'
  else if (shape !== 'rectangle') style.shape = shape
  return style
}
