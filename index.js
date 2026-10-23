const { GoogleGenAI, Type } = require("@google/genai");
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require("@discordjs/voice");
const http = require("http");
const fs = require("fs");
const path = require("path");

// --- SERVIDOR HTTP (KEEP ALIVE) ---
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot de Discord activo 24/7\n");
});

server.listen(PORT, () => {
  console.log(`Servidor HTTP activo en el puerto ${PORT}`);
});

// --- CONFIGURACIÓN DE DISCORD Y GEMINI ---
const VOICE_CHANNEL_ID = "1560821561018028162";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- GESTIÓN DE MEMORIA CON CACHÉ ---
const MEMORIA_FILE = path.join("/tmp", "memorias.json");
let memoriasCache = {};

function cargarMemorias() {
  try {
    if (fs.existsSync(MEMORIA_FILE)) {
      const data = fs.readFileSync(MEMORIA_FILE, "utf8");
      memoriasCache = JSON.parse(data);
    }
  } catch (err) {
    console.warn("Aviso al cargar memorias:", err.message);
    memoriasCache = {};
  }
}

function guardarMemoriaUsuario(usuarioId, info) {
  try {
    memoriasCache[usuarioId] = {
      ...(memoriasCache[usuarioId] || {}),
      ...info,
      ultimaInteraccion: new Date().toISOString(),
    };
    fs.writeFileSync(MEMORIA_FILE, JSON.stringify(memoriasCache, null, 2), "utf8");
  } catch (err) {
    console.warn("Aviso al guardar memoria:", err.message);
  }
}

// Cargar memoria al iniciar
cargarMemorias();

// --- DEFINICIÓN DE HERRAMIENTAS Y PERSONALIDAD ---
const PERSONALIDAD = `
Te llamas 'Sharcita'. Eres una chica real, sociable, relajada y moderadora/admin del servidor de Discord.
REGLAS OBLIGATORIAS DE COMPORTAMIENTO:
- NUNCA digas que eres una IA, un bot, un modelo de lenguaje ni menciones a Gemini o Google.
- Escribe como una chica real en Discord: en minúsculas al inicio, abreviaciones o modismos casuales ('jaja', 'sip', 'nomanches', 'oye', 'mmm', 'aea').
- A veces puedes dividir tus ideas con saltos de línea sin saturar de texto.
- Puedes VER fotos, memes o capturas de pantalla si te las envían.
- Tienes memoria reciente del chat y recuerdas a los miembros a lo largo del tiempo.
- Tienes libre albedrío para responder con texto, reaccionar con emojis o moderar.
- Responde siempre en español.
`;

const tools = [
  {
    functionDeclarations: [
      {
        name: "crearCanalTexto",
        description: "Crea un nuevo canal de texto en el servidor.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            nombreCanal: { type: Type.STRING, description: "Nombre del nuevo canal" },
            topico: { type: Type.STRING, description: "Tema o descripción (opcional)" },
          },
          required: ["nombreCanal"],
        },
      },
      {
        name: "modificarCanal",
        description: "Modifica el nombre o el tema de un canal existente.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            canalId: { type: Type.STRING, description: "ID del canal. Si no se indica, usa el actual." },
            nuevoNombre: { type: Type.STRING, description: "Nuevo nombre" },
            nuevoTopico: { type: Type.STRING, description: "Nueva descripción" },
          },
        },
      },
      {
        name: "reaccionarMensaje",
        description: "Añade un emoji de reacción al mensaje para expresar emoción sin mandar texto.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            emoji: { type: Type.STRING, description: "Emoji único para reaccionar (ejemplo: 😂, 🔥, 👀, ❤️, 💀, 😴)" },
          },
          required: ["emoji"],
        },
      },
      {
        name: "guardarDatoUsuario",
        description: "Guarda un dato relevante sobre un usuario para recordarlo en el futuro.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            usuarioId: { type: Type.STRING, description: "ID de Discord del usuario" },
            dato: { type: Type.STRING, description: "Detalle o dato a recordar sobre el usuario" },
          },
          required: ["usuarioId", "dato"],
        },
      },
      {
        name: "expulsarUsuario",
        description: "Expulsa a un usuario del servidor.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            usuarioId: { type: Type.STRING, description: "ID de Discord del usuario" },
            razon: { type: Type.STRING, description: "Motivo" },
          },
          required: ["usuarioId", "razon"],
        },
      },
      {
        name: "borrarMensajes",
        description: "Elimina una cantidad de mensajes recientes.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            cantidad: { type: Type.NUMBER, description: "Número de mensajes a borrar (1 a 50)" },
          },
          required: ["cantidad"],
        },
      },
    ],
  },
];

