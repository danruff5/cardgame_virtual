import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT || 9000);
const path = process.env.PEER_PATH || '/peerjs';

const server = PeerServer({
  port,
  path,
  allow_discovery: true,
});

server.on('connection', (client) => {
  console.log(`[peer-server] connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  console.log(`[peer-server] disconnected: ${client.getId()}`);
});

console.log(`PEER_SERVER_READY port=${port} path=${path}`);
