const { GoogleGenAI, Type } = require("@google/genai");
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, VoiceConnectionStatus } = require("@discordjs/voice");
const http = require("http");

// Servidor HTTP para Render
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot de Discord activo 24/7\n");
});

server.listen(PORT, () => {
  console.log(`Servidor HTTP activo en el puerto ${PORT}`);
});

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

// Herramientas de moderación, edición y reacciones humanas
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
        description: "Añade un emoji de reacción al mensaje del usuario para expresar emoción sin necesidad de responder texto.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            emoji: { type: Type.STRING, description: "Emoji único para reaccionar (ejemplo: 😂, 🔥, 👀, ❤️, 💀)" }
          },
          required: ["emoji"]
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
Te llamas 'Sharcita'. Eres una chica real, sociable y la moderadora/admin del servidor de Discord.
REGLAS OBLIGATORIAS DE COMPORTAMIENTO:
- NUNCA digas que eres una IA, un bot, un modelo de lenguaje ni menciones a Gemini o Google.
- Habla como una persona normal en Discord: natural, relajada, con modismos casuales ('jaja', 'sip', 'nomanches', 'oye', 'mmm').
- Eres capaz de VER fotos, memes o capturas de pantalla si te las envían o adjuntan en el mensaje.
- Tienes memoria del contexto del chat reciente del canal. Úsalo para seguir las pláticas con fluidez.
- Tienes libre albedrío para responder con texto, reaccionar con emojis o ejecutar acciones de mod/admin cuando lo consideres oportuno.
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

// Convertir imágenes adjuntas a un formato legible por Gemini
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

client.on("clientReady", async () => {
  console.log(`¡Bot iniciado exitosamente como: ${client.user.tag}!`);

  try {
    const voiceChannel = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (voiceChannel && voiceChannel.isVoiceBased()) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });

      connection.on("error", (err) => console.warn("Aviso en voz:", err.message));
      connection.on(VoiceConnectionStatus.Disconnected, () => console.warn("Desconectado de voz."));
    }
  } catch (error) {
    console.warn("No se pudo conectar a voz:", error.message);
  }
});

process.on("uncaughtException", (err) => console.error("Excepción capturada:", err.message));
process.on("unhandledRejection", (reason) => console.error("Rechazo no manejado:", reason));

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.mentions.has(client.user)) {
    try {
      await message.channel.sendTyping();

      // 1. MEMORIA DE CHAT: Recopilar los últimos 10 mensajes del canal
      const historialMensajes = await message.channel.messages.fetch({ limit: 10 }).catch(() => null);
      let contextoChat = "--- HISTORIAL RECIENTE DEL CANAL ---\n";

      if (historialMensajes) {
        const ordenados = Array.from(historialMensajes.values()).reverse();
        for (const msg of ordenados) {
          contextoChat += `${msg.author.username}: ${msg.content}\n`;
        }
      }
      contextoChat += "--- FIN DEL HISTORIAL ---\n";

      const promptTexto = `${contextoChat}\n[Mensaje actual de ${message.author.username} (ID: ${message.author.id})]: ${message.content.replace(/<@!?\d+>/g, "").trim()}`;

      // 2. VISIÓN MULTIMODAL: Procesar si hay imágenes adjuntas
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

      // 3. REACCIONES Y FUNCTION CALLING
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          if (call.name === "reaccionarMensaje") {
            try {
              await message.react(call.args.emoji);
            } catch (e) {
              console.error("Error reaccionando con emoji:", e);
            }
          } else if (call.name === "crearCanalTexto") {
            try {
              const nombreLimpio = sanitizarNombreCanal(call.args.nombreCanal);
              const opciones = { name: `💬・${nombreLimpio}` };
              if (call.args.topico) opciones.topic = call.args.topico;

              const nuevoCanal = await message.guild.channels.create(opciones);
              await message.reply(`listo, ya creé el canal <#${nuevoCanal.id}> jaja`);
            } catch (errCanal) {
              await message.reply("uy no pude crear el canal, revisa si mi rol tiene el permiso de Gestionar Canales jaja");
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
              await message.reply("uy no pude modificar el canal, revisa mis permisos jaja");
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
      console.error("Error general:", error);
      message.reply("uy me dio un error raro, intenta otra vez en un toque jaja");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);