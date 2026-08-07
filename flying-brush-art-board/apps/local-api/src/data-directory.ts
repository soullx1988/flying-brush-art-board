import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export function resolveAppDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
): string {
  const configuredDirectory = environment.INFINITE_BOARD_DATA_DIR?.trim()
  if (configuredDirectory) return configuredDirectory

  const baseDirectory = environment.LOCALAPPDATA ?? environment.APPDATA
  if (baseDirectory) return platform === 'win32' ? win32.join(baseDirectory, 'InfiniteBoard') : posix.join(baseDirectory, 'InfiniteBoard')
  return platform === 'win32'
    ? win32.join(homeDirectory, 'AppData', 'Local', 'InfiniteBoard')
    : posix.join(homeDirectory, '.local', 'share', 'InfiniteBoard')
}
