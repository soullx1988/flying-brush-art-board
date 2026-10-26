import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('App', () => {
  it('renders the local infinite-board workspace shell only after authentication', async () => {
    render(<App authClient={{ getMe: async () => ({ openId: 'test', name: 'Test User' }), logout: async () => {}, loginUrl: () => '/' }} />)

    expect(await screen.findByRole('heading', { name: '魔灵画板' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建项目' })).toBeInTheDocument()
    expect(screen.getByText('Test')).toHaveAttribute('title', 'Test User')
  })
})
