import koffi from 'koffi'

export interface RegistryFont {
  name: string
  value: string
  scope: 'system' | 'user'
}

const FONT_KEY = 'Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
const HKCU = 0xffffffff80000001n
const HKLM = 0xffffffff80000002n

// Loaded only on Windows and only when font management is used. No child process.
function createApi() {
  const registry = koffi.load('advapi32.dll')
  const gdi = koffi.load('gdi32.dll')
  const user = koffi.load('user32.dll')
  return {
    open: registry.func('int32_t __stdcall RegOpenKeyExW(uintptr_t root, const char16_t *key, uint32_t options, uint32_t access, _Out_ uintptr_t *result)'),
    create: registry.func('int32_t __stdcall RegCreateKeyExW(uintptr_t root, const char16_t *key, uint32_t reserved, void *className, uint32_t options, uint32_t access, void *security, _Out_ uintptr_t *result, void *disposition)'),
    close: registry.func('int32_t __stdcall RegCloseKey(uintptr_t key)'),
    enumerate: registry.func('int32_t __stdcall RegEnumValueW(uintptr_t key, uint32_t index, void *name, _Inout_ uint32_t *nameLength, void *reserved, _Out_ uint32_t *type, void *data, _Inout_ uint32_t *dataLength)'),
    set: registry.func('int32_t __stdcall RegSetValueExW(uintptr_t key, const char16_t *name, uint32_t reserved, uint32_t type, const void *data, uint32_t size)'),
    remove: registry.func('int32_t __stdcall RegDeleteValueW(uintptr_t key, const char16_t *name)'),
    addFont: gdi.func('int __stdcall AddFontResourceExW(const char16_t *path, uint32_t flags, void *reserved)'),
    removeFont: gdi.func('int __stdcall RemoveFontResourceExW(const char16_t *path, uint32_t flags, void *reserved)'),
    broadcast: user.func('intptr_t __stdcall SendMessageTimeoutW(uintptr_t window, uint32_t message, uintptr_t wparam, intptr_t lparam, uint32_t flags, uint32_t timeout, void *result)')
  }
}
let cached: ReturnType<typeof createApi> | undefined
function api() {
  if (process.platform !== 'win32') throw new Error('字体管理仅支持 Windows')
  return (cached ??= createApi())
}
function check(code: number, operation: string) {
  if (code !== 0) throw new Error(`${operation}失败（Windows ${code}）`)
}

export function queryRegistryFonts(): RegistryFont[] {
  const win = api()
  const rows: RegistryFont[] = []
  for (const [root, scope] of [[HKLM, 'system'], [HKCU, 'user']] as const) {
    const handle = [0n]
    const opened = win.open(root, FONT_KEY, 0, 0x20019, handle)
    if (opened === 2) continue // A user may not have installed any fonts yet.
    check(opened, '读取字体注册表')
    try {
      for (let index = 0; ; index++) {
        const name = Buffer.alloc(32768 * 2)
        let data = Buffer.alloc(4096)
        const length = [32768], size = [data.length], type = [0]
        let result = win.enumerate(handle[0], index, name, length, null, type, data, size)
        if (result === 234) {
          data = Buffer.alloc(size[0])
          length[0] = 32768
          result = win.enumerate(handle[0], index, name, length, null, type, data, size)
        }
        if (result === 259) break
        check(result, '枚举字体注册表')
        if (type[0] !== 1 && type[0] !== 2) continue
        const value = data.subarray(0, size[0]).toString('utf16le').replace(/\0+$/, '')
        rows.push({ name: name.subarray(0, length[0] * 2).toString('utf16le'),
          value: value.replace(/%([^%]+)%/g, (match, key: string) => process.env[key] ?? match), scope })
      }
    } finally { win.close(handle[0]) }
  }
  return rows
}

export function setFontRegistration(name: string, filePath: string): void {
  const win = api(), handle = [0n]
  check(win.create(HKCU, FONT_KEY, 0, null, 0, 2, null, handle, null), '打开用户字体注册表')
  try {
    const data = Buffer.from(`${filePath}\0`, 'utf16le')
    check(win.set(handle[0], name, 0, 1, data, data.length), '注册字体')
  } finally { win.close(handle[0]) }
}

export function removeFontRegistration(name: string): void {
  const win = api(), handle = [0n]
  const opened = win.open(HKCU, FONT_KEY, 0, 2, handle)
  if (opened === 2) return
  check(opened, '打开用户字体注册表')
  try {
    const result = win.remove(handle[0], name)
    if (result !== 2) check(result, '移除字体注册')
  } finally { win.close(handle[0]) }
}

export async function changeFontResource(action: 'add' | 'remove', filePath: string): Promise<void> {
  const win = api()
  const result = action === 'add' ? win.addFont(filePath, 0, null) : win.removeFont(filePath, 0, null)
  if (action === 'add' && result === 0) throw new Error('Windows 拒绝加载字体')
  // Broadcast asynchronously: an unresponsive external application must not block Electron's UI.
  await new Promise<void>((resolve, reject) => {
    win.broadcast.async(0xffff, 0x001d, 0, 0, 2, 2000, null, (error: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
