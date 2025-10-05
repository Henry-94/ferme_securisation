const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = {
  esp32std: null,
  esp32cam: null,
  android: []
};

// Store pending commands for HTTP fallback
const commands = {
  esp32std: [],
};

// Middleware for JSON parsing
app.use(express.json());

// HTTP endpoint for ESP32-Standard command polling
app.get('/device/esp32std/commands', (req, res) => {
  if (commands.esp32std.length > 0) {
    const command = commands.esp32std.shift();
    res.json(command);
  } else {
    res.json({});
  }
});

// WebSocket connection handling
wss.on('connection', (ws) => {
  let clientId = null;
  let clientType = null;

  ws.on('message', (message) => {
    try {
      // Handle binary messages (from ESP32-CAM)
      if (Buffer.isBuffer(message)) {
        if (clientType === 'esp32cam' && clients.android.length > 0) {
          // Convert binary to base64 and forward to Android clients
          const base64Image = message.toString('base64');
          const imageMessage = {
            type: 'image',
            data: base64Image
          };
          clients.android.forEach(androidWs => {
            if (androidWs.isAlive) {
              androidWs.send(JSON.stringify(imageMessage));
            }
          });
        }
        return;
      }

      // Parse JSON message
      const data = JSON.parse(message);

      // Handle registration
      if (data.type === 'register' && data.device) {
        clientId = uuidv4();
        clientType = data.device;
        ws.clientId = clientId;
        ws.isAlive = true;

        if (clientType === 'esp32std') {
          clients.esp32std = ws;
          console.log('ESP32-Standard registered');
        } else if (clientType === 'esp32cam') {
          clients.esp32cam = ws;
          console.log('ESP32-CAM registered');
        } else if (clientType === 'android') {
          clients.android.push(ws);
          console.log(`Android client registered (${clients.android.length} total)`);
        }
      }

      // Handle alerts and state messages
      if (data.type === 'alert' || data.type === 'state') {
        // Forward to all Android clients
        clients.android.forEach(androidWs => {
          if (androidWs.isAlive) {
            androidWs.send(JSON.stringify({
              type: 'alert',
              message: JSON.stringify(data)
            }));
          }
        });
      }

      // Handle binary_start (image header from ESP32-CAM)
      if (data.type === 'binary_start' && clientType === 'esp32cam') {
        console.log(`Image header received: ${data.filename}`);
      }

      // Handle commands from Android
      if (data.type === 'command' && clientType === 'android') {
        const target = data.target; // 'esp32std' or 'esp32cam'
        const command = {
          type: 'command',
          command: data.command,
          ...data.params // e.g., { ssid, pass, mode, time, rfid_list }
        };

        if (target === 'esp32std' && clients.esp32std && clients.esp32std.isAlive) {
          clients.esp32std.send(JSON.stringify(command));
        } else if (target === 'esp32cam' && clients.esp32cam && clients.esp32cam.isAlive) {
          clients.esp32cam.send(JSON.stringify(command));
        } else {
          // Store for HTTP fallback (ESP32-Standard only)
          if (target === 'esp32std') {
            commands.esp32std.push(command);
          }
          ws.send(JSON.stringify({ type: 'error', message: `Target ${target} not connected` }));
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    if (clientType === 'esp32std') {
      clients.esp32std = null;
      console.log('ESP32-Standard disconnected');
    } else if (clientType === 'esp32cam') {
      clients.esp32cam = null;
      console.log('ESP32-CAM disconnected');
    } else if (clientType === 'android') {
      clients.android = clients.android.filter(c => c.clientId !== clientId);
      console.log(`Android client disconnected (${clients.android.length} total)`);
    }
  });
});

// Ping clients to check if they are alive
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Basic HTTP route
app.get('/', (req, res) => {
  res.send('Farm Security Node.js Server');
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
