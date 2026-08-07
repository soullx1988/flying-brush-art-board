import { test } from '@playwright/test'

// The real acceptance path is implemented in feishu-import.real.spec.ts.
// Keep this historical test inert so it cannot fail a real-enabled run.
test.skip('legacy real Feishu placeholder', () => {})
