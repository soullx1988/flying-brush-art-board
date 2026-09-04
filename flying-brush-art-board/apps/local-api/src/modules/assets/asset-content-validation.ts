import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'

export const supportedAssetMimeTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
] as const

export type SupportedAssetMime = (typeof supportedAssetMimeTypes)[number]

export type AssetContentValidationReason =
  | 'UNSUPPORTED_MIME'
  | 'EMPTY'
  | 'MAGIC_MISMATCH'
  | 'TRUNCATED'
  | 'STRUCTURE_INVALID'
  | 'DIMENSIONS_INVALID'
  | 'DECODED_SIZE_LIMIT'
  | 'COMPRESSED_DATA_INVALID'
  | 'ACTIVE_CONTENT_FORBIDDEN'

const MAX_IMAGE_DIMENSION = 32_768
const MAX_IMAGE_PIXELS = 100_000_000
const MAX_DECODED_PNG_BYTES = 128 * 1024 * 1024
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export class AssetContentValidationError extends Error {
  readonly code = 'ASSET_CONTENT_INVALID'

  constructor(readonly reason: AssetContentValidationReason) {
    super(`ASSET_CONTENT_INVALID:${reason}`)
    this.name = 'AssetContentValidationError'
  }
}

function invalid(reason: AssetContentValidationReason): never {
  throw new AssetContentValidationError(reason)
}

function equalsAt(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (offset < 0 || offset + expected.byteLength > bytes.byteLength) return false
  return expected.every((value, index) => bytes[offset + index] === value)
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! * 0x1000000)
    + (bytes[offset + 1]! << 16)
    + (bytes[offset + 2]! << 8)
    + bytes[offset + 3]!) >>> 0
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]!
    + (bytes[offset + 1]! << 8)
    + (bytes[offset + 2]! << 16)
    + (bytes[offset + 3]! * 0x1000000)) >>> 0
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0
    || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS) {
    invalid('DIMENSIONS_INVALID')
  }
}

let crcTable: Uint32Array | undefined

function pngCrc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    return crc >>> 0
  })
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

interface PngPass {
  width: number
  height: number
  rowBytes: number
}

