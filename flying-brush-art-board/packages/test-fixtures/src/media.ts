import { deflateSync } from 'node:zlib'

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

let crcTable: Uint32Array | undefined

function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, value) => {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    return crc >>> 0
  })
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.byteLength + 12)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.byteLength)
  const typeBytes = new TextEncoder().encode(type)
  result.set(typeBytes, 4)
  result.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(result.subarray(4, 8 + data.byteLength)))
  return result
}

export function createPngFixture(width = 1, height = 1): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('PNG_FIXTURE_DIMENSIONS_INVALID')
  }
  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, width)
  headerView.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const scanlines = new Uint8Array(height * (1 + width * 4))
  for (let row = 0; row < height; row += 1) {
    const rowOffset = row * (1 + width * 4)
    scanlines[rowOffset] = 0
    for (let column = 0; column < width; column += 1) {
      const pixelOffset = rowOffset + 1 + column * 4
      scanlines.set([0x33, 0x70, 0xff, 0xff], pixelOffset)
    }
  }
  const chunks = [pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(scanlines)), pngChunk('IEND', new Uint8Array())]
  const result = new Uint8Array(PNG_SIGNATURE.byteLength + chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  result.set(PNG_SIGNATURE)
  let offset = PNG_SIGNATURE.byteLength
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export const tinyPngFixture = createPngFixture()
