export interface DecodedPsdComposite {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
}

class PsdReader {
  private view: DataView
  private bytes: Uint8Array
  offset = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
    this.bytes = new Uint8Array(buffer)
  }

  readString(length: number): string {
    this.ensure(length)
    let value = ''
    for (let index = 0; index < length; index += 1) {
      value += String.fromCharCode(this.bytes[this.offset + index])
    }
    this.offset += length
    return value
  }

  readUint16(): number {
    this.ensure(2)
    const value = this.view.getUint16(this.offset, false)
    this.offset += 2
    return value
  }

  readInt8(): number {
    this.ensure(1)
    const value = this.view.getInt8(this.offset)
    this.offset += 1
    return value
  }

  readUint32(): number {
    this.ensure(4)
    const value = this.view.getUint32(this.offset, false)
    this.offset += 4
    return value
  }

  readBytes(length: number): Uint8Array {
    this.ensure(length)
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  skip(length: number): void {
    this.ensure(length)
    this.offset += length
  }

  private ensure(length: number): void {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error('PSD data is truncated')
    }
  }
}

interface PsdHeader {
  channels: number
  width: number
  height: number
  depth: number
  colorMode: number
}

const COLOR_MODE_GRAYSCALE = 1
const COLOR_MODE_RGB = 3
const COLOR_MODE_CMYK = 4
const COMPRESSION_RAW = 0
const COMPRESSION_RLE = 1

export function decodePsdComposite(buffer: ArrayBuffer): DecodedPsdComposite {
  const reader = new PsdReader(buffer)
  const header = readHeader(reader)
  validateHeader(header)

  // Color mode data, image resources, and layer/mask information.
  skipLengthPrefixedSection(reader)
  skipLengthPrefixedSection(reader)
  skipLengthPrefixedSection(reader)

  const bytesPerSample = header.depth / 8
  const compression = reader.readUint16()
  const channelPlanes =
    compression === COMPRESSION_RAW
      ? readRawChannelPlanes(reader, header, bytesPerSample)
      : compression === COMPRESSION_RLE
        ? readRleChannelPlanes(reader, header, bytesPerSample)
        : unsupportedCompression(compression)

  return {
    width: header.width,
    height: header.height,
    rgba: composeRgba(channelPlanes, header, bytesPerSample)
  }
}

function readHeader(reader: PsdReader): PsdHeader {
  if (reader.readString(4) !== '8BPS') throw new Error('Not a PSD file')
  if (reader.readUint16() !== 1) throw new Error('Only PSD version 1 is supported')

  reader.skip(6)
  const channels = reader.readUint16()
  const height = reader.readUint32()
  const width = reader.readUint32()
  const depth = reader.readUint16()
  const colorMode = reader.readUint16()
  return { channels, width, height, depth, colorMode }
}

function validateHeader(header: PsdHeader): void {
  if (header.width <= 0 || header.height <= 0) throw new Error('PSD has invalid dimensions')
  if (header.channels <= 0) throw new Error('PSD has no image channels')
  if (header.depth !== 8 && header.depth !== 16) {
    throw new Error(`Unsupported PSD bit depth: ${header.depth}`)
  }
  if (
    header.colorMode !== COLOR_MODE_RGB &&
    header.colorMode !== COLOR_MODE_GRAYSCALE &&
    header.colorMode !== COLOR_MODE_CMYK
  ) {
    throw new Error(`Unsupported PSD color mode: ${header.colorMode}`)
  }
  if (header.colorMode === COLOR_MODE_RGB && header.channels < 3) {
    throw new Error('RGB PSD requires at least 3 channels')
  }
  if (header.colorMode === COLOR_MODE_CMYK && header.channels < 4) {
    throw new Error('CMYK PSD requires at least 4 channels')
  }
}

function skipLengthPrefixedSection(reader: PsdReader): void {
  const length = reader.readUint32()
  reader.skip(length)
}

function readRawChannelPlanes(
  reader: PsdReader,
  header: PsdHeader,
  bytesPerSample: number
): Uint8Array[] {
  const planeLength = header.width * header.height * bytesPerSample
  const planes: Uint8Array[] = []
  for (let channel = 0; channel < header.channels; channel += 1) {
    planes.push(copyBytes(reader.readBytes(planeLength)))
  }
  return planes
}

