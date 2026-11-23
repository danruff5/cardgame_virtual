import Peer from 'peerjs';
import { makeRoomCode, peerIdForRoom, uid } from '../game/util.js';
import { createEmptyState } from '../game/state.js';
import { applyAction, viewForPlayer } from '../game/authority.js';
import { resolvePeerOptions, ROOM_QUERY_PARAM } from './peerConfig.js';
import { createTelemetryTracker } from '../analytics/telemetry.js';

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
    this.busy = false;
    this.telemetry = null;
    this._unloadHandler = null;
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

  /** Client already has authoritative snapshot from host. */
  _emitClientState(state) {
    this.state = state;
    this.onState?.(state, {
      role: this.role,
      playerId: this.playerId,
      roomCode: this.roomCode,
      isHost: false,
    });
  }

  async host({ name, roomCode } = {}) {
    if (this.busy || this.peer) throw new Error('Already in a room — refresh to start over.');
    this.busy = true;
    this.role = 'dealer';
    this.playerName = name || 'Dealer';
    this.playerId = uid('dealer');
    this.roomCode = (roomCode || makeRoomCode()).toUpperCase();
    const peerId = peerIdForRoom(this.roomCode);

    this._status(`Opening dealer peer ${peerId}…`);
    try {
      this.peer = await openPeer(peerId);
    } catch (err) {
      this.busy = false;
      throw err;
    }
    this.state = createEmptyState(this.roomCode, this.playerId, this.playerName);
    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    this.telemetry = createTelemetryTracker({
      roomCode: this.roomCode,
      source: params?.get('source') || 'ui-playtest',
      batchId: params?.get('batch') || null,
      testerLabel: params?.get('tester') || null,
    });
    this.telemetry.onState(null, this.state, { type: 'host-open' });
    if (typeof window !== 'undefined') {
      this._unloadHandler = () => this.telemetry?.flush();
      window.addEventListener('beforeunload', this._unloadHandler);
    }

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
    if (this.busy || this.state) throw new Error('Already joining/joined — refresh to rejoin.');
    this.busy = true;
    this.role = 'hero';
    this.playerName = name || 'Hero';
    this.playerId = uid('hero');
    this.roomCode = String(roomCode || '').toUpperCase();
    if (!this.roomCode) {
      this.busy = false;
      throw new Error('Room code required');
    }

    const hostPeerId = peerIdForRoom(this.roomCode);
    this._status(`Connecting to ${hostPeerId}…`);

    try {
      this.peer = await openPeer(); // random id for client
    } catch (err) {
      this.busy = false;
      throw err;
    }

    const conn = this.peer.connect(hostPeerId, { reliable: true, serialization: 'json' });
    this.hostConn = conn;

    // Attach data handler BEFORE open completes so welcome/state are never missed.
    const firstState = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Connected but no lobby sync from dealer (try again).')),
        12000,
      );
      conn.on('data', (msg) => {
        this._onClientMessage(msg);
        if (msg?.type === 'state' || (msg?.type === 'welcome' && msg.state)) {
          clearTimeout(timer);
          resolve(msg.state || this.state);
        }
      });
      conn.on('close', () => {
        clearTimeout(timer);
        this._status('Disconnected from dealer.');
      });
      conn.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out joining room (is the dealer online?)')), 15000);
      const onOpen = () => {
        clearTimeout(timer);
        resolve();
      };
      if (conn.open) onOpen();
      else conn.on('open', onOpen);
      this.peer.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    conn.send({
      type: 'hello',
      playerId: this.playerId,
      name: this.playerName,
    });

    this._status(`Joined room ${this.roomCode}. Syncing lobby…`);
    await firstState;
    this._status(`In lobby for room ${this.roomCode}.`);
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
    this.telemetry?.flush();
    if (typeof window !== 'undefined' && this._unloadHandler) {
      window.removeEventListener('beforeunload', this._unloadHandler);
      this._unloadHandler = null;
    }
    this.telemetry = null;
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
    this.peer = null;
    this.hostConn = null;
    this.state = null;
    this.role = null;
    this.playerId = null;
    this.roomCode = null;
    this.busy = false;
  }

  _wireHostConnection(conn) {
    // Register immediately — incoming PeerJS connections may already be open,
    // so waiting only on the 'open' event can drop them from the broadcast map.
    this.connections.set(conn.peer, conn);
    this._status(`Peer connected: ${conn.peer}`);

    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
    });
    conn.on('data', (msg) => this._onHostMessage(conn, msg));
    conn.on('close', () => {
      this.connections.delete(conn.peer);
      const player = this.state?.players?.find((p) => p.peerId === conn.peer);
      if (player) player.connected = false;
      this._status(`Peer left: ${conn.peer}`);
      this._emitState();
    });
  }

  _sendStateTo(conn, playerId) {
    if (!conn || !playerId || !this.state) return;
    try {
      conn.send({ type: 'state', state: viewForPlayer(this.state, playerId) });
    } catch (err) {
      this._error(`Failed to sync state: ${err.message || err}`);
    }
  }

  _onHostMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;

    // Ensure this conn is tracked even if open raced
    this.connections.set(conn.peer, conn);

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

      const view = viewForPlayer(this.state, msg.playerId);
      // Bundle state in welcome so the joiner never depends only on broadcast map timing.
      conn.send({
        type: 'welcome',
        playerId: msg.playerId,
        role: 'hero',
        roomCode: this.roomCode,
        state: view,
      });
      this._sendStateTo(conn, msg.playerId);
      this._broadcastAll();
      this._emitState();
      return;
    }

    if (msg.type === 'action') {
      this._hostApply(msg.action, msg.playerId || this.playerId);
    }

    if (msg.type === 'request-state') {
      const player = this.state.players.find((p) => p.id === msg.playerId) ||
        this.state.players.find((p) => p.peerId === conn.peer);
      if (player) this._sendStateTo(conn, player.id);
    }
  }

  _onClientMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'welcome') {
      this.playerId = msg.playerId || this.playerId;
      this.role = msg.role || 'hero';
      if (msg.roomCode) this.roomCode = msg.roomCode;
      this._status('Welcome received from dealer.');
      if (msg.state) {
        this._emitClientState(msg.state);
      }
    }
    if (msg.type === 'state' && msg.state) {
      this._emitClientState(msg.state);
    }
    if (msg.type === 'error') {
      this._error(msg.error || 'Host rejected action');
    }
  }

  _hostApply(action, actorId) {
    const prevState = this.state;
    const result = applyAction(this.state, action, actorId);
    if (!result.ok) {
      this.telemetry?.onRejected(action, result.error);
      this._error(result.error);
      return;
    }
    this.state = result.state;
    this.telemetry?.onState(prevState, this.state, action);
    this._broadcastAll();
    this._emitState();
  }

  _broadcastAll() {
    for (const conn of this.connections.values()) {
      const player = this.state.players.find((p) => p.peerId === conn.peer);
      if (!player) continue;
      if (conn.open === false) continue;
      this._sendStateTo(conn, player.id);
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