function pngPasses(width: number, height: number, bitsPerPixel: number, interlace: number): PngPass[] {
  const definitions = interlace === 0
    ? [[0, 0, 1, 1]]
    : [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
  return definitions.flatMap(([startX, startY, stepX, stepY]) => {
    const passWidth = width <= startX! ? 0 : Math.ceil((width - startX!) / stepX!)
    const passHeight = height <= startY! ? 0 : Math.ceil((height - startY!) / stepY!)
    if (passWidth === 0 || passHeight === 0) return []
    return [{ width: passWidth, height: passHeight, rowBytes: Math.ceil((passWidth * bitsPerPixel) / 8) }]
  })
}

function validatePng(bytes: Uint8Array): void {
  if (!equalsAt(bytes, 0, PNG_SIGNATURE)) invalid('MAGIC_MISMATCH')
  if (bytes.byteLength < 8 + 12 + 13 + 12) invalid('TRUNCATED')

  let offset = 8
  let chunkIndex = 0
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  let sawPalette = false
  let sawIdat = false
  let idatEnded = false
  let sawIend = false
  const idatParts: Uint8Array[] = []
  let idatSize = 0

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) invalid('TRUNCATED')
    const length = uint32be(bytes, offset)
    if (length > 64 * 1024 * 1024 || offset + 12 + length > bytes.byteLength) invalid('TRUNCATED')
    const type = asciiAt(bytes, offset + 4, 4)
    if (!/^[A-Za-z]{4}$/.test(type)) invalid('STRUCTURE_INVALID')
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const storedCrc = uint32be(bytes, dataEnd)
    if (pngCrc32(bytes.subarray(offset + 4, dataEnd)) !== storedCrc) invalid('STRUCTURE_INVALID')

    if (chunkIndex === 0 && type !== 'IHDR') invalid('STRUCTURE_INVALID')
    if (sawIend) invalid('STRUCTURE_INVALID')
    if (sawIdat && type !== 'IDAT') idatEnded = true

    switch (type) {
      case 'IHDR': {
        if (chunkIndex !== 0 || length !== 13 || width !== 0) invalid('STRUCTURE_INVALID')
        width = uint32be(bytes, dataStart)
        height = uint32be(bytes, dataStart + 4)
        bitDepth = bytes[dataStart + 8]!
        colorType = bytes[dataStart + 9]!
        const compression = bytes[dataStart + 10]!
        const filter = bytes[dataStart + 11]!
        interlace = bytes[dataStart + 12]!
        assertDimensions(width, height)
        const allowedDepths: Record<number, readonly number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        }
        if (!allowedDepths[colorType]?.includes(bitDepth)
          || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
          invalid('STRUCTURE_INVALID')
        }
        break
      }
      case 'PLTE':
        if (sawPalette || sawIdat || length === 0 || length % 3 !== 0 || length > 768 || colorType === 0 || colorType === 4) {
          invalid('STRUCTURE_INVALID')
        }
        sawPalette = true
        break
      case 'IDAT':
        if (idatEnded || width === 0 || (colorType === 3 && !sawPalette)) invalid('STRUCTURE_INVALID')
        sawIdat = true
        idatSize += length
        if (idatSize > 64 * 1024 * 1024) invalid('DECODED_SIZE_LIMIT')
        idatParts.push(bytes.subarray(dataStart, dataEnd))
        break
      case 'IEND':
        if (!sawIdat || length !== 0) invalid('STRUCTURE_INVALID')
        sawIend = true
        break
      default:
        // Unknown critical chunks are not forward-compatible by definition.
        if (type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90) invalid('STRUCTURE_INVALID')
    }

    offset = dataEnd + 4
    chunkIndex += 1
    if (type === 'IEND') break
  }

  if (!sawIend || offset !== bytes.byteLength) invalid('STRUCTURE_INVALID')
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]
  if (!channels) invalid('STRUCTURE_INVALID')
  const passes = pngPasses(width, height, channels * bitDepth, interlace)
  const expectedLength = passes.reduce((total, pass) => total + pass.height * (pass.rowBytes + 1), 0)
  if (expectedLength <= 0 || expectedLength > MAX_DECODED_PNG_BYTES) invalid('DECODED_SIZE_LIMIT')

  const compressed = new Uint8Array(idatSize)
  let compressedOffset = 0
  for (const part of idatParts) {
    compressed.set(part, compressedOffset)
    compressedOffset += part.byteLength
  }
  let decoded: Buffer
  try {
    decoded = inflateSync(compressed, { maxOutputLength: expectedLength })
  } catch {
    invalid('COMPRESSED_DATA_INVALID')
  }
  if (decoded.byteLength !== expectedLength) invalid('COMPRESSED_DATA_INVALID')
  let decodedOffset = 0
  for (const pass of passes) {
    for (let row = 0; row < pass.height; row += 1) {
      if (decoded[decodedOffset] === undefined || decoded[decodedOffset]! > 4) invalid('COMPRESSED_DATA_INVALID')
      decodedOffset += pass.rowBytes + 1
    }
  }
  if (decodedOffset !== decoded.byteLength) invalid('COMPRESSED_DATA_INVALID')
}