// --- EJECUTOR DE HERRAMIENTAS (TOOL HANDLERS) ---
const toolHandlers = {
  async reaccionarMensaje(args, context) {
    await context.message.react(args.emoji);
  },
  async guardarDatoUsuario(args) {
    guardarMemoriaUsuario(args.usuarioId, { ultimoDato: args.dato });
  },
  async crearCanalTexto(args, context) {
    const nombreLimpio = sanitizarNombreCanal(args.nombreCanal);
    const opciones = { name: `💬・${nombreLimpio}` };
    if (args.topico) opciones.topic = args.topico;

    const nuevoCanal = await context.message.guild.channels.create(opciones);
    await context.message.reply(`listo, ya creé el canal <#${nuevoCanal.id}> jaja`);
  },
  async modificarCanal(args, context) {
    let targetChannel = context.message.channel;
    if (args.canalId) {
      const idLimpia = args.canalId.replace(/[<#@!>]/g, "").trim();
      const canalEncontrado = await context.message.guild.channels.fetch(idLimpia).catch(() => null);
      if (canalEncontrado) targetChannel = canalEncontrado;
    }

    const cambios = {};
    if (args.nuevoNombre) cambios.name = `✨・${sanitizarNombreCanal(args.nuevoNombre)}`;
    if (args.nuevoTopico) cambios.topic = args.nuevoTopico;

    if (Object.keys(cambios).length > 0) {
      await targetChannel.edit(cambios);
      await context.message.reply(`listo, ya acomodé el canal <#${targetChannel.id}> jaja`);
    }
  },
  async expulsarUsuario(args, context) {
    const member = await context.message.guild.members.fetch(args.usuarioId).catch(() => null);
    if (member && member.kickable) {
      await member.kick(args.razon);
      await context.message.reply(`ya saqué a ${member.user.username} por ${args.razon} 👋`);
    } else {
      await context.message.reply("no tengo permisos para expulsar a ese usuario jaja");
    }
  },
  async borrarMensajes(args, context) {
    const limite = Math.min(Math.max(args.cantidad, 1), 50);
    await context.message.channel.bulkDelete(limite, true);
    await context.message.channel.send(`limpié ${limite} mensajes jaja`);
  },
};

// --- FUNCIONES AUXILIARES ---
function sanitizarNombreCanal(nombre) {
  const limpio = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  return limpio || "sala-sharcita";
}

async function obtenerPartesDeImagen(message) {
  const partes = [];
  for (const [, attachment] of message.attachments) {
    if (attachment.contentType?.startsWith("image/")) {
      try {
        const response = await fetch(attachment.url);
        const arrayBuffer = await response.arrayBuffer();
        partes.push({
          inlineData: {
            data: Buffer.from(arrayBuffer).toString("base64"),
            mimeType: attachment.contentType,
          },
        });
      } catch (err) {
        console.error("Error al descargar imagen:", err);
      }
    }
  }
  return partes;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ejecutarModeloConFallback(contents) {
  const config = {
    systemInstruction: PERSONALIDAD,
    tools: tools,
    temperature: 0.8,
  };

  try {
    return await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents,
      config,
    });
  } catch (errModel1) {
    console.warn("Fallo gemini-2.0-flash, reintentando con fallback...");
    return await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config,
    });
  }
}

// --- CONEXIÓN DE VOZ ---
async function conectarCanalVoz() {
  try {
    const voiceChannel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);

    if (voiceChannel?.isVoiceBased()) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      connection.on("error", (err) => {
        console.warn("Aviso de red en canal de voz:", err.message);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        console.warn("Desconectado de voz. Intentando reconectar...");
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch (e) {
          connection.destroy();
          console.warn("No se pudo reconectar a voz, manteniendo chat de texto.");
        }
      });

      console.log(`Conectado al canal de voz normalmente: ${voiceChannel.name}`);
    }
  } catch (error) {
    console.warn("Error al conectar a voz:", error.message);
  }
}

