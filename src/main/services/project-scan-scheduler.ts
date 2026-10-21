import { resolve } from 'node:path'
import type { ChildProjectScan } from '@shared/types'

/**
 * 每目录**唯一权威扫描**（2026-10-05 从 0.4.0 干净分享包移植，适配本项目）。
 *
 * 为什么值得从 0.4.0 搬过来：本项目的扫描是"谁要谁扫"——窗口每次聚焦都重新扫一遍，
 * 而且**没有"等文件写完再采信"的机制**。Photoshop 正在写 PSD 时切回来，
 * 界面会扫到半截状态；多窗口并发还会重复扫同一目录。
 *
 * 这里的四条语义（与 0.4.0 逐条对齐）：
 *   ① 同一目录并发请求只飞一次（去重，`flight`）；
 *   ② 2 秒内的旧结果可当缓存（`cached` 参数）；
 *   ③ **双次校验**：读全之后等 `settle` 再扫一遍，两次一致才交给 `commit`，
 *      不一致就重试，最多 4 次，还不行给 `status='unstable'`；
 *   ④ `invalidate` 让进行中的请求作废（generation 守卫）—— 脏结果永远到不了 `commit`。
 *
 * ⚠️ 适配边界（与原版不同，写清楚）：0.4.0 的 `commit` 直接写库
 * （`recordScannedProject`）；本项目的扫描结果由**渲染层**决定怎么用，所以 `commit`
 * 是注入的回调（接线时给 no-op / 日志）。双次校验、缓存、状态语义都不变。
 */
type State = {
  generation: number
  revision: number
  flight?: Promise<ChildProjectScan>
  result?: ChildProjectScan
  at: number
}

export class ProjectScanScheduler {
  private states = new Map<string, State>()

  constructor(
    private scan: (path: string) => Promise<ChildProjectScan>,
    private commit: (
      path: string,
      result: ChildProjectScan,
      current: () => boolean
    ) => Promise<void>,
    private settle = 500
  ) {}

  /** 目录键：与全站查找键同口径（解析 + 小写），同一目录只留一份状态。 */
  key(path: string): string {
    return resolve(path).toLowerCase()
  }

  private state(path: string): State {
    const key = this.key(path)
    let state = this.states.get(key)
    if (!state) {
      state = { generation: 0, revision: 0, at: 0 }
      this.states.set(key, state)
    }
    // 有界：只清掉"闲着的"旧目录状态，永不逐出进行中的飞行请求。
    if (this.states.size > 256) {
      for (const [id, value] of this.states) {
        if (id !== key && !value.flight) {
          this.states.delete(id)
          break
        }
      }
    }
    return state
  }

  /** 作废进行中的请求（外部知道目录变了时调用，比如目录监听器）。 */
  invalidate(path: string): void {
    const state = this.state(path)
    state.generation++
    state.at = 0
  }

  request(path: string, cached = false): Promise<ChildProjectScan> {
    const state = this.state(path)
    if (state.flight) return state.flight
    if (cached && state.result && Date.now() - state.at < 2000) {
      return Promise.resolve(state.result)
    }
    state.flight = this.run(path, state).finally(() => {
      state.flight = undefined
    })
    return state.flight
  }

  private async run(path: string, state: State): Promise<ChildProjectScan> {
    let result!: ChildProjectScan
    for (let attempt = 0; attempt < 4; attempt++) {
      const generation = state.generation
      result = await this.scan(path)
      if (!result.errors.length) {
        // 读全之后等一拍再复扫：PS 正在写盘时，两次结果必然不同。
        await new Promise((resolve) => setTimeout(resolve, this.settle))
        const verified = await this.scan(path)
        if (
          generation !== state.generation ||
          JSON.stringify(result) !== JSON.stringify(verified)
        ) {
          continue
        }
        result = verified
        result.status = 'complete'
        const current = () => state.generation === generation
        await this.commit(path, result, current)
        if (!current()) continue
      } else {
        if (generation !== state.generation) continue
        result.status ??= 'partial'
      }
      result.revision = ++state.revision
      state.result = result
      state.at = Date.now()
      return result
    }
    state.result = { ...result, status: 'unstable', revision: ++state.revision }
    state.at = Date.now()
    return state.result
  }
}
