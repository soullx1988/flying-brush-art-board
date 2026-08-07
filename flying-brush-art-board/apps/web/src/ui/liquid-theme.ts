import type { CSSProperties } from 'react'
import { createTheme } from '@ttqtt/liquid-glass-react'

/**
 * Web approximation of the light Apple Liquid Glass material used by the
 * surrounding application chrome. The canvas and tldraw UI are intentionally
 * outside this theme layer.
 */
export const appLiquidTheme = {
  ...createTheme({
    accent: '#171719',
    accentContrast: '#ffffff',
    blur: '6px',
    fallbackBlur: '22px',
    saturation: 1.35,
    refraction: 32,
    tint: 'rgb(255 255 255 / 0.62)',
    tintHover: 'rgb(255 255 255 / 0.78)',
    clearTint: 'rgb(255 255 255 / 0.38)',
    clearTintHover: 'rgb(255 255 255 / 0.56)',
    highlight: 'rgb(255 255 255 / 0.96)',
    shade: 'rgb(54 58 66 / 0.14)',
    dropShadow: 'rgb(38 42 50 / 0.14)',
    ambient: 'rgb(238 242 247 / 0.14)',
    radiusSm: '12px',
    radiusMd: '18px',
    radiusLg: '24px',
    radiusFull: '999px',
    danger: '#c9372c',
    success: '#237a4b',
    warning: '#9a6700',
    text: '#171719',
    textSecondary: '#68686f',
    textDisabled: 'rgb(23 23 25 / 0.38)',
    font: '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
    fontSizeSm: '13px',
    fontSizeMd: '14px',
    fontSizeLg: '16px',
    ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeBounce: 'cubic-bezier(0.2, 0.8, 0.2, 1.08)',
    duration: '180ms',
    durationSlow: '240ms',
    durationPress: '120ms',
    hoverLift: '-1px',
  }),
  '--lg-accent-glass': 'rgb(23 23 25 / 0.92)',
  '--lg-danger-glass': 'rgb(201 55 44 / 0.86)',
} as CSSProperties
