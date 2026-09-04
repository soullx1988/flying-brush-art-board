import { describe, expect, it } from 'vitest'

import { createPngFixture } from '../../../../../packages/test-fixtures/src/media.js'
import {
  assertAssetContentValid,
  AssetContentValidationError,
  type AssetContentValidationReason,
} from './asset-content-validation.js'

const jpegFixture = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==',
  'base64',
)

function webpFixture(): Uint8Array {
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJQBOgCHwAP7+4AAAAA==', 'base64')
  bytes.writeUInt32LE(bytes.byteLength - 8, 4)
  bytes.writeUInt32LE(bytes.byteLength - 20, 16)
  return bytes
}

const gifFixture = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
const svgFixture = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>')
const pdfFixture = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstartxref\n0\n%%EOF\n')

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function expectInvalid(bytes: Uint8Array, mime: string, reason: AssetContentValidationReason): void {
  try {
    assertAssetContentValid(bytes, mime)
  } catch (error) {
    expect(error).toBeInstanceOf(AssetContentValidationError)
    expect((error as AssetContentValidationError).code).toBe('ASSET_CONTENT_INVALID')
    expect((error as AssetContentValidationError).reason).toBe(reason)
    return
  }
  throw new Error('Expected asset content validation to fail')
}

describe('asset content validation', () => {
  it.each([
    ['image/png', createPngFixture()],
    ['image/jpeg', jpegFixture],
    ['image/webp', webpFixture()],
    ['image/gif', gifFixture],
    ['image/svg+xml', svgFixture],
    ['application/pdf', pdfFixture],
  ])('accepts a structurally valid %s payload', (mime, bytes) => {
    expect(() => assertAssetContentValid(bytes, mime)).not.toThrow()
  })

  it('rejects PNG truncation, CRC corruption, invalid compressed data, and decoded-size bombs synchronously', () => {
    expectInvalid(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png', 'TRUNCATED')

    const crcCorrupt = createPngFixture()
    crcCorrupt[29] = crcCorrupt[29]! ^ 0xff
    expectInvalid(crcCorrupt, 'image/png', 'STRUCTURE_INVALID')

    const compressedCorrupt = createPngFixture()
    const idatLength = new DataView(compressedCorrupt.buffer).getUint32(33)
    compressedCorrupt[41] = compressedCorrupt[41]! ^ 0xff
    new DataView(compressedCorrupt.buffer).setUint32(41 + idatLength, crc32(compressedCorrupt.subarray(37, 41 + idatLength)))
    expectInvalid(compressedCorrupt, 'image/png', 'COMPRESSED_DATA_INVALID')

    const decodedBomb = createPngFixture()
    const view = new DataView(decodedBomb.buffer)
    view.setUint32(16, 10_000)
    view.setUint32(20, 10_000)
    view.setUint32(29, crc32(decodedBomb.subarray(12, 29)))
    expectInvalid(decodedBomb, 'image/png', 'DECODED_SIZE_LIMIT')
  })

  it('rejects MIME spoofing, unsupported types, active SVG, and malformed PDF', () => {
    expectInvalid(createPngFixture(), 'image/jpeg', 'MAGIC_MISMATCH')
    expectInvalid(createPngFixture(), 'application/octet-stream', 'UNSUPPORTED_MIME')
    expectInvalid(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 'image/svg+xml', 'ACTIVE_CONTENT_FORBIDDEN')
    expectInvalid(new TextEncoder().encode('%PDF-broken'), 'application/pdf', 'TRUNCATED')
  })
})
