/** Fisher–Yates shuffle (mutates + returns array). */
export function shuffle(arr, rng = Math.random) {
  const a = arr;
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function uid(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Short room code for PeerJS peer id suffix. */
export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function peerIdForRoom(code) {
  return `cbc-${String(code).toUpperCase()}`;
}

export function deepClone(obj) {
  return structuredClone(obj);
}
