import { sql } from 'drizzle-orm'
import Fastify from 'fastify'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'

describe('server dependency compatibility', () => {
  it('loads Fastify, Drizzle ORM and PDF.js', () => {
    expect(Fastify).toBeTypeOf('function')
    expect(sql).toBeTypeOf('function')
    expect(getDocument).toBeTypeOf('function')
  })
})