function validateJpeg(bytes: Uint8Array): void {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid('MAGIC_MISMATCH')
  let offset = 2
  let marker: number | undefined
  let sawFrame = false
  let sawScan = false

  while (offset < bytes.byteLength || marker !== undefined) {
    if (marker === undefined) {
      if (bytes[offset] !== 0xff) invalid('STRUCTURE_INVALID')
      while (bytes[offset] === 0xff) offset += 1
      if (offset >= bytes.byteLength) invalid('TRUNCATED')
      marker = bytes[offset++]!
    }

    if (marker === 0xd9) {
      if (!sawFrame || !sawScan || offset !== bytes.byteLength) invalid('STRUCTURE_INVALID')
      return
    }
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) invalid('STRUCTURE_INVALID')
    if (marker === 0x01) {
      marker = undefined
      continue
    }
    if (offset + 2 > bytes.byteLength) invalid('TRUNCATED')
    const segmentLength = uint16be(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) invalid('TRUNCATED')
    const segmentStart = offset + 2
    const segmentEnd = offset + segmentLength
    const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
    if (isStartOfFrame) {
      if (segmentLength < 8) invalid('STRUCTURE_INVALID')
      assertDimensions(uint16be(bytes, segmentStart + 3), uint16be(bytes, segmentStart + 1))
      sawFrame = true
    }
    const isScan = marker === 0xda
    offset = segmentEnd
    marker = undefined
    if (!isScan) continue

    if (!sawFrame) invalid('STRUCTURE_INVALID')
    sawScan = true
    let foundNextMarker = false
    while (offset < bytes.byteLength) {
      if (bytes[offset++] !== 0xff) continue
      while (bytes[offset] === 0xff) offset += 1
      if (offset >= bytes.byteLength) invalid('TRUNCATED')
      const candidate = bytes[offset++]!
      if (candidate === 0x00 || (candidate >= 0xd0 && candidate <= 0xd7)) continue
      marker = candidate
      foundNextMarker = true
      break
    }
    if (!foundNextMarker) invalid('TRUNCATED')
  }
  invalid('TRUNCATED')
}

function validateWebp(bytes: Uint8Array): void {
  if (bytes.byteLength < 20
    || asciiAt(bytes, 0, 4) !== 'RIFF'
    || asciiAt(bytes, 8, 4) !== 'WEBP') invalid('MAGIC_MISMATCH')
  if (uint32le(bytes, 4) !== bytes.byteLength - 8) invalid('STRUCTURE_INVALID')
  let offset = 12
  let sawPayload = false
  let sawDimensions = false
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) invalid('TRUNCATED')
    const type = asciiAt(bytes, offset, 4)
    const length = uint32le(bytes, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const paddedEnd = dataEnd + (length & 1)
    if (dataEnd < dataStart || paddedEnd > bytes.byteLength) invalid('TRUNCATED')
    if (type === 'VP8X') {
      if (length !== 10) invalid('STRUCTURE_INVALID')
      assertDimensions(uint24le(bytes, dataStart + 4) + 1, uint24le(bytes, dataStart + 7) + 1)
      sawDimensions = true
    } else if (type === 'VP8 ') {
      if (length < 10 || bytes[dataStart + 3] !== 0x9d || bytes[dataStart + 4] !== 0x01 || bytes[dataStart + 5] !== 0x2a) {
        invalid('STRUCTURE_INVALID')
      }
      assertDimensions(uint16le(bytes, dataStart + 6) & 0x3fff, uint16le(bytes, dataStart + 8) & 0x3fff)
      sawPayload = true
      sawDimensions = true
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[dataStart] !== 0x2f) invalid('STRUCTURE_INVALID')
      const bits = uint32le(bytes, dataStart + 1)
      assertDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
      sawPayload = true
      sawDimensions = true
    } else if (type === 'ANMF') {
      if (length < 16) invalid('STRUCTURE_INVALID')
      assertDimensions(uint24le(bytes, dataStart + 6) + 1, uint24le(bytes, dataStart + 9) + 1)
      sawPayload = true
      sawDimensions = true
    }
    offset = paddedEnd
  }
  if (offset !== bytes.byteLength || !sawPayload || !sawDimensions) invalid('STRUCTURE_INVALID')
}

function skipGifSubBlocks(bytes: Uint8Array, initialOffset: number): number {
  let offset = initialOffset
  while (true) {
    if (offset >= bytes.byteLength) invalid('TRUNCATED')
    const length = bytes[offset++]!
    if (length === 0) return offset
    if (offset + length > bytes.byteLength) invalid('TRUNCATED')
    offset += length
  }
}

