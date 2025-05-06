const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("baileys");
const express = require("express");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(__dirname));

let sock;
const SESSION_ID = "session1";
const authDir = path.join(__dirname, `auth_info_${SESSION_ID}`);

async function initializeBot() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      const qrImage = await qrcode.toDataURL(qr);
      fs.writeFileSync("qr.txt", qrImage);
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected");
      await saveCreds();
    }

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Disconnected. Reconnect?", shouldReconnect);
      if (shouldReconnect) initializeBot();
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

app.get("/qr", (req, res) => {
  if (fs.existsSync("qr.txt")) {
    const qrData = fs.readFileSync("qr.txt", "utf-8");
    res.send(qrData);
  } else {
    res.send("QR not available");
  }
});

app.get("/status", (req, res) => {
  const isConnected = sock?.user ? true : false;
  res.json({ connected: isConnected });
});

app.post('/send-message', async (req, res) => {
  const { phoneNumber, message, apiKey } = req.body;

  if (apiKey !== "123456") {
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }

  if (!phoneNumber || !message) {
    return res.status(400).json({ status: false, message: "Missing phoneNumber or message" });
  }

  const cleanedNumber = phoneNumber.replace(/\D/g, ""); // remove non-numeric chars
  const fullNumber = cleanedNumber.includes('@s.whatsapp.net')
    ? cleanedNumber
    : `${cleanedNumber}@s.whatsapp.net`;

  try {
    await sock.sendMessage(fullNumber, { text: message });
    return res.json({ status: true, message: "Message sent" });
  } catch (err) {
    console.error("Send error:", err);
    return res.status(500).json({ status: false, message: "Message send failed", error: err.toString() });
  }
});

  
initializeBot();
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
