import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LIMIT = 512 * 1024 * 1024;
export const previewCachePath = () => join(app.getPath('userData'), 'cache', 'previews.sqlite');
export interface PreviewEntry {
  payload: Buffer;
  metadata: string;
}
function useCache<T>(write: boolean, action: (db: DatabaseSync) => T): T | null {
  const path = previewCachePath();
  if (!write && !existsSync(path)) return null;
  let db: DatabaseSync | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec(
      'PRAGMA busy_timeout=2000; PRAGMA auto_vacuum=FULL; CREATE TABLE IF NOT EXISTS previews (kind TEXT NOT NULL, path TEXT NOT NULL, revision TEXT NOT NULL, metadata TEXT NOT NULL, payload BLOB NOT NULL, accessed INTEGER NOT NULL, PRIMARY KEY(kind,path,revision)); CREATE INDEX IF NOT EXISTS previews_accessed ON previews(accessed)'
    );
    return action(db);
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
const key = (path: string) => path.replace(/\\/g, '/').toLowerCase();
export function readPreview(kind: string, path: string, revision: string): PreviewEntry | null {
  return useCache(false, (db) => {
    const row = db
      .prepare('SELECT payload,metadata FROM previews WHERE kind=? AND path=? AND revision=?')
      .get(kind, key(path), revision) as { payload: Uint8Array; metadata: string } | undefined;
    if (!row) return null;
    db.prepare('UPDATE previews SET accessed=? WHERE kind=? AND path=? AND revision=?').run(
      Date.now(),
      kind,
      key(path),
      revision
    );
    return { payload: Buffer.from(row.payload), metadata: row.metadata };
  });
}
export function writePreview(
  kind: string,
  path: string,
  revision: string,
  payload: Uint8Array,
  metadata: unknown = {}
): void {
  if (payload.byteLength > 8 * 1024 * 1024) return;
  useCache(true, (db) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM previews WHERE kind=? AND path=?').run(kind, key(path));
      db.prepare('INSERT INTO previews VALUES (?,?,?,?,?,?)').run(
        kind,
        key(path),
        revision,
        JSON.stringify(metadata),
        payload,
        Date.now()
      );
      let size = Number(
        (
          db.prepare('SELECT COALESCE(SUM(length(payload)),0) AS n FROM previews').get() as {
            n: number;
          }
        ).n
      );
      if (size > LIMIT)
        for (const row of db
          .prepare('SELECT rowid,length(payload) AS n FROM previews ORDER BY accessed')
          .all() as { rowid: number; n: number }[]) {
          db.prepare('DELETE FROM previews WHERE rowid=?').run(row.rowid);
          size -= row.n;
          if (size <= LIMIT) break;
        }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
}
export function deletePreview(kind: string, path?: string): void {
  useCache(false, (db) =>
    path
      ? db.prepare('DELETE FROM previews WHERE kind=? AND path=?').run(kind, key(path))
      : db.prepare('DELETE FROM previews WHERE kind=?').run(kind)
  );
}