function readRleChannelPlanes(
  reader: PsdReader,
  header: PsdHeader,
  bytesPerSample: number
): Uint8Array[] {
  const rowCount = header.channels * header.height
  const byteCounts: number[] = []
  for (let index = 0; index < rowCount; index += 1) byteCounts.push(reader.readUint16())

  const rowLength = header.width * bytesPerSample
  const planeLength = rowLength * header.height
  const planes: Uint8Array[] = []
  for (let channel = 0; channel < header.channels; channel += 1) {
    const plane = new Uint8Array(planeLength)
    for (let row = 0; row < header.height; row += 1) {
      const rowData = reader.readBytes(byteCounts[channel * header.height + row])
      plane.set(decodePackBits(rowData, rowLength), row * rowLength)
    }
    planes.push(plane)
  }
  return planes
}

function decodePackBits(source: Uint8Array, expectedLength: number): Uint8Array {
  const output = new Uint8Array(expectedLength)
  let inputOffset = 0
  let outputOffset = 0

  while (outputOffset < expectedLength && inputOffset < source.length) {
    const value = source[inputOffset++]
    const countByte = value > 127 ? value - 256 : value
    if (countByte >= 0 && countByte <= 127) {
      const count = countByte + 1
      if (inputOffset + count > source.length || outputOffset + count > expectedLength) {
        throw new Error('PSD RLE row is truncated')
      }
      output.set(source.subarray(inputOffset, inputOffset + count), outputOffset)
      inputOffset += count
      outputOffset += count
    } else if (countByte >= -127 && countByte <= -1) {
      if (inputOffset >= source.length) throw new Error('PSD RLE repeat is truncated')
      const count = 1 - countByte
      if (outputOffset + count > expectedLength) {
        throw new Error('PSD RLE repeat exceeds row length')
      }
      output.fill(source[inputOffset++], outputOffset, outputOffset + count)
      outputOffset += count
    }
  }

  if (outputOffset !== expectedLength) throw new Error('PSD RLE row did not decode to the expected length')
  return output
}

function composeRgba(
  channelPlanes: Uint8Array[],
  header: PsdHeader,
  bytesPerSample: number
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(header.width * header.height * 4)
  for (let index = 0; index < header.width * header.height; index += 1) {
    const output = index * 4
    if (header.colorMode === COLOR_MODE_GRAYSCALE) {
      const gray = sample(channelPlanes[0], index, bytesPerSample)
      rgba[output] = gray
      rgba[output + 1] = gray
      rgba[output + 2] = gray
      rgba[output + 3] = channelPlanes[1] ? sample(channelPlanes[1], index, bytesPerSample) : 255
      continue
    }
    if (header.colorMode === COLOR_MODE_CMYK) {
      const cyan = sample(channelPlanes[0], index, bytesPerSample)
      const magenta = sample(channelPlanes[1], index, bytesPerSample)
      const yellow = sample(channelPlanes[2], index, bytesPerSample)
      const black = sample(channelPlanes[3], index, bytesPerSample)
      rgba[output] = 255 - Math.min(255, cyan + black)
      rgba[output + 1] = 255 - Math.min(255, magenta + black)
      rgba[output + 2] = 255 - Math.min(255, yellow + black)
      rgba[output + 3] = channelPlanes[4] ? sample(channelPlanes[4], index, bytesPerSample) : 255
      continue
    }
    rgba[output] = sample(channelPlanes[0], index, bytesPerSample)
    rgba[output + 1] = sample(channelPlanes[1], index, bytesPerSample)
    rgba[output + 2] = sample(channelPlanes[2], index, bytesPerSample)
    rgba[output + 3] = channelPlanes[3] ? sample(channelPlanes[3], index, bytesPerSample) : 255
  }
  return rgba
}

function sample(plane: Uint8Array | undefined, pixelIndex: number, bytesPerSample: number): number {
  if (!plane) return 0
  return plane[pixelIndex * bytesPerSample] ?? 0
}

function unsupportedCompression(compression: number): never {
  throw new Error(`Unsupported PSD compression: ${compression}`)
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy
}
