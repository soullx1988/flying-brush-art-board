const API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:8877'

export default async function destructiveGlobalTeardown(): Promise<void> {
  const shutdownToken = process.env.E2E_SHUTDOWN_TOKEN?.trim()
  if (!shutdownToken) throw new Error('E2E_SHUTDOWN_TOKEN is required for destructive test cleanup')

  let response: Response
  try {
    response = await fetch(`${API_BASE}/__e2e/shutdown`, {
      method: 'POST',
      headers: { 'x-e2e-shutdown-token': shutdownToken },
    })
  } catch {
    return
  }
  if (!response.ok) {
    throw new Error(`Isolated E2E API refused cleanup with HTTP ${response.status}`)
  }
  await response.json()

  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(250) })
    } catch {
      return
    }
  }
  throw new Error('Isolated E2E API did not stop within five seconds')
}