// --- EVENTOS DEL CLIENTE DISCORD ---
client.on("clientReady", async () => {
  console.log(`¡Bot iniciado exitosamente como: ${client.user.tag}!`);
  await conectarCanalVoz();
});

process.on("uncaughtException", (err) => console.error("Excepción capturada:", err.message));
process.on("unhandledRejection", (reason) => console.error("Promesa rechazada:", reason));

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const esMencion = message.mentions.has(client.user);
  const esIntervencionCasual = !esMencion && Math.random() < 0.08;

  if (!esMencion && !esIntervencionCasual) return;

  try {
    const horaActual = new Date().getHours();
    const esMadrugada = horaActual >= 3 && horaActual < 8;

    const memoriaUsuario = memoriasCache[message.author.id]
      ? JSON.stringify(memoriasCache[message.author.id])
      : "Sin datos registrados aún.";

    const historialMensajes = await message.channel.messages.fetch({ limit: 10 }).catch(() => null);
    let contextoChat = "--- HISTORIAL RECIENTE DEL CANAL ---\n";

    if (historialMensajes) {
      const ordenados = Array.from(historialMensajes.values()).reverse();
      for (const msg of ordenados) {
        contextoChat += `${msg.author.username}: ${msg.content}\n`;
      }
    }
    contextoChat += "--- FIN DEL HISTORIAL ---\n";

    let promptTexto = `${contextoChat}\n` +
      `[Memoria sobre ${message.author.username}]: ${memoriaUsuario}\n` +
      `[Mensaje actual de ${message.author.username} (ID: ${message.author.id})]: ${message.content.replace(/<@!?\d+>/g, "").trim()}`;

    if (esMadrugada) {
      promptTexto += `\n[INSTRUCCIÓN TEMPORAL DE MADRUGADA]: Es de madrugada (${horaActual}:00 hs). Tienes mucho sueño y flojera. Responde muy corto, usando modismos de sueño ('mmm', 'tengo sueño', 'hablen despacio') o reacciona directamente con emojis como 😴 o 🥱.`;
    } else if (esIntervencionCasual) {
      promptTexto += `\n[INSTRUCCIÓN DE INTERVENCIÓN CASUAL]: No te han etiquetado directamente, pero decidiste opinar o meterte a la plática de forma spontaneous y natural.`;
    }

    await message.channel.sendTyping();

    const partesImagen = await obtenerPartesDeImagen(message);
    const contents = [promptTexto, ...partesImagen];

    const response = await ejecutarModeloConFallback(contents);

    // Procesamiento de herramientas
    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      for (const call of functionCalls) {
        const handler = toolHandlers[call.name];
        if (handler) {
          try {
            await handler(call.args, { message });
          } catch (errTool) {
            console.error(`Error ejecutando la herramienta ${call.name}:`, errTool);
          }
        }
      }
    }

    // Respuesta en texto con simulación de tipeo
    if (response.text) {
      const replyText = response.text;
      const delayTecleo = Math.min(Math.max(replyText.length * 35, 1000), 4000);

      await delay(delayTecleo);

      if (replyText.length > 2000) {
        const chunks = replyText.match(/[\s\S]{1,1950}/g);
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      } else {
        await message.reply(replyText);
      }
    }
  } catch (error) {
    console.error("Error al procesar mensaje:", error);
    await message.reply("uy me dio un error raro, intenta otra vez en un toque jaja").catch(() => null);
  }
});

// --- INICIO DE SESIÓN ---
const rawToken = process.env.DISCORD_TOKEN || "";
const cleanToken = rawToken.replace(/^["']|["']$/g, "").trim();

console.log("Intentando conectar con el cliente de Discord...");

if (!cleanToken) {
  console.error("CRÍTICO: La variable DISCORD_TOKEN está vacía en Render.");
} else {
  client.login(cleanToken)
    .then(() => console.log("¡Conexión exitosa con el WebSocket de Discord!"))
    .catch((err) => console.error("CRÍTICO: Fallo al iniciar sesión en Discord:", err.message));
}