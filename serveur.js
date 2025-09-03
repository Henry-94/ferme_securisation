const express = require('express');
const http = require('http');
const WebSocket = require('ws'); // Utilisation du protocole WebSocket

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

// La configuration est stockée en mémoire.
// Elle sera réinitialisée à chaque redémarrage du serveur.
let config = {
  ssid: 'DEFAULT_SSID',
  password: 'DEFAULT_PASS',
  phoneNumber: '+261000000000',
  startHour: 18,
  endHour: 6
};

// File d'attente pour les images en attente de diffusion
let pendingImages = [];
const MAX_PENDING_IMAGES = 10; // Limite pour éviter la surcharge de la mémoire

// Middleware pour les requêtes JSON
app.use(express.json());

// Middleware pour les requêtes d'images brutes.
app.use(express.raw({
  type: 'image/jpeg',
  limit: '10mb'
}));

// Fonction pour envoyer des messages à tous les clients Android
function broadcastToAndroidClients(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      // Envoyer le message à tous les clients
      client.send(JSON.stringify(message));
    }
  });
}

// Fonction pour envoyer une seule image depuis la file d'attente
function processImageQueue() {
  if (pendingImages.length > 0) {
    // Vérifier s'il y a des clients connectés
    const hasConnectedClients = Array.from(wss.clients).some(client => client.readyState === WebSocket.OPEN);

    if (hasConnectedClients) {
      const imageToSend = pendingImages.shift(); // Prend la première image de la file
      broadcastToAndroidClients({
        type: 'image',
        data: imageToSend.data,
        timestamp: imageToSend.timestamp
      });
      console.log(`✅ Image envoyée depuis la file d'attente. ${pendingImages.length} images restantes.`);
    }
  }
}

// Vérifier la file d'attente toutes les 5 secondes
setInterval(processImageQueue, 5000); // Exécute la fonction toutes les 5 secondes

// --- Endpoints pour l'ESP32-CAM ---

// Endpoint pour recevoir les images
app.post('/upload', (req, res) => {
  if (!req.body || req.body.length === 0) {
    return res.status(400).send('Aucune image reçue.');
  }

  const imageBuffer = req.body;
  const base64Image = imageBuffer.toString('base64');

  // Ajouter l'image à la file d'attente
  if (pendingImages.length < MAX_PENDING_IMAGES) {
    pendingImages.push({
      data: base64Image,
      timestamp: Date.now()
    });
    console.log(`📸 Image reçue et ajoutée à la file d'attente. ${pendingImages.length} images en attente.`);
  } else {
    console.log("⚠️ File d'attente pleine. L'image a été ignorée.");
  }

  // Tenter d'envoyer l'image immédiatement si des clients sont connectés
  processImageQueue();

  res.status(200).send('Image reçue et traitée.');
});

// Endpoint pour envoyer la configuration à l'ESP32-CAM
app.get('/get-config', (req, res) => {
  res.json(config);
  console.log('⚙️ Configuration demandée par ESP32, envoyée.');
});

// --- Endpoint pour l'application Android ---

// Endpoint pour recevoir les configurations
app.post('/set-config', (req, res) => {
  const { ssid, password, phoneNumber, startHour, endHour } = req.body;

  // Mise à jour de la configuration en mémoire
  if (ssid !== undefined) config.ssid = ssid;
  if (password !== undefined) config.password = password;
  if (phoneNumber !== undefined) config.phoneNumber = phoneNumber;
  if (startHour !== undefined) config.startHour = startHour;
  if (endHour !== undefined) config.endHour = endHour;

  console.log('✅ Configuration mise à jour par l\'application Android :', config);
  res.status(200).send('Configuration mise à jour avec succès.');
});

// Gestion des connexions WebSocket
wss.on('connection', (ws) => {
  console.log('🔗 Client WebSocket connecté');
  
  // Tenter d'envoyer les images en attente immédiatement
  processImageQueue();

  ws.on('message', (message) => {
    console.log('Message reçu du client :', message.toString());
  });
  ws.on('close', () => {
    console.log('❌ Client WebSocket déconnecté');
  });
  ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error.message);
  });
});

// Lancer le serveur
server.listen(port, () => {
  console.log(`🚀 Serveur en écoute sur le port ${port}`);
});
