const { GoogleGenAI, Type } = require("@google/genai");
const { Client, GatewayIntentBits } = require("discord.js");
const http = require("http");
const fs = require("fs");
const path = require("path");
const dns = require("dns");

// Forzar la resolución de nombres en IPv4 primero para evitar bloqueos en Render
dns.setDefaultResultOrder("ipv4first");

// Servidor HTTP obligatorio para Render
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot de Discord activo 24/7\n");
});

server.listen(PORT, () => {
  console.log(`Servidor HTTP activo en el puerto ${PORT}`);
});

// Configuración del cliente con timeout explícito
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  ws: {
    timeout: 30000,
  },
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MEMORIA_FILE = path.join("/tmp", "memorias.json");

function cargarMemorias() {
  try {
    if (fs.existsSync(MEMORIA_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORIA_FILE, "utf8"));
    }
  } catch (err) {
    console.warn("Aviso memorias:", err.message);
  }
  return {};
}

function guardarMemoriaUsuario(usuarioId, info) {
  try {
    const memorias = cargarMemorias();
    memorias[usuarioId] = { ...(memorias[usuarioId] || {}), ...info, ultimaInteraccion: new Date().toISOString() };
    fs.writeFileSync(MEMORIA_FILE, JSON.stringify(memorias, null, 2), "utf8");
  } catch (err) {
    console.warn("Aviso al guardar:", err.message);
  }
}

const tools = [
  {
    functionDeclarations: [
      {
        name: "reaccionarMensaje",
        description: "Reacciona con un emoji al mensaje.",
        parameters: { type: Type.OBJECT, properties: { emoji: { type: Type.STRING } }, required: ["emoji"] }
      }
    ]
  }
];

const PERSONALIDAD = `Te llamas 'Sharcita'. Eres una chica real, relajada y moderadora de Discord. Escribe casual, en minúsculas y sin decir que eres IA.`;

client.on("clientReady", () => {
  console.log(`=========================================`);
  console.log(`¡¡¡BOT EN LÍNEA EXITOSAMENTE COMO: ${client.user.tag}!!!`);
  console.log(`=========================================`);
});

client.on("debug", (info) => {
  // Imprime traza detallada del WebSocket para ver dónde se queda atascado
  if (info.includes("Connecting") || info.includes("Session") || info.includes("Heartbeat") || info.includes("ERROR")) {
    console.log(`[DISCORD DEBUG]: ${info}`);
  }
});

process.on("uncaughtException", (err) => console.error("Error no capturado:", err.message));
process.on("unhandledRejection", (reason) => console.error("Promesa rechazada:", reason));

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.mentions.has(client.user)) {
    try {
      await message.channel.sendTyping();
      const prompt = `[Mensaje de ${message.author.username}]: ${message.content.replace(/<@!?\d+>/g, "").trim()}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [prompt],
        config: { systemInstruction: PERSONALIDAD, tools: tools, temperature: 0.8 }
      });

      if (response.text) {
        await message.reply(response.text);
      }
    } catch (error) {
      console.error("Error respondiendo:", error);
    }
  }
});

const rawToken = process.env.DISCORD_TOKEN || "";
const cleanToken = rawToken.replace(/^["']|["']$/g, "").trim();

console.log("Iniciando login en Discord con soporte IPv4...");

// Control de tiempo límite manual
const loginTimeout = setTimeout(() => {
  console.error("CRÍTICO: La conexión al WebSocket de Discord tardó más de 15 segundos. Reiniciando proceso...");
  process.exit(1); // Fuerza a Render a reiniciar si se congela
}, 15000);

client.login(cleanToken)
  .then(() => {
    clearTimeout(loginTimeout);
    console.log("Petición de login enviada al servidor de Discord.");
  })
  .catch((err) => {
    clearTimeout(loginTimeout);
    console.error("Error directo al autenticar en Discord:", err.message);
  });