function validateGif(bytes: Uint8Array): void {
  if (bytes.byteLength < 14 || !['GIF87a', 'GIF89a'].includes(asciiAt(bytes, 0, 6))) invalid('MAGIC_MISMATCH')
  assertDimensions(uint16le(bytes, 6), uint16le(bytes, 8))
  let offset = 13
  const globalPacked = bytes[10]!
  if (globalPacked & 0x80) offset += 3 * (1 << ((globalPacked & 0x07) + 1))
  if (offset > bytes.byteLength) invalid('TRUNCATED')
  let sawImage = false
  while (offset < bytes.byteLength) {
    const marker = bytes[offset++]!
    if (marker === 0x3b) {
      if (!sawImage || offset !== bytes.byteLength) invalid('STRUCTURE_INVALID')
      return
    }
    if (marker === 0x2c) {
      if (offset + 9 > bytes.byteLength) invalid('TRUNCATED')
      assertDimensions(uint16le(bytes, offset + 4), uint16le(bytes, offset + 6))
      const packed = bytes[offset + 8]!
      offset += 9
      if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1))
      if (offset >= bytes.byteLength) invalid('TRUNCATED')
      const lzwMinimumCodeSize = bytes[offset++]!
      if (lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) invalid('STRUCTURE_INVALID')
      offset = skipGifSubBlocks(bytes, offset)
      sawImage = true
      continue
    }
    if (marker !== 0x21 || offset >= bytes.byteLength) invalid('STRUCTURE_INVALID')
    const label = bytes[offset++]!
    if (label === 0xf9) {
      if (offset + 6 > bytes.byteLength || bytes[offset] !== 4 || bytes[offset + 5] !== 0) invalid('TRUNCATED')
      offset += 6
    } else if (label === 0x01) {
      if (offset >= bytes.byteLength || bytes[offset] !== 12 || offset + 13 > bytes.byteLength) invalid('TRUNCATED')
      offset = skipGifSubBlocks(bytes, offset + 13)
    } else {
      offset = skipGifSubBlocks(bytes, offset)
    }
  }
  invalid('TRUNCATED')
}

function validateSvg(bytes: Uint8Array): void {
  let source: string
  try {
    source = textDecoder.decode(bytes)
  } catch {
    invalid('STRUCTURE_INVALID')
  }
  const normalized = source
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[^?]*\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  if (!/^<svg(?:\s|\/?>)/i.test(normalized)
    || (!/<\/svg>\s*$/i.test(normalized) && !/\/>\s*$/.test(normalized))) {
    invalid('MAGIC_MISMATCH')
  }
  if (/<!DOCTYPE|<!ENTITY|<\?|<(?:[A-Za-z_][\w.-]*:)?script(?:\s|\/?>)|<(?:[A-Za-z_][\w.-]*:)?foreignObject(?:\s|\/?>)|@import|\son[a-z]+\s*=/i.test(normalized)) {
    invalid('ACTIVE_CONTENT_FORBIDDEN')
  }
  const externalReference = /\b(?:href|xlink:href|src)\s*=\s*(["'])(.*?)\1/gi
  for (const match of normalized.matchAll(externalReference)) {
    const value = match[2]!.trim()
    if (!value.startsWith('#') && !/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)) {
      invalid('ACTIVE_CONTENT_FORBIDDEN')
    }
  }
  const cssUrls = normalized.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)
  for (const match of cssUrls) {
    if (!match[2]!.trim().startsWith('#')) invalid('ACTIVE_CONTENT_FORBIDDEN')
  }
}

function validatePdf(bytes: Uint8Array): void {
  if (bytes.byteLength < 32) invalid('TRUNCATED')
  const prefix = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 1024))).toString('latin1')
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r?\n|\r)/.test(prefix)) invalid('MAGIC_MISMATCH')
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 4096))).toString('latin1')
  if (!/startxref\s+\d+\s+%%EOF\s*$/.test(tail)
    || !/\d+\s+\d+\s+obj\b/.test(Buffer.from(bytes).toString('latin1'))) {
    invalid('STRUCTURE_INVALID')
  }
}

export function assertAssetContentValid(bytes: Uint8Array, mime: string): asserts mime is SupportedAssetMime {
  if (bytes.byteLength === 0) invalid('EMPTY')
  switch (mime) {
    case 'image/png': return validatePng(bytes)
    case 'image/jpeg': return validateJpeg(bytes)
    case 'image/webp': return validateWebp(bytes)
    case 'image/gif': return validateGif(bytes)
    case 'image/svg+xml': return validateSvg(bytes)
    case 'application/pdf': return validatePdf(bytes)
    default: return invalid('UNSUPPORTED_MIME')
  }
}
