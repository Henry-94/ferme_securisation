const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = {
  esp32std: null,
  esp32cam: null,
  android: []
};

const commands = {
  esp32std: [],
};

app.use(express.json());

app.get('/device/esp32std/commands', (req, res) => {
  if (commands.esp32std.length > 0) {
    const command = commands.esp32std.shift();
    res.json(command);
  } else {
    res.json({});
  }
});

wss.on('connection', (ws) => {
  let clientId = uuidv4();
  let clientType = null;
  ws.isAlive = true;

  console.log('🔗 Nouvelle connexion WebSocket...');

  ws.on('message', (message) => {
    try {
      if (Buffer.isBuffer(message)) {
        if (clientType === 'esp32cam' && clients.android.length > 0) {
          const base64Image = message.toString('base64');
          const imageMessage = { type: 'image', data: base64Image };
          clients.android.forEach(a => {
            if (a.isAlive) a.send(JSON.stringify(imageMessage));
          });
        }
        return;
      }

      const data = JSON.parse(message);
      // ✅ Correction identification Android
      if (data.type === 'register' && data.device) {
        clientType = data.device;
        ws.clientId = clientId;
        ws.isAlive = true;

        if (clientType === 'esp32std') {
          clients.esp32std = ws;
          console.log('✅ ESP32-Standard enregistré');
        } else if (clientType === 'esp32cam') {
          clients.esp32cam = ws;
          console.log('✅ ESP32-CAM enregistré');
        } else if (clientType === 'android') {
          clients.android.push(ws);
          console.log(`📱 Android connecté (${clients.android.length} total)`);
        }
        return;
      }

      if (data.type === 'alert' || data.type === 'state') {
        clients.android.forEach(a => {
          if (a.isAlive)
            a.send(JSON.stringify({ type: 'alert', message: JSON.stringify(data) }));
        });
      }

      if (data.type === 'command' && clientType === 'android') {
        const target = data.target;
        const command = { type: 'command', command: data.command, ...data.params };

        if (target === 'esp32std' && clients.esp32std) {
          clients.esp32std.send(JSON.stringify(command));
        } else if (target === 'esp32cam' && clients.esp32cam) {
          clients.esp32cam.send(JSON.stringify(command));
        } else {
          if (target === 'esp32std') commands.esp32std.push(command);
          ws.send(JSON.stringify({ type: 'error', message: `Target ${target} not connected` }));
        }
      }
    } catch (e) {
      console.error('Erreur message:', e);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('pong', () => (ws.isAlive = true));

  ws.on('close', () => {
    if (clientType === 'esp32std') clients.esp32std = null;
    else if (clientType === 'esp32cam') clients.esp32cam = null;
    else if (clientType === 'android')
      clients.android = clients.android.filter(c => c.clientId !== clientId);
    console.log(`❌ ${clientType || 'client inconnu'} déconnecté`);
  });
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

app.get('/', (_, res) => res.send('✅ Serveur FARM Intelligent en ligne'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur actif sur port ${PORT}`));
