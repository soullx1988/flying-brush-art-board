import { cleanupAutomationProjects } from '../../scripts/cleanup-automation-projects.js'

export default function globalTeardown(): void {
  const dataDirectory = process.env.E2E_DATA_DIRECTORY?.trim()
  const automationTag = process.env.E2E_RUN_ID?.trim()
  if (!dataDirectory || !automationTag) {
    throw new Error('Legacy E2E cleanup requires explicit E2E_DATA_DIRECTORY and E2E_RUN_ID')
  }
  const projects = cleanupAutomationProjects({
    dataDirectory,
    automationTag,
    allowMissingDatabase: true,
  })
  if (projects.length > 0) {
    console.log(`Removed ${projects.length} automation project(s) after E2E.`)
  }
}
