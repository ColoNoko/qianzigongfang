// Vitest setup file — runs before every test file.
// Polyfills APIs that jsdom (used by vitest) does not provide out-of-the-box.

class LocalStorageMock implements Storage {
  private store: Record<string, string> = {}

  get length(): number {
    return Object.keys(this.store).length
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store)
    return keys[index] ?? null
  }

  getItem(key: string): string | null {
    return this.store[key] ?? null
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value)
  }

  removeItem(key: string): void {
    delete this.store[key]
  }

  clear(): void {
    this.store = {}
  }
}

// jsdom in vitest does not expose localStorage by default, so we polyfill it
// globally so tests can use it without crashing.
const mockStorage = new LocalStorageMock()
Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
  configurable: true
})
