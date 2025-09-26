// ws-proxy.js - tiny WebSocket bridge
// Usage: node ws-proxy.js [PORT]
// Example: node ws-proxy.js 8080

const WebSocket = require('ws');
const http = require('http');

const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ws-proxy: connect via a websocket upgrade (use ?url=...)');
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', function upgrade(request, socket, head) {
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
    const outbound = new WebSocket(target, {
      // You can customize headers or subprotocols here if needed
    });

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
});

server.listen(PORT, () => console.log(`ws-proxy listening on ${PORT}`));
