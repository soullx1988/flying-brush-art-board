import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createInfiniteBoardMcpWorkflowSkill, createWindowsSetupScript } from './mcp-oauth-routes.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

function parseJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as { mcpServers: Record<string, { url?: string; serverUrl?: string }> }
}

describe('Windows MCP v2 setup script', () => {
  it.skipIf(process.platform !== 'win32')('backs up, merges idempotently, preserves other MCPs and refuses damaged JSON', () => {
    const home = mkdtempSync(join(tmpdir(), 'infinite-board-mcp-setup-'))
    directories.push(home)
    const bin = join(home, 'bin')
    const cursorDirectory = join(home, '.cursor')
    const windsurfDirectory = join(home, '.codeium', 'windsurf')
    const codexDirectory = join(home, '.codex')
    mkdirSync(bin, { recursive: true })
    mkdirSync(cursorDirectory, { recursive: true })
    mkdirSync(windsurfDirectory, { recursive: true })
    mkdirSync(codexDirectory, { recursive: true })
    writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\nexit /b 1\r\n', 'utf8')
    writeFileSync(join(codexDirectory, 'config.toml'), '[mcp_servers.other]\nurl="https://other.example/mcp"\n', 'utf8')
    writeFileSync(join(cursorDirectory, 'mcp.json'), JSON.stringify({ mcpServers: { other: { url: 'https://other.example/mcp' } } }), 'utf8')
    writeFileSync(join(windsurfDirectory, 'mcp_config.json'), JSON.stringify({ mcpServers: { other: { url: 'https://other.example/mcp' } } }), 'utf8')
    const scriptPath = join(home, 'setup.ps1')
    const skillSourcePath = join(home, 'InfiniteBoard-MCP-Workflow-SKILL.md')
    const mcpUrl = 'https://192.168.1.20:8443/mcp'
    writeFileSync(scriptPath, createWindowsSetupScript(mcpUrl), 'utf8')
    writeFileSync(skillSourcePath, createInfiniteBoardMcpWorkflowSkill(), 'utf8')
    const environment = { ...process.env, USERPROFILE: home, PATH: `${bin};${process.env.PATH ?? ''}` }

    const first = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { env: environment, encoding: 'utf8' })
    expect(first.status, first.stderr || first.stdout).toBe(0)
    const cursorPath = join(cursorDirectory, 'mcp.json')
    const windsurfPath = join(windsurfDirectory, 'mcp_config.json')
    expect(parseJson(cursorPath).mcpServers).toMatchObject({ other: { url: 'https://other.example/mcp' }, infinite_board: { url: mcpUrl } })
    expect(parseJson(windsurfPath).mcpServers).toMatchObject({ other: { url: 'https://other.example/mcp' }, infinite_board: { serverUrl: mcpUrl } })
    const codexConfig = readFileSync(join(codexDirectory, 'config.toml'), 'utf8')
    expect(codexConfig).toContain('[mcp_servers.other]')
    expect(codexConfig).toContain('[mcp_servers.infinite_board]')
    expect(codexConfig).toContain(`url = "${mcpUrl}"`)
    const installedSkill = join(home, '.agents', 'skills', 'infinite-board-mcp-workflow', 'SKILL.md')
    expect(readFileSync(installedSkill, 'utf8')).toContain('name: infinite-board-mcp-workflow')
    for (const path of [cursorPath, windsurfPath]) expect(readdirSync(join(path, '..')).some((name) => name.startsWith(`${path.split(/[\\/]/).pop()}.bak-`))).toBe(true)

    const second = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { env: environment, encoding: 'utf8' })
    expect(second.status, second.stderr || second.stdout).toBe(0)
    expect(Object.keys(parseJson(join(cursorDirectory, 'mcp.json')).mcpServers).sort()).toEqual(['infinite_board', 'other'])
    expect(readFileSync(join(codexDirectory, 'config.toml'), 'utf8').match(/\[mcp_servers\.infinite_board\]/g)).toHaveLength(1)
    expect(readdirSync(join(installedSkill, '..')).some((name) => name.startsWith('SKILL.md.bak-'))).toBe(true)

    const damagedPath = join(cursorDirectory, 'mcp.json')
    const damaged = '{not valid json'
    writeFileSync(damagedPath, damaged, 'utf8')
    const rejected = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { env: environment, encoding: 'utf8' })
    expect(rejected.status).not.toBe(0)
    expect(readFileSync(damagedPath, 'utf8')).toBe(damaged)
  }, 15_000)
})
