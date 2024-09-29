import { createServer, connect } from "net";

const SOCKS_VERSION = 5;
const AUTH_METHOD_NO_AUTH = 0;
const CMD_CONNECT = 1;
const ATYP_IPV4 = 1;
const ATYP_DOMAIN = 3;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function handleClient(client) {
  try {
    // Handle initial greeting
    const greeting = await readData(client);

    if (greeting[0] !== SOCKS_VERSION) {
      throw new Error("Unsupported SOCKS version");
    }

    // Send auth method choice
    await writeData(client, Buffer.from([SOCKS_VERSION, AUTH_METHOD_NO_AUTH]));

    // Handle connection request
    const request = await readData(client);

    if (request[0] !== SOCKS_VERSION || request[1] !== CMD_CONNECT) {
      throw new Error("Unsupported command");
    }

    let host, port;
    const atyp = request[3];

    if (atyp === ATYP_IPV4) {
      host = request.slice(4, 8).join('.');
      port = (request[8] << 8) | request[9];
    } else if (atyp === ATYP_DOMAIN) {
      const domainLength = request[4];
      host = request.slice(5, 5 + domainLength).toString();
      port = (request[5 + domainLength] << 8) | request[6 + domainLength];
    } else {
      throw new Error("Unsupported address type");
    }

    log(`Connecting to ${host}:${port}`);

    const target = connect(port, host);
    await new Promise((resolve, reject) => {
      target.once('connect', resolve);
      target.once('error', reject);
    });

    log(`Connected to ${host}:${port}!`);

    // Send success response
    await writeData(client, Buffer.from([SOCKS_VERSION, 0, 0, 1, 0, 0, 0, 0, 0, 0]));

    // Start proxying data
    client.pipe(target).pipe(client);

    client.on('error', (err) => {
      log("Client error:", err.message);
      target.destroy();
    });

    target.on('error', (err) => {
      log("Target error:", err.message);
      client.destroy();
    });

    client.on('close', () => {
      target.destroy();
    });

    target.on('close', () => {
      client.destroy();
    });

  } catch (error) {
    log("Error:", error.message);
    client.destroy();
  }
}

function readData(socket) {
  return new Promise((resolve, reject) => {
    socket.once('data', resolve);
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('Connection closed')));
  });
}

function writeData(socket, data) {
  return new Promise((resolve, reject) => {
    socket.write(data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

const server = createServer((socket) => {
  handleClient(socket);
}).listen(2080, () => {
  log(`SOCKS5 proxy server running on localhost:2080`);
});

// Optimize for high concurrency
server.maxConnections = 1000000;
process.setMaxListeners(0);
