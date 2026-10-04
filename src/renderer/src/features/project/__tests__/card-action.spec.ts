import { describe, expect, it } from 'vitest'
import {
  PHOTOSHOP_NOT_CONFIGURED_MESSAGE,
  TOOL_NOT_CONFIGURED_MESSAGE,
  derivePhotoshopPath,
  resolveCardAction,
  type CardActionConfig
} from '../card-action'
import type { WorkMode } from '@shared/types'

const EMPTY: CardActionConfig = {
  translationToolPath: '',
  photoshopPath: '',
  importScriptPath: '',
  skipPsFallbackPrompt: false
}

const PS = 'E:\\Apply\\PS\\Adobe Photoshop 2026\\Photoshop.exe'
const JSX = 'E:\\Apply\\PS\\Adobe Photoshop 2026\\Presets\\Scripts\\译文 .jsx'
const LABELPLUS = 'D:\\tools\\LabelPlusFX.exe'

function resolve(mode: WorkMode, hasPsd: boolean, config: Partial<CardActionConfig> = {}) {
  return resolveCardAction(mode, hasPsd, { ...EMPTY, ...config })
}

describe('resolveCardAction — entries with a PSD', () => {
  it('opens the PSD for 嵌字 and 监修', () => {
    expect(resolve('typeset', true)).toEqual({ kind: 'open-psd' })
    expect(resolve('supervised', true)).toEqual({ kind: 'open-psd' })
  })

  it('sends 翻译 and 校对 to the translation editor even when a PSD exists', () => {
    expect(resolve('translated', true, { translationToolPath: LABELPLUS })).toEqual({
      kind: 'launch-tool',
      toolPath: LABELPLUS
    })
    expect(resolve('proofread', true, { translationToolPath: LABELPLUS })).toEqual({
      kind: 'launch-tool',
      toolPath: LABELPLUS
    })
  })
})

describe('resolveCardAction — entries without a PSD', () => {
  it('runs the 译文导入 script for 嵌字 when both Photoshop and the script are set', () => {
    expect(resolve('typeset', false, { photoshopPath: PS, importScriptPath: JSX })).toEqual({
      kind: 'run-import-script',
      photoshopPath: PS,
      scriptPath: JSX
    })
  })

  it('asks first for 嵌字 when the import tool is incomplete', () => {
    // Script known but Photoshop unknown is still incomplete.
    expect(resolve('typeset', false, { importScriptPath: JSX })).toEqual({ kind: 'ask-ps-fallback' })
    expect(resolve('typeset', false, { photoshopPath: PS })).toEqual({ kind: 'ask-ps-fallback' })
    expect(resolve('typeset', false)).toEqual({ kind: 'ask-ps-fallback' })
  })

  it('skips the question once 不再提醒 is set, falling back to Photoshop', () => {
    expect(resolve('typeset', false, { photoshopPath: PS, skipPsFallbackPrompt: true })).toEqual({
      kind: 'open-photoshop',
      photoshopPath: PS
    })
  })

  it('blocks 嵌字 when the prompt is suppressed but Photoshop is unknown', () => {
    expect(resolve('typeset', false, { skipPsFallbackPrompt: true })).toEqual({
      kind: 'blocked',
      message: PHOTOSHOP_NOT_CONFIGURED_MESSAGE
    })
  })

  it('only launches Photoshop for 监修 — nothing is loaded', () => {
    expect(resolve('supervised', false, { photoshopPath: PS })).toEqual({
      kind: 'open-photoshop',
      photoshopPath: PS
    })
    expect(resolve('supervised', false, { photoshopPath: PS, importScriptPath: JSX })).toEqual({
      kind: 'open-photoshop',
      photoshopPath: PS
    })
  })

  it('blocks 监修 when Photoshop is unset', () => {
    expect(resolve('supervised', false)).toEqual({
      kind: 'blocked',
      message: PHOTOSHOP_NOT_CONFIGURED_MESSAGE
    })
  })

  it('still routes 翻译 and 校对 to the editor, or blocks with a hint', () => {
    expect(resolve('translated', false, { translationToolPath: LABELPLUS })).toEqual({
      kind: 'launch-tool',
      toolPath: LABELPLUS
    })
    expect(resolve('translated', false)).toEqual({
      kind: 'blocked',
      message: TOOL_NOT_CONFIGURED_MESSAGE
    })
  })
})

describe('derivePhotoshopPath', () => {
  it('derives Photoshop.exe from a Presets\\Scripts script path', () => {
    expect(derivePhotoshopPath(JSX)).toBe(PS)
  })

  it('handles forward slashes and keeps that separator style', () => {
    expect(derivePhotoshopPath('E:/PS/Adobe Photoshop 2026/Presets/Scripts/译文 .jsx')).toBe(
      'E:/PS/Adobe Photoshop 2026/Photoshop.exe'
    )
  })

  it('returns null for paths outside a Presets\\Scripts layout', () => {
    expect(derivePhotoshopPath('D:\\tools\\译文.jsx')).toBeNull()
    expect(derivePhotoshopPath('E:\\PS\\Presets\\Other\\译文.jsx')).toBeNull()
    expect(derivePhotoshopPath('')).toBeNull()
  })

  it('tolerates surrounding whitespace', () => {
    expect(derivePhotoshopPath(`  ${JSX}  `)).toBe(PS)
  })
})
