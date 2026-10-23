const { GoogleGenAI, Type } = require("@google/genai");
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require("@discordjs/voice");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Servidor HTTP obligatorio para mantener el Web Service activo en Render
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot de Discord activo 24/7\n");
});

server.listen(PORT, () => {
  console.log(`Servidor HTTP activo en el puerto ${PORT}`);
});

// ID del canal de voz
const VOICE_CHANNEL_ID = "1560821561018028162";

// Inicialización del cliente de Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// Inicialización de la API de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Manejo seguro del archivo de memoria de usuarios en el directorio temporal
const MEMORIA_FILE = path.join("/tmp", "memorias.json");

function cargarMemorias() {
  try {
    if (fs.existsSync(MEMORIA_FILE)) {
      const data = fs.readFileSync(MEMORIA_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn("Aviso al cargar memorias (no crítico):", err.message);
  }
  return {};
}

function guardarMemoriaUsuario(usuarioId, info) {
  try {
    const memorias = cargarMemorias();
    memorias[usuarioId] = {
      ...(memorias[usuarioId] || {}),
      ...info,
      ultimaInteraccion: new Date().toISOString()
    };
    fs.writeFileSync(MEMORIA_FILE, JSON.stringify(memorias, null, 2), "utf8");
  } catch (err) {
    console.warn("Aviso al guardar memoria (no crítico):", err.message);
  }
}

// Declaración de Herramientas de Moderación, Edición, Reacciones y Memoria
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
            topico: { type: Type.STRING, description: "Tema o descripción (opcional)" }
          },
          required: ["nombreCanal"]
        }
      },
      {
        name: "modificarCanal",
        description: "Modifica el nombre o el tema de un canal existente.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            canalId: { type: Type.STRING, description: "ID del canal. Si no se indica, usa el actual." },
            nuevoNombre: { type: Type.STRING, description: "Nuevo nombre" },
            nuevoTopico: { type: Type.STRING, description: "Nueva descripción" }
          }
        }
      },
      {
        name: "reaccionarMensaje",
        description: "Añade un emoji de reacción al mensaje para expresar emoción sin mandar texto.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            emoji: { type: Type.STRING, description: "Emoji único para reaccionar (ejemplo: 😂, 🔥, 👀, ❤️, 💀, 😴)" }
          },
          required: ["emoji"]
        }
      },
      {
        name: "guardarDatoUsuario",
        description: "Guarda un dato relevante sobre un usuario para recordarlo en el futuro.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            usuarioId: { type: Type.STRING, description: "ID de Discord del usuario" },
            dato: { type: Type.STRING, description: "Detalle o dato a recordar sobre el usuario" }
          },
          required: ["usuarioId", "dato"]
        }
      },
      {
        name: "expulsarUsuario",
        description: "Expulsa a un usuario del servidor.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            usuarioId: { type: Type.STRING, description: "ID de Discord del usuario" },
            razon: { type: Type.STRING, description: "Motivo" }
          },
          required: ["usuarioId", "razon"]
        }
      },
      {
        name: "borrarMensajes",
        description: "Elimina una cantidad de mensajes recientes.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            cantidad: { type: Type.NUMBER, description: "Número de mensajes a borrar (1 a 50)" }
          },
          required: ["cantidad"]
        }
      }
    ]
  }
];

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

function sanitizarNombreCanal(nombre) {
  let limpio = nombre
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  return limpio || "sala-sharcita";
}

async function obtenerPartesDeImagen(message) {
  const partes = [];
  for (const [, attachment] of message.attachments) {
    if (attachment.contentType && attachment.contentType.startsWith("image/")) {
      try {
        const response = await fetch(attachment.url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        partes.push({
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: attachment.contentType
          }
        });
      } catch (err) {
        console.error("Error al descargar imagen:", err);
      }
    }
  }
  return partes;
}

