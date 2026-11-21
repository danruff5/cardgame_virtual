import Peer from 'peerjs';
import { makeRoomCode, peerIdForRoom, uid } from '../game/util.js';
import { createEmptyState } from '../game/state.js';
import { applyAction, viewForPlayer } from '../game/authority.js';
import { resolvePeerOptions, ROOM_QUERY_PARAM } from './peerConfig.js';

/**
 * Dealer-host PeerJS room.
 * - Host peer id = cbc-{ROOMCODE}
 * - Clients open a DataConnection to the host
 * - Host applies actions and broadcasts public state views
 */
export class PeerRoom {
  constructor({ onState, onStatus, onError }) {
    this.onState = onState;
    this.onStatus = onStatus;
    this.onError = onError;
    this.peer = null;
    this.role = null; // 'dealer' | 'hero'
    this.playerId = null;
    this.playerName = null;
    this.roomCode = null;
    this.state = null;
    this.connections = new Map(); // peerId -> DataConnection (host only)
    this.hostConn = null; // client → host
  }

  _status(msg) {
    this.onStatus?.(msg);
  }

  _error(msg) {
    this.onError?.(msg);
    this._status(msg);
  }

  _emitState() {
    if (!this.state || !this.playerId) return;
    this.onState?.(viewForPlayer(this.state, this.playerId), {
      role: this.role,
      playerId: this.playerId,
      roomCode: this.roomCode,
      isHost: this.role === 'dealer',
    });
  }

  async host({ name, roomCode } = {}) {
    this.role = 'dealer';
    this.playerName = name || 'Dealer';
    this.playerId = uid('dealer');
    this.roomCode = (roomCode || makeRoomCode()).toUpperCase();
    const peerId = peerIdForRoom(this.roomCode);

    this._status(`Opening dealer peer ${peerId}…`);
    this.peer = await openPeer(peerId);
    this.state = createEmptyState(this.roomCode, this.playerId, this.playerName);

    this.peer.on('connection', (conn) => {
      this._wireHostConnection(conn);
    });

    this.peer.on('error', (err) => {
      this._error(`Peer error: ${err.type || err.message || err}`);
    });

    this._status(`Room ${this.roomCode} live. Share code or link.`);
    this._emitState();
    return { roomCode: this.roomCode, peerId, joinUrl: buildJoinUrl(this.roomCode) };
  }

  async join({ roomCode, name } = {}) {
    this.role = 'hero';
    this.playerName = name || 'Hero';
    this.playerId = uid('hero');
    this.roomCode = String(roomCode || '').toUpperCase();
    if (!this.roomCode) throw new Error('Room code required');

    const hostPeerId = peerIdForRoom(this.roomCode);
    this._status(`Connecting to ${hostPeerId}…`);
    this.peer = await openPeer(); // random id for client

    const conn = this.peer.connect(hostPeerId, { reliable: true });
    this.hostConn = conn;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out joining room (is the dealer online?)')), 15000);
      conn.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      conn.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      this.peer.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    conn.on('data', (msg) => this._onClientMessage(msg));
    conn.on('close', () => this._status('Disconnected from dealer.'));

    conn.send({
      type: 'hello',
      playerId: this.playerId,
      name: this.playerName,
    });

    this._status(`Joined room ${this.roomCode}. Waiting for sync…`);
  }

  /** Host or client sends a game action. */
  dispatch(action) {
    if (this.role === 'dealer') {
      this._hostApply(action, this.playerId);
    } else if (this.hostConn?.open) {
      this.hostConn.send({ type: 'action', playerId: this.playerId, action });
    } else {
      this._error('Not connected to dealer.');
    }
  }

  /** Solo / same-machine: apply as a specific player id (local stub). */
  dispatchAs(playerId, action) {
    if (this.role !== 'dealer') {
      this._error('Only dealer can puppet local seats.');
      return;
    }
    this._hostApply(action, playerId);
  }

  destroy() {
    for (const conn of this.connections.values()) {
      try {
        conn.close();
      } catch {
        /* ignore */
      }
    }
    this.connections.clear();
    try {
      this.hostConn?.close();
    } catch {
      /* ignore */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
  }

  _wireHostConnection(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this._status(`Peer connected: ${conn.peer}`);
    });
    conn.on('data', (msg) => this._onHostMessage(conn, msg));
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      // mark player disconnected if we tracked peer→player
      this._status(`Peer left: ${conn.peer}`);
    });
  }

  _onHostMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'hello') {
      const existing = this.state.players.find((p) => p.id === msg.playerId);
      if (!existing) {
        this.state.players.push({
          id: msg.playerId,
          name: String(msg.name || 'Hero').slice(0, 24),
          role: 'hero',
          heroId: null,
          connected: true,
          isLocalStub: false,
          peerId: conn.peer,
        });
        this.state.log = [`${msg.name || 'Hero'} joined the lobby.`, ...this.state.log].slice(0, 40);
        this.state.version = (this.state.version || 0) + 1;
      } else {
        existing.connected = true;
        existing.peerId = conn.peer;
        if (msg.name) existing.name = String(msg.name).slice(0, 24);
      }
      conn.send({ type: 'welcome', playerId: msg.playerId, role: 'hero' });
      this._broadcastAll();
      this._emitState();
      return;
    }

    if (msg.type === 'action') {
      this._hostApply(msg.action, msg.playerId || this.playerId);
    }
  }

  _onClientMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'welcome') {
      this.playerId = msg.playerId || this.playerId;
      this.role = msg.role || 'hero';
      this._status('Welcome received from dealer.');
    }
    if (msg.type === 'state') {
      this.state = msg.state;
      this._emitState();
    }
    if (msg.type === 'error') {
      this._error(msg.error || 'Host rejected action');
    }
  }

  _hostApply(action, actorId) {
    const result = applyAction(this.state, action, actorId);
    if (!result.ok) {
      this._error(result.error);
      // Still notify actor if remote
      for (const conn of this.connections.values()) {
        // optional: targeted errors skipped for MVP
      }
      return;
    }
    this.state = result.state;
    this._broadcastAll();
    this._emitState();
  }

  _broadcastAll() {
    for (const conn of this.connections.values()) {
      // Find player for this peer
      const player = this.state.players.find((p) => p.peerId === conn.peer);
      const viewerId = player?.id;
      if (!viewerId || !conn.open) continue;
      conn.send({ type: 'state', state: viewForPlayer(this.state, viewerId) });
    }
  }
}

function openPeer(id) {
  const options = resolvePeerOptions();
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, options) : new Peer(options);
    const timer = setTimeout(() => reject(new Error('PeerJS broker timeout')), 12000);
    peer.on('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function buildJoinUrl(roomCode) {
  const url = new URL(window.location.href);
  url.searchParams.set(ROOM_QUERY_PARAM, roomCode);
  return url.toString();
}

export function readRoomFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get(ROOM_QUERY_PARAM);
}
