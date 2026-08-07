import { describe, expect, it } from 'vitest'

import { SvgSafetyError, sanitizeSvg } from './sanitize-svg.js'

describe('sanitizeSvg', () => {
  it('removes executable content, event handlers, external resources, and dangerous URLs', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><iframe src="https://evil.invalid" /></foreignObject>
        <image id="external" href="https://evil.invalid/pixel.png" />
        <image id="embedded-svg" href="data:image/svg+xml,&lt;svg onload='alert(1)'/&gt;" />
        <a href="javascript:alert(1)"><rect width="20" height="20" /></a>
        <rect id="safe" width="40" height="30" fill="#fff" style="stroke:red;background:url(https://evil.invalid/x)" />
        <use href="#safe" />
      </svg>
    `)

    expect(result.svg).toContain('id="safe"')
    expect(result.svg).toContain('href="#safe"')
    expect(result.svg).not.toMatch(/script|foreignObject|iframe|onload|javascript:/i)
    expect(result.svg).not.toContain('evil.invalid')
    expect(result.svg).not.toContain('data:image/svg+xml')
    expect(result.removedNodeCount).toBeGreaterThanOrEqual(4)
    expect(result.removedAttributeCount).toBeGreaterThanOrEqual(3)
  })

  it('rejects document types, entity declarations, oversized input, and excessive element counts', () => {
    expect(() => sanitizeSvg('<!DOCTYPE svg><svg/>')).toThrowError(SvgSafetyError)
    expect(() => sanitizeSvg('<!ENTITY x SYSTEM "file:///etc/passwd"><svg/>')).toThrowError(
      SvgSafetyError,
    )
    expect(() => sanitizeSvg(`<svg>${'<g/>'.repeat(4)}</svg>`, { maxElements: 3 })).toThrow(
      'SVG_ELEMENT_LIMIT_EXCEEDED',
    )
    expect(() => sanitizeSvg('<svg><rect/></svg>', { maxBytes: 5 })).toThrow(
      'SVG_BYTE_LIMIT_EXCEEDED',
    )
  })

  it('removes external and dangerous url() references from presentation attributes', () => {
    const result = sanitizeSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect id="safe" fill="url(#gradient)" />
        <rect id="external-fill" fill="url(https://evil.invalid/fill.svg)" />
        <rect id="external-filter" filter="url(//evil.invalid/filter.svg)" />
        <rect id="script-mask" mask="url(javascript:alert(1))" />
        <rect id="external-cursor" cursor="url(data:image/svg+xml,&lt;svg/&gt;)" />
      </svg>
    `)

    expect(result.svg).toContain('fill="url(#gradient)"')
    expect(result.svg).not.toMatch(/evil\.invalid|javascript:|data:image\/svg\+xml/i)
    expect(result.removedAttributeCount).toBeGreaterThanOrEqual(4)
  })
})
