import { DatabaseSync } from 'node:sqlite'

export function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS key_value_store (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS statistics_time_rules (
      scope_id TEXT NOT NULL, mode TEXT NOT NULL, source TEXT NOT NULL,
      PRIMARY KEY(scope_id, mode)
    );
    CREATE TABLE IF NOT EXISTS statistics_time_pages (
      child_id TEXT NOT NULL, path_key TEXT NOT NULL, mode TEXT NOT NULL,
      source TEXT NOT NULL, at REAL NOT NULL, mark_at REAL NOT NULL,
      PRIMARY KEY(child_id, path_key, mode)
    );
    CREATE TABLE IF NOT EXISTS statistics_time_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_memory (
      child_id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    /*
     * 标记台账（第十四轮）：每次标记写入都在**同一个事务**里留一条流水。
     *
     * 一行 = "一次操作碰到的某一话"；op_id 把同一次用户操作的所有行串起来
     * （侧栏批量标记会逐话写库，没有它，一次点击在台账里会变成十几条散记录）。
     * entries_json 存逐文件的"改之前 / 改之后"（模式 + 时间戳），撤销就是把它读回来写。
     * ⚠️ 这段注释在 JS 模板字符串里，**不能出现反引号**（会提前把字符串截断）。
     */
    CREATE TABLE IF NOT EXISTS mark_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('mark', 'migrate', 'undo', 'restore')),
      source TEXT NOT NULL,
      mode TEXT,
      target_status TEXT,
      ref_op_id TEXT,
      note TEXT,
      child_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      entries_json TEXT NOT NULL,
      skipped INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_mark_audit_op ON mark_audit (op_id);
    CREATE INDEX IF NOT EXISTS idx_mark_audit_at ON mark_audit (at DESC);

    CREATE TABLE IF NOT EXISTS translation_review (
      folder_path TEXT NOT NULL,
      image_key TEXT NOT NULL,
      label_index INTEGER NOT NULL,
      image_name TEXT NOT NULL,
      page INTEGER NOT NULL DEFAULT 0,
      original_text TEXT NOT NULL DEFAULT '',
      reviewed_text TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL,
      PRIMARY KEY (folder_path, image_key, label_index)
    );

    CREATE INDEX IF NOT EXISTS idx_translation_review_folder
      ON translation_review (folder_path);

    CREATE TABLE IF NOT EXISTS project_memory_files (
      child_id TEXT NOT NULL,
      path_key TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('done', 'pending')),
      mtime_ms REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      mode_statuses_json TEXT NOT NULL DEFAULT '{}',
      mode_timestamps_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (child_id, path_key),
      FOREIGN KEY (child_id) REFERENCES project_memory(child_id) ON DELETE CASCADE
    );
  `)

  // 兼容旧数据库：旧表没有 mode_statuses_json 时补列。
  const fileColumns = database.prepare(`PRAGMA table_info(project_memory_files)`).all() as Array<{
    name: string
  }>
  if (!fileColumns.some((column) => column.name === 'mode_statuses_json')) {
    database.exec(`
      ALTER TABLE project_memory_files
      ADD COLUMN mode_statuses_json TEXT NOT NULL DEFAULT '{}'
    `)
  }
  if (!fileColumns.some((column) => column.name === 'mode_timestamps_json')) {
    database.exec(`
      ALTER TABLE project_memory_files
      ADD COLUMN mode_timestamps_json TEXT NOT NULL DEFAULT '{}'
    `)
  }
}
