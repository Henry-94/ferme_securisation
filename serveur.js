const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));

// Clients connectés
let esp32Std = null;
let esp32Cam = null;
const androidClients = new Map();

// Commandes en file pour ESP32-STD (HTTP polling fallback)
const commandsQueue = [];

// --- WebSocket Management ---
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  let clientType = null;

  console.log('🔗 Nouveau client WS en attente d\'identification...');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'register') {
        clientType = data.device;
        if (clientType === 'esp32std') {
          esp32Std = ws;
        } else if (clientType === 'esp32cam') {
          esp32Cam = ws;
        } else if (clientType === 'android') {
          androidClients.set(clientId, ws);
        }
        console.log(`✅ ${clientType} connecté`);
        return;
      }

      // Commande venant d'Android
      if (data.type === 'command' && clientType === 'android') {
        const target = data.target;
        const cmdObj = { type: 'command', command: data.command, ...data.params };

        if (target === 'esp32std' && esp32Std?.readyState === WebSocket.OPEN) {
          esp32Std.send(JSON.stringify(cmdObj));
        } else if (target === 'esp32cam' && esp32Cam?.readyState === WebSocket.OPEN) {
          esp32Cam.send(JSON.stringify(cmdObj));
        } else if (target === 'esp32std') {
          // fallback HTTP
          commandsQueue.push(cmdObj);
        } else {
          ws.send(JSON.stringify({ type: 'error', message: `Target ${target} not connected` }));
        }
      }

      // Alertes ou état venant des ESP32
      if (data.type === 'alert' || data.type === 'state') {
        androidClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }

      // Images binaires venant de l'ESP32-CAM
      if (data.type === 'image' && clientType === 'esp32cam') {
        androidClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }

    } catch (err) {
      console.error('Erreur WS message:', err.message);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });

  ws.on('close', () => {
    if (clientType === 'esp32std') esp32Std = null;
    if (clientType === 'esp32cam') esp32Cam = null;
    if (clientType === 'android') androidClients.delete(clientId);
    console.log(`❌ ${clientType || 'client inconnu'} déconnecté`);
  });
});

// --- HTTP fallback pour ESP32-STD ---
app.get('/device/esp32std/commands', (req, res) => {
  if (commandsQueue.length > 0) {
    const cmd = commandsQueue.shift();
    res.json(cmd);
  } else {
    res.json({});
  }
});

// --- Serveur ---
app.get('/', (_, res) => res.send('✅ Serveur Sécurisation Ferme actif'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur actif sur port ${PORT}`));
