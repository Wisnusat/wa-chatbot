import { getIO } from '../sockets/io.ts';

export interface KnownChat {
  jid: string;
  name: string;
  isGroup: boolean;
  lastMessageAt: string;
}

const chats = new Map<string, KnownChat>();

export function upsertKnownChat(jid: string, name: string, isGroup: boolean): void {
  const isNew = !chats.has(jid);
  const entry: KnownChat = { jid, name, isGroup, lastMessageAt: new Date().toISOString() };
  chats.set(jid, entry);

  if (isNew) {
    getIO().emit('chat:known', entry);
  }
}

export function touchKnownChat(jid: string): void {
  const entry = chats.get(jid);
  if (entry) {
    entry.lastMessageAt = new Date().toISOString();
  }
}

export function hasKnownChat(jid: string): boolean {
  return chats.has(jid);
}

export function getKnownChats(): KnownChat[] {
  return [...chats.values()].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}
