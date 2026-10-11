import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getHermesHome(): string {
  if (process.env.HERMES_HOME?.trim()) {
    return process.env.HERMES_HOME.trim();
  }

  const primary = path.join(os.homedir(), '.hermes');
  if (fsSync.existsSync(path.join(primary, 'config.yaml')) || fsSync.existsSync(path.join(primary, 'state.db'))) {
    return primary;
  }

  // Fallback for sandboxed user home (e.g. /home/trueadmin/cloudcli-antigravity/home)
  const userHome = '/home/trueadmin/.hermes';
  if (fsSync.existsSync(path.join(userHome, 'config.yaml')) || fsSync.existsSync(path.join(userHome, 'state.db'))) {
    return userHome;
  }

  return primary;
}

export function getHermesDatabasePath(): string {
  return path.join(getHermesHome(), 'state.db');
}

export function getHermesConfigPath(): string {
  return path.join(getHermesHome(), 'config.yaml');
}
