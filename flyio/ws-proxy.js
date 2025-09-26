// ws-proxy.js - tiny WebSocket bridge
// Usage: node ws-proxy.js [PORT]
// The script prefers process.env.PORT (set by Fly); fallback to argv or 8080.

const http = require('http');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || process.argv[2] || 8080);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ws-proxy: connect via websocket upgrade (use ?url=...)');
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', function upgrade(request, socket, head) {
  try {
    // parse url param ?url=...
    const u = new URL(request.url, `http://${request.headers.host}`);
    const target = u.searchParams.get('url');
    if (!target) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\nMissing ?url=');
      socket.destroy();
      return;
    }

    // accept incoming client
    wss.handleUpgrade(request, socket, head, function done(clientWs) {
      // open outgoing connection to target
      const outbound = new WebSocket(target);

      outbound.on('open', () => {
        // pipe messages both ways
        clientWs.on('message', (msg) => {
          if (outbound.readyState === outbound.OPEN) outbound.send(msg);
        });
        outbound.on('message', (msg) => {
          if (clientWs.readyState === clientWs.OPEN) clientWs.send(msg);
        });
      });

      function maybeClose() {
        try { if (clientWs && clientWs.readyState === clientWs.OPEN) clientWs.close(); } catch(e){}
        try { if (outbound && outbound.readyState === outbound.OPEN) outbound.close(); } catch(e){}
      }

      clientWs.on('close', maybeClose);
      outbound.on('close', maybeClose);
      clientWs.on('error', maybeClose);
      outbound.on('error', maybeClose);
    });
  } catch (err) {
    try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n'); } catch(e){}
    socket.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ws-proxy listening on port ${PORT}`);
});
