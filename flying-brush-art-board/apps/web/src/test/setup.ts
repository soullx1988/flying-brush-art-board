import '@testing-library/jest-dom/vitest'

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: { supports: () => false },
  })
} else if (!globalThis.CSS.supports) {
  Object.defineProperty(globalThis.CSS, 'supports', {
    configurable: true,
    value: () => false,
  })
}
