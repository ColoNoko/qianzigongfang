/**
 * `services/database.ts` —— **兼容门面**（2026-10-02 P4 收官）。
 *
 * 这个文件曾经是 1318 行的"什么都管"的库模块。P4 把它按**一类事一个文件**切成六块，
 * 全部落在同目录的 `db/` 下：
 *
 * ```text
 * db/connection.ts            库怎么打开：路径 / 建表 / 旧数据导入与迁移 / 拿连接 / 关闭
 * db/key-value.ts             通用键值设置（一个 key → 一段 JSON；含退出期那条同步写）
 * db/project-memory-store.ts  单话标记（project_memory / project_memory_files；modes 是补丁）
 * db/mark-stats-store.ts      按话汇总标记记录（成就 / 首页的数据源）
 * db/mark-audit-store.ts      台账 / 撤销 / 还原（每一笔写入留痕、按台账精确写回）
 * db/mark-snapshot-store.ts   标记快照（还原预览的两侧 + VACUUM INTO 备份）
 * ```
 *
 * 这里**只做 re-export**，一行逻辑都没有 —— 这是**兼容垫片**：handlers / font-manager /
 * diagnostics / project-repository / db-backup / index 一直是从 `./database` 引这些名字的，
 * 切分的每一步都靠它保证调用方一个字都不用改。
 *
 * ⚠️ **新代码请直接从 `./db/<那一块>` 引**；往这个文件里加新逻辑就等于把刚拆掉的东西
 * 又堆回来（要加新的一块，就在 `db/` 下开一个文件，再在这里补一句 re-export）。
 */
export { closeDatabase, databasePath, getDatabase, importLegacyJsonFiles } from './db/connection'
export { getStoredValue, setStoredValue, setStoredValueSync } from './db/key-value'
export {
  getStoredProjectMemory,
  removeStoredProjectMemory,
  setStoredProjectMemoryStatuses
} from './db/project-memory-store'
export { collectChildMarkStatistics } from './db/mark-stats-store'
export {
  applyMarkRestore,
  findUndoableMarkOperation,
  getMarkAuditOperation,
  listMarkAuditOperations,
  undoMarkOperation
} from './db/mark-audit-store'
export {
  currentMarkSnapshot,
  readMarkSnapshotFromFile,
  writeDatabaseSnapshotTo
} from './db/mark-snapshot-store'