// Conexión de voz sin desensordecer ni mutear
async function conectarCanalVoz() {
  try {
    const voiceChannel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    
    if (voiceChannel && voiceChannel.isVoiceBased()) {
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

client.on("clientReady", async () => {
  console.log(`¡Bot iniciado exitosamente como: ${client.user.tag}!`);
  await conectarCanalVoz();
});

// Captura total de errores no controlados para impedir caídas
process.on("uncaughtException", (err) => {
  console.error("Excepción capturada para prevenir caída:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Promesa rechazada capturada para prevenir caída:", reason);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const esMencion = message.mentions.has(client.user);
  const esIntervencionCasual = !esMencion && Math.random() < 0.08;

  if (esMencion || esIntervencionCasual) {
    try {
      const horaActual = new Date().getHours();
      const esMadrugada = horaActual >= 3 && horaActual < 8;

      const memoriasCargadas = cargarMemorias();
      const memoriaUsuario = memoriasCargadas[message.author.id] 
        ? JSON.stringify(memoriasCargadas[message.author.id]) 
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
        promptTexto += `\n[INSTRUCCIÓN DE INTERVENCIÓN CASUAL]: No te han etiquetado directamente, pero decidiste opinar o meterte a la plática de forma espontánea y natural.`;
      }

      await message.channel.sendTyping();

      const partesImagen = await obtenerPartesDeImagen(message);
      const contents = [promptTexto, ...partesImagen];

      let response;
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: contents,
          config: {
            systemInstruction: PERSONALIDAD,
            tools: tools,
            temperature: 0.8,
          },
        });
      } catch (errModel1) {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: contents,
          config: {
            systemInstruction: PERSONALIDAD,
            tools: tools,
            temperature: 0.8,
          },
        });
      }

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          if (call.name === "reaccionarMensaje") {
            try {
              await message.react(call.args.emoji);
            } catch (e) {
              console.error("Error al reaccionar:", e);
            }
          } else if (call.name === "guardarDatoUsuario") {
            try {
              guardarMemoriaUsuario(call.args.usuarioId, { ultimoDato: call.args.dato });
            } catch (e) {
              console.error("Error guardando dato:", e);
            }
          } else if (call.name === "crearCanalTexto") {
            try {
              const nombreLimpio = sanitizarNombreCanal(call.args.nombreCanal);
              const opciones = { name: `💬・${nombreLimpio}` };
              if (call.args.topico) opciones.topic = call.args.topico;

              const nuevoCanal = await message.guild.channels.create(opciones);
              await message.reply(`listo, ya creé el canal <#${nuevoCanal.id}> jaja`);
            } catch (errCanal) {
              await message.reply("uy no pude crear el canal, revisa si mi rol tiene permisos de Gestionar Canales jaja");
            }
          } else if (call.name === "modificarCanal") {
            try {
              let targetChannel = message.channel;
              if (call.args.canalId) {
                const idLimpia = call.args.canalId.replace(/[<#@!>]/g, "").trim();
                const canalEncontrado = await message.guild.channels.fetch(idLimpia).catch(() => null);
                if (canalEncontrado) targetChannel = canalEncontrado;
              }

              const cambios = {};
              if (call.args.nuevoNombre) cambios.name = `✨・${sanitizarNombreCanal(call.args.nuevoNombre)}`;
              if (call.args.nuevoTopico) cambios.topic = call.args.nuevoTopico;

              if (Object.keys(cambios).length > 0) {
                await targetChannel.edit(cambios);
                await message.reply(`listo, ya acomodé el canal <#${targetChannel.id}> jaja`);
              }
            } catch (errMod) {
              await message.reply("uy no pude modificar el canal jaja");
            }
          } else if (call.name === "expulsarUsuario") {
            try {
              const member = await message.guild.members.fetch(call.args.usuarioId).catch(() => null);
              if (member && member.kickable) {
                await member.kick(call.args.razon);
                await message.reply(`ya saqué a ${member.user.username} por ${call.args.razon} 👋`);
              }
            } catch (errKick) {
              await message.reply("no tengo permisos para expulsar a ese usuario jaja");
            }
          } else if (call.name === "borrarMensajes") {
            try {
              await message.channel.bulkDelete(Math.min(call.args.cantidad, 50));
              await message.channel.send(`limpié ${call.args.cantidad} mensajes jaja`);
            } catch (errBorrar) {
              await message.reply("no pude borrar los mensajes jaja");
            }
          }
        }
      }

      if (response.text) {
        const replyText = response.text;
        const delayTecleo = Math.min(Math.max(replyText.length * 35, 1000), 4000);
        
        setTimeout(async () => {
          if (replyText.length > 2000) {
            const chunks = replyText.match(/[\s\S]{1,1950}/g);
            for (const chunk of chunks) {
              await message.reply(chunk);
            }
          } else {
            await message.reply(replyText);
          }
        }, delayTecleo);
      }
    } catch (error) {
      console.error("Error al procesar mensaje:", error);
      message.reply("uy me dio un error raro, intenta otra vez en un toque jaja");
    }
  }
});

// Limpieza automática del token antes de iniciar sesión
const rawToken = process.env.DISCORD_TOKEN || "";
const cleanToken = rawToken.replace(/^["']|["']$/g, "").trim();

console.log("Intentando conectar con el cliente de Discord...");

if (!cleanToken) {
  console.error("CRÍTICO: La variable DISCORD_TOKEN está vacía en Render.");
} else {
  client.login(cleanToken)
    .then(() => {
      console.log("¡Conexión exitosa con el WebSocket de Discord!");
    })
    .catch((err) => {
      console.error("CRÍTICO: Fallo al iniciar sesión en Discord:", err.message);
    });
}