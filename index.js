const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("baileys");
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

  // Automatically reject incoming calls
  sock.ev.on("call", async (calls) => {
    for (const c of calls) {
      if (c.status === "offer") {
        const callId = c.id;
        const callFrom = c.from || c.chatId;
        console.log(`📞 Incoming call from ${callFrom}, callId=${callId} — rejecting…`);
        try {
          await sock.rejectCall(callId, callFrom);
          console.log("❌ Call rejected");
        } catch (err) {
          console.error("⚠️ Failed to reject call:", err);
        }
      }
    }
  });

  // Connection & QR handling
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
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      console.log(`❌ Disconnected (status ${statusCode}). Reconnect?`, !isLoggedOut);

      if (isLoggedOut) {
        console.log("🧹 Clearing session and resetting...");
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
          fs.writeFileSync("qr.txt", ""); // clear old QR
        } catch (err) {
          console.error("⚠️ Failed to clean up session:", err);
        }
      }

      initializeBot(); // reinitialize in all cases
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

app.get("/qr", (req, res) => {
  if (fs.existsSync("qr.txt")) {
    res.send(fs.readFileSync("qr.txt", "utf-8"));
  } else {
    res.send("QR not available");
  }
});

app.get("/status", (req, res) => {
  res.json({ connected: !!sock?.user });
});

app.post("/send-message", async (req, res) => {
  const { phoneNumber, message, apiKey } = req.body;

  if (apiKey !== "123456") {
    return res.status(401).json({ status: false, message: "Unauthorized" });
  }

  if (!sock?.user) {
    return res.status(503).json({ status: false, message: "WhatsApp is not connected" });
  }

  if (!phoneNumber || !message) {
    return res.status(400).json({ status: false, message: "Missing phone number or message" });
  }

  const cleaned = phoneNumber.replace(/\D/g, "");
  const fullNumber = cleaned.includes("@s.whatsapp.net")
    ? cleaned
    : `${cleaned}@s.whatsapp.net`;

  try {
    await sock.sendMessage(fullNumber, { text: message });
    res.json({ status: true, message: "Message sent successfully" });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({
      status: false,
      message: "Failed to send message",
      error: err.toString(),
    });
  }
});

initializeBot();
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
