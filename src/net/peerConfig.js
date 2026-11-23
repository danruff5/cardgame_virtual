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
  const params =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const host = params?.get('peerHost') || (typeof localStorage !== 'undefined' ? localStorage.getItem('cbc-peer-host') : null);
  if (!host) {
    return { ...PEER_DEFAULTS };
  }
  const portRaw = params?.get('peerPort') ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('cbc-peer-port') : null);
  const pathRaw = params?.get('peerPath') ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('cbc-peer-path') : null);
  const secureRaw = params?.get('peerSecure') ?? (typeof localStorage !== 'undefined' ? localStorage.getItem('cbc-peer-secure') : null);
  return {
    host,
    port: Number(portRaw || 443),
    path: pathRaw || '/',
    secure: secureRaw !== 'false',
    debug: 1,
  };
}

export const ROOM_QUERY_PARAM = 'room';
