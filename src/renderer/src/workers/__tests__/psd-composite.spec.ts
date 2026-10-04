// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { decodePsdComposite } from '../psd-composite'

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff]
}

function u32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function makePsd(opts: {
  width: number
  height: number
  channels: number
  depth?: number
  colorMode?: number
  compression: number
  imageData: number[]
}): ArrayBuffer {
  const bytes = [
    0x38,
    0x42,
    0x50,
    0x53,
    ...u16(1),
    0,
    0,
    0,
    0,
    0,
    0,
    ...u16(opts.channels),
    ...u32(opts.height),
    ...u32(opts.width),
    ...u16(opts.depth ?? 8),
    ...u16(opts.colorMode ?? 3),
    ...u32(0),
    ...u32(0),
    ...u32(0),
    ...u16(opts.compression),
    ...opts.imageData
  ]

  return Uint8Array.from(bytes).buffer
}

function packLiteral(bytes: number[]): number[] {
  return [bytes.length - 1, ...bytes]
}

function packRepeat(value: number, count: number): number[] {
  return [1 - count, value]
}

describe('decodePsdComposite', () => {
  it('decodes raw 8-bit RGB composite data', () => {
    const buffer = makePsd({
      width: 2,
      height: 1,
      channels: 3,
      compression: 0,
      imageData: [
        255,
        0,
        0,
        255,
        0,
        0
      ]
    })

    const decoded = decodePsdComposite(buffer)

    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect([...decoded.rgba]).toEqual([
      255,
      0,
      0,
      255,
      0,
      255,
      0,
      255
    ])
  })

  it('decodes PackBits RLE RGB composite data', () => {
    const imageData = [
      ...u16(3),
      ...u16(3),
      ...u16(3),
      ...packLiteral([255, 0]),
      ...packLiteral([0, 255]),
      ...packLiteral([0, 0])
    ]
    const buffer = makePsd({
      width: 2,
      height: 1,
      channels: 3,
      compression: 1,
      imageData
    })

    const decoded = decodePsdComposite(buffer)

    expect([...decoded.rgba]).toEqual([
      255,
      0,
      0,
      255,
      0,
      255,
      0,
      255
    ])
  })

  it('uses the fourth RGB channel as alpha when present', () => {
    const buffer = makePsd({
      width: 1,
      height: 1,
      channels: 4,
      compression: 0,
      imageData: [
        10,
        20,
        30,
        128
      ]
    })

    const decoded = decodePsdComposite(buffer)

    expect([...decoded.rgba]).toEqual([10, 20, 30, 128])
  })

  it('decodes grayscale composite data', () => {
    const buffer = makePsd({
      width: 2,
      height: 1,
      channels: 1,
      colorMode: 1,
      compression: 0,
      imageData: [
        32,
        224
      ]
    })

    const decoded = decodePsdComposite(buffer)

    expect([...decoded.rgba]).toEqual([
      32,
      32,
      32,
      255,
      224,
      224,
      224,
      255
    ])
  })

  it('decodes PackBits repeat runs', () => {
    const imageData = [
      ...u16(2),
      ...u16(2),
      ...u16(2),
      ...packRepeat(9, 2),
      ...packRepeat(18, 2),
      ...packRepeat(27, 2)
    ]
    const buffer = makePsd({
      width: 2,
      height: 1,
      channels: 3,
      compression: 1,
      imageData
    })

    const decoded = decodePsdComposite(buffer)

    expect([...decoded.rgba]).toEqual([
      9,
      18,
      27,
      255,
      9,
      18,
      27,
      255
    ])
  })

  it('throws a clear error when RGB channel data is incomplete', () => {
    const buffer = makePsd({
      width: 1,
      height: 1,
      channels: 2,
      compression: 0,
      imageData: [
        255,
        0
      ]
    })

    expect(() => decodePsdComposite(buffer)).toThrow('RGB PSD requires at least 3 channels')
  })
})
