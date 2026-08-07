import { cleanupAutomationProjects } from '../../scripts/cleanup-automation-projects.js'

export default function globalTeardown(): void {
  const projects = cleanupAutomationProjects()
  if (projects.length > 0) {
    console.log(`Removed ${projects.length} automation project(s) after E2E.`)
  }
}
