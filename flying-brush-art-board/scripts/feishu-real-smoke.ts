import { pathToFileURL } from 'node:url'

import { mapFeishuNodes } from '../packages/interop/src/feishu/map-nodes.js'

import { resolveAppDataDirectory } from '../apps/local-api/src/data-directory.js'
import { FeishuBoardClient } from '../apps/local-api/src/modules/feishu/board-client.js'
import { EncryptedCredentialStore } from '../apps/local-api/src/modules/feishu/credential-store.js'
import { FeishuWikiDocxClient } from '../apps/local-api/src/modules/feishu/wiki-docx-client.js'
import { resolveWhiteboardToken } from '../apps/local-api/src/modules/feishu/url-resolver.js'

export const FEISHU_SKIPPED_MESSAGE = 'SKIPPED: awaiting user authorization'

type FeishuSmokeEnvironment = Record<string, string | undefined>

export type FeishuRealSmokeGate =
  | { status: 'skipped'; message: typeof FEISHU_SKIPPED_MESSAGE }
  | { status: 'ready' }

export function getFeishuRealSmokeGate(environment: FeishuSmokeEnvironment): FeishuRealSmokeGate {
  const enabled = environment.FEISHU_REAL_SMOKE === '1'
  const hasCredentials = Boolean(environment.FEISHU_APP_ID) && Boolean(environment.FEISHU_APP_SECRET)

  if (!enabled || !hasCredentials) {
    return { status: 'skipped', message: FEISHU_SKIPPED_MESSAGE }
  }

  return { status: 'ready' }
}

export type FeishuRealSmokeResult =
  | { status: 'skipped' }
  | { status: 'oauth-required' }
  | { status: 'target-required' }
  | { status: 'passed'; nodeCount: number; mediaCount: number; previewByteLength: number }

export interface FeishuRealSmokeDependencies {
  credentialStore?: Pick<EncryptedCredentialStore, 'read'>
  resolveWhiteboardToken?: (input: string, client: FeishuWikiDocxClient) => Promise<string>
  client?: Pick<FeishuBoardClient, 'listWhiteboardNodes' | 'getWhiteboardTheme' | 'downloadWhiteboardPreview' | 'downloadMedia'>
  log?: (message: string) => void
  error?: (message: string) => void
}

function realDependencies(): Required<Pick<FeishuRealSmokeDependencies, 'credentialStore' | 'resolveWhiteboardToken' | 'client'>> {
  const credentialStore = new EncryptedCredentialStore({ directory: resolveAppDataDirectory() })
  return {
    credentialStore,
    resolveWhiteboardToken: (input, client) => resolveWhiteboardToken(input, client),
    client: new FeishuBoardClient({ credentials: credentialStore }),
  }
}

function targetFrom(environment: FeishuSmokeEnvironment): string | undefined {
  const target = environment.FEISHU_REAL_WHITEBOARD_URL?.trim()
  return target || undefined
}

export async function runFeishuRealSmoke(
  args: string[] = process.argv.slice(2),
  environment: FeishuSmokeEnvironment = process.env,
  overrides: FeishuRealSmokeDependencies = {},
): Promise<number> {
  const log = overrides.log ?? console.log
  const error = overrides.error ?? console.error
  const gate = getFeishuRealSmokeGate(environment)

  if (gate.status === 'skipped') {
    log(gate.message)
    return 0
  }

  if (args.includes('--gate-only')) {
    log('READY: real Feishu authorization gate is enabled')
    return 0
  }

  const defaults = realDependencies()
  const credentials = overrides.credentialStore ?? defaults.credentialStore
  if (!credentials.read()) {
    error('FEISHU_OAUTH_REQUIRED: start the local API, open /auth/feishu/import/start, and finish the loopback authorization.')
    return 2
  }

  const target = targetFrom(environment)
  if (!target) {
    error('FEISHU_REAL_WHITEBOARD_URL_REQUIRED: set the authorized target Board URL locally in .env.local.')
    return 2
  }

  const client = overrides.client ?? defaults.client
  const resolveToken = overrides.resolveWhiteboardToken ?? defaults.resolveWhiteboardToken
  try {
    const token = await resolveToken(target, new FeishuWikiDocxClient({ credentials }))
    const nodes = await client.listWhiteboardNodes(token)
    await client.getWhiteboardTheme(token)
    const preview = await client.downloadWhiteboardPreview(token)
    const scene = mapFeishuNodes(nodes).value
    const mediaTokens: string[] = []
    for (const element of scene.elements) {
      if (element.type === 'image' && element.src.startsWith('feishu-media://')) {
        mediaTokens.push(element.src.slice('feishu-media://'.length))
      }
    }
    for (const mediaToken of mediaTokens) await client.downloadMedia(mediaToken)
    log(`PASSED: nodes=${scene.elements.length}; media=${mediaTokens.length}; previewBytes=${preview.byteLength}`)
    return 0
  } catch (caught) {
    const code = caught instanceof Error ? caught.message.split(':', 1)[0] : 'FEISHU_REAL_SMOKE_FAILED'
    error(`FAILED: ${code}`)
    return 1
  }
}

const entryPath = process.argv[1]

if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await runFeishuRealSmoke()
}
