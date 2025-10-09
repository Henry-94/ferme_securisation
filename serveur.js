const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`📥 HTTP ${req.method} ${req.url} received with body:`, JSON.stringify(req.body));
  next();
});

// Clients connectés
let esp32Std = null;
let esp32Cam = null;
const androidClients = new Map();

// Commandes en file pour ESP32-STD et ESP32-CAM
const commandsQueue = [];

// --- WebSocket Management ---
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  let clientType = null;

  console.log(`🔗 Nouveau client WS en attente d'identification (ID: ${clientId})...`);

  // Ping périodique pour garder la connexion active
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    } else {
      clearInterval(pingInterval);
    }
  }, 30000); // Ping toutes les 30s

  ws.on('message', (message) => {
    try {
      console.log(`📡 WS message received from ${clientType || 'unknown'}:`, message.toString());
      const data = JSON.parse(message);

      if (data.type === 'pong') {
        console.log('Pong reçu de ' + clientType);
        return;
      }

      if (data.type === 'register') {
        clientType = data.device;
        if (clientType === 'esp32std') {
          esp32Std = ws;
          console.log('✅ ESP32-STD connecté');
        } else if (clientType === 'esp32cam') {
          esp32Cam = ws;
          console.log('✅ ESP32-CAM connecté');
        } else if (clientType === 'android') {
          androidClients.set(clientId, ws);
          console.log('✅ Android connecté');
        }
        ws.send(JSON.stringify({ type: 'registered', message: 'Enregistrement réussi' }));
        return;
      }

      // Commande venant d'Android
      if (data.type === 'command' && clientType === 'android') {
        const target = data.target;
        const cmdObj = {
          type: 'command',
          command: data.command.command || data.command,
          ...data.command
        };

        console.log(`📤 Commande reçue pour ${target}:`, JSON.stringify(cmdObj));

        if (target === 'esp32std' && esp32Std?.readyState === WebSocket.OPEN) {
          esp32Std.send(JSON.stringify(cmdObj));
          androidClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'command_response', success: true, message: 'Commande envoyée à ESP32-STD' }));
            }
          });
        } else if (target === 'esp32cam' && esp32Cam?.readyState === WebSocket.OPEN) {
          esp32Cam.send(JSON.stringify(cmdObj));
          androidClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'command_response', success: true, message: 'Commande envoyée à ESP32-CAM' }));
            }
          });
        } else if (target === 'esp32std' || target === 'esp32cam') {
          commandsQueue.push(cmdObj);
          androidClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'command_response', success: false, message: `${target} non connecté, commande mise en file d'attente` }));
            }
          });
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
    clearInterval(pingInterval);
    if (clientType === 'esp32std') esp32Std = null;
    if (clientType === 'esp32cam') esp32Cam = null;
    if (clientType === 'android') androidClients.delete(clientId);
    console.log(`❌ ${clientType || 'client inconnu'} déconnecté (ID: ${clientId})`);
  });
});

// --- HTTP endpoint pour recevoir les commandes ---
app.post('/command', (req, res) => {
  try {
    const data = req.body;
    console.log('📥 /command endpoint called with:', JSON.stringify(data));
    if (!data.type || !data.target || !data.command) {
      console.log('❌ Invalid command format');
      return res.status(400).json({ type: 'error', message: 'Format de commande invalide' });
    }

    const cmdObj = {
      type: 'command',
      command: data.command.command || data.command,
      ...data.command
    };

    if (data.target === 'esp32std' && esp32Std?.readyState === WebSocket.OPEN) {
      esp32Std.send(JSON.stringify(cmdObj));
      androidClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'command_response', success: true, message: 'Commande envoyée à ESP32-STD' }));
        }
      });
      res.json({ type: 'command_response', success: true, message: 'Commande envoyée à ESP32-STD' });
    } else if (data.target === 'esp32cam' && esp32Cam?.readyState === WebSocket.OPEN) {
      esp32Cam.send(JSON.stringify(cmdObj));
      androidClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'command_response', success: true, message: 'Commande envoyée à ESP32-CAM' }));
        }
      });
      res.json({ type: 'command_response', success: true, message: 'Commande envoyée à ESP32-CAM' });
    } else if (data.target === 'esp32std' || data.target === 'esp32cam') {
      commandsQueue.push(cmdObj);
      androidClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'command_response', success: false, message: `${data.target} non connecté, commande mise en file d'attente` }));
        }
      });
      res.json({ type: 'command_response', success: false, message: `${data.target} non connecté, commande mise en file d'attente` });
    } else {
      console.log(`❌ Target ${data.target} non supporté`);
      res.status(400).json({ type: 'error', message: `Target ${data.target} non supporté` });
    }
  } catch (err) {
    console.error('Erreur HTTP /command:', err.message);
    res.status(500).json({ type: 'error', message: err.message });
  }
});

// --- HTTP fallback pour ESP32-STD et ESP32-CAM ---
app.get('/device/esp32std/commands', (req, res) => {
  if (commandsQueue.length > 0) {
    const cmd = commandsQueue.shift();
    res.json(cmd);
  } else {
    res.json({});
  }
});

app.get('/device/esp32cam/commands', (req, res) => {
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
