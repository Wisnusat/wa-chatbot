export type ConnectionStatus = 'connecting' | 'open' | 'close' | 'qr';

export interface SessionState {
  status: ConnectionStatus;
  qr: string | null;
  lastConnectedAt: string | null;
  lastMessageAt: string | null;
  reconnectCount: number;
}

const state: SessionState = {
  status: 'connecting',
  qr: null,
  lastConnectedAt: null,
  lastMessageAt: null,
  reconnectCount: 0,
};

export function getStatus(): SessionState {
  return { ...state };
}

export function updateStatus(partial: Partial<SessionState>): SessionState {
  Object.assign(state, partial);
  return getStatus();
}
