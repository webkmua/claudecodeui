import Database from 'better-sqlite3';

import { SqliteSessionSynchronizer } from '../../shared/sessions/sqlite-session-synchronizer.provider.js';
import { getHermesDatabasePath } from './hermes-data-root.js';

type HermesSessionRow = {
  id: string;
  cwd: string | null;
  title: string | null;
  started_at: number | null;
  ended_at: number | null;
  last_activity_at: number | null;
  message_count: number | null;
};

export class HermesSessionSynchronizer extends SqliteSessionSynchronizer<HermesSessionRow> {
  protected readonly fallbackTitle = 'Untitled Hermes Session';
  protected readonly logTag = '[HermesProvider]';
  protected readonly watchedFileBasenames = ['state.db', 'state.db-wal'];

  constructor() {
    super('hermes');
  }

  override async synchronize(_since?: Date): Promise<number> {
    return super.synchronize(undefined);
  }

  protected getDatabasePath(): string {
    return getHermesDatabasePath();
  }

  protected selectSessionRows(
    db: Database.Database,
    sinceMillis: number | null,
    limit: number | null,
  ): HermesSessionRow[] {
    const sinceSeconds = limit !== null && sinceMillis !== null ? Math.floor(sinceMillis / 1000) : null;
    const sql = `
      SELECT id, cwd, title, started_at, ended_at, last_activity_at, message_count
      FROM sessions
      WHERE (parent_session_id IS NULL OR parent_session_id = '')
      ${sinceSeconds !== null ? 'AND COALESCE(last_activity_at, ended_at, started_at) >= ?' : ''}
      ORDER BY COALESCE(last_activity_at, ended_at, started_at) ASC
      ${limit !== null ? `LIMIT ${limit}` : ''}
    `;

    return (sinceSeconds !== null
      ? db.prepare(sql).all(sinceSeconds)
      : db.prepare(sql).all()) as HermesSessionRow[];
  }

  protected getRowTimestampsMs(row: HermesSessionRow): { createdAtMs: number; updatedAtMs: number } {
    const createdAtMs = row.started_at ? Math.floor(row.started_at * 1000) : Date.now();
    const updatedAtMs = row.last_activity_at
      ? Math.floor(row.last_activity_at * 1000)
      : (row.ended_at ? Math.floor(row.ended_at * 1000) : createdAtMs);
    return { createdAtMs, updatedAtMs };
  }

  protected getProjectPath(row: HermesSessionRow): string | null {
    if (row.cwd && row.cwd.trim()) {
      return row.cwd.trim();
    }
    return process.env.HERMES_DEFAULT_CWD || '/home/trueadmin/workspace';
  }

  protected deriveSessionName(_db: Database.Database, row: HermesSessionRow): string | null {
    return row.title ?? null;
  }
}
