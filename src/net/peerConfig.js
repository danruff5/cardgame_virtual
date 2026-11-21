/**
 * PeerJS broker configuration.
 *
 * Default: free public PeerJS cloud (0.peerjs.com).
 * Fine for local playtests; rate limits / uptime are not guaranteed.
 *
 * To self-host later:
 *   1. Run a PeerServer (e.g. `npx peerjs --port 9000 --path /myapp`)
 *      or deploy https://github.com/peers/peerjs-server behind HTTPS.
 *   2. Override via localStorage:
 *        localStorage.setItem('cbc-peer-host', 'your.peerhost.example')
 *        localStorage.setItem('cbc-peer-port', '443')
 *        localStorage.setItem('cbc-peer-path', '/myapp')
 *        localStorage.setItem('cbc-peer-secure', 'true')
 *   3. Or edit PEER_DEFAULTS below and rebuild.
 */
export const PEER_DEFAULTS = {
  // Omit host to use PeerJS cloud defaults (0.peerjs.com).
  debug: 1,
};

export function resolvePeerOptions() {
  const host = localStorage.getItem('cbc-peer-host');
  if (!host) {
    return { ...PEER_DEFAULTS };
  }
  return {
    host,
    port: Number(localStorage.getItem('cbc-peer-port') || 443),
    path: localStorage.getItem('cbc-peer-path') || '/',
    secure: localStorage.getItem('cbc-peer-secure') !== 'false',
    debug: 1,
  };
}

export const ROOM_QUERY_PARAM = 'room';
