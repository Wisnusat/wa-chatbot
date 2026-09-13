import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getIO } from '../sockets/io.ts';

export interface AllowlistState {
  enabled: boolean;
  jids: string[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const ALLOWLIST_FILE = path.join(DATA_DIR, 'allowlist.json');

function load(): AllowlistState {
  if (!existsSync(ALLOWLIST_FILE)) {
    return { enabled: false, jids: [] };
  }
  const raw = readFileSync(ALLOWLIST_FILE, 'utf-8');
  return JSON.parse(raw) as AllowlistState;
}

let state: AllowlistState = load();

function persist(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ALLOWLIST_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function getAllowlist(): AllowlistState {
  return { ...state, jids: [...state.jids] };
}

export function setAllowlist(next: AllowlistState): AllowlistState {
  state = { enabled: next.enabled, jids: [...new Set(next.jids)] };
  persist();
  getIO().emit('allowlist:update', getAllowlist());
  return getAllowlist();
}

export function isJidAllowed(jid: string): boolean {
  return !state.enabled || state.jids.includes(jid);
}
