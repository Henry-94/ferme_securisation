const express = require('express');
const multer = require('multer');
const http = require('http');
const WebSocket = require('ws'); // Utilisation du protocole WebSocket
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server }); // Crée un serveur WebSocket attaché au serveur HTTP
const port = process.env.PORT || 3000;

// Création du dossier pour les images si ce n'est pas déjà fait
const uploadsDir = path.join(__dirname, 'Uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configuration de multer pour la gestion des uploads d'images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `capture_${Date.now()}.jpg`);
  }
});
const upload = multer({ storage: storage });

// Fichier pour stocker la configuration de l'appareil
const configFilePath = path.join(__dirname, 'config.json');

// Configuration par défaut
let config = {
  ssid: 'DEFAULT_SSID',
  password: 'DEFAULT_PASS',
  phoneNumber: '+261000000000',
  startHour: 18,
  endHour: 6
};

// Charger la configuration depuis le fichier au démarrage
if (fs.existsSync(configFilePath)) {
  try {
    config = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    console.log('✅ Configuration chargée :', config);
  } catch (err) {
    console.error('❌ Erreur lors du chargement de la configuration :', err);
  }
} else {
  // Créer un fichier de configuration par défaut s'il n'existe pas
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
  console.log('✅ Configuration par défaut créée :', config);
}

// Middleware pour parser les requêtes JSON
app.use(express.json());

// Servir les images statiquement (afin que les clients puissent les télécharger)
app.use('/Uploads', express.static(uploadsDir));

// --- Endpoints pour l'ESP32-CAM ---

// Endpoint pour recevoir les images
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('Aucune image reçue');
  }
  const filePath = `/Uploads/${req.file.filename}`;
  console.log('📸 Image reçue et enregistrée :', filePath);

  // Notifier tous les clients Android connectés via WebSocket
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'image', url: filePath, timestamp: Date.now() }));
    }
  });

  res.status(200).send('Image reçue et stockée avec succès');
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

  // Mise à jour de la configuration avec les champs fournis
  if (ssid !== undefined) config.ssid = ssid;
  if (password !== undefined) config.password = password;
  if (phoneNumber !== undefined) config.phoneNumber = phoneNumber;
  if (startHour !== undefined) config.startHour = startHour;
  if (endHour !== undefined) config.endHour = endHour;

  // Enregistrer la configuration mise à jour dans le fichier
  try {
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
    console.log('✅ Configuration mise à jour par l\'application Android :', config);
    res.status(200).send('Configuration mise à jour avec succès');
  } catch (err) {
    console.error('❌ Erreur lors de l\'enregistrement de la configuration :', err);
    res.status(500).send('Erreur serveur lors de l\'enregistrement');
  }
});

// Gestion des connexions WebSocket
wss.on('connection', (ws) => {
  console.log('🔗 Client WebSocket connecté');
  ws.on('message', (message) => {
    console.log('Message reçu du client :', message.toString());
    // Ici, vous pouvez gérer les messages d'identification ou d'autres commandes
  });
  ws.on('close', () => {
    console.log('❌ Client WebSocket déconnecté');
  });
});

// Lancer le serveur
server.listen(port, () => {
  console.log(`🚀 Serveur en écoute sur le port ${port}`);
});
