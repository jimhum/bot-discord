const { GoogleGenAI, Type } = require("@google/genai");
const { Client, GatewayIntentBits } = require("discord.js");
const { joinVoiceChannel, VoiceConnectionStatus } = require("@discordjs/voice");
const http = require("http");

// Servidor HTTP obligatorio para mantener el Web Service vivo en Render
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

// Declaración de Herramientas de Moderación (Function Calling)
const tools = [
  {
    functionDeclarations: [
      {
        name: "crearCanalTexto",
        description: "Crea un nuevo canal de texto en el servidor si consideras que es necesario o si te lo piden.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            nombreCanal: { type: Type.STRING, description: "Nombre del nuevo canal de texto" }
          },
          required: ["nombreCanal"]
        }
      },
      {
        name: "expulsarUsuario",
        description: "Expulsa a un usuario del servidor si está molestando, haciendo spam o rompiendo las reglas.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            usuarioId: { type: Type.STRING, description: "ID de Discord del usuario a expulsar" },
            razon: { type: Type.STRING, description: "Motivo de la expulsión" }
          },
          required: ["usuarioId", "razon"]
        }
      },
      {
        name: "borrarMensajes",
        description: "Elimina una cantidad de mensajes recientes en el canal si hay spam o desorden.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            cantidad: { type: Type.NUMBER, description: "Número de mensajes a borrar (entre 1 y 50)" }
          },
          required: ["cantidad"]
        }
      }
    ]
  }
];

// Personalidad Humana con Libre Albedrío
const PERSONALIDAD = `
Te llamas 'Sharcita'. Eres una chica real, sociable y la moderadora/admin del servidor de Discord.
REGLAS OBLIGATORIAS DE COMPORTAMIENTO:
- NUNCA digas que eres una IA, un bot, un modelo de lenguaje ni menciones a Gemini o Google.
- Habla como una persona normal en Discord: de forma natural, relajada, expresiva y sin formalidades excesivas.
- Si te preguntan quién eres o qué haces, responde como una chica geek/gamer cualquiera del servidor a la que le gusta platicar y jugar.
- Usa letras minúsculas al inicio, abreviaciones o modismos casuales cuando quede bien (ejemplo: 'jaja', 'sip', 'nomanches', 'oye', 'mmm').
- No uses listas estructuradas con viñetas ni respuestas largas estilo ensayo académico a menos que te pidan explícitamente una explicación detallada.
- Tienes libre albedrío y acceso a herramientas para crear canales, borrar mensajes y expulsar usuarios. Úsalas cuando la situación lo amerite, cuando te molesten o cuando el grupo lo proponga.
- Responde siempre en español.
`;

// Uso de clientReady para evitar advertencias en Discord.js v15
client.on("clientReady", async () => {
  console.log(`¡Bot iniciado exitosamente como: ${client.user.tag}!`);

  // Intentar la conexión de voz de manera aislada y protegida
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

      // Escuchar errores de conexión sin detener la aplicación
      connection.on("error", (err) => {
        console.warn("Aviso de red en canal de voz (no crítico):", err.message);
      });

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        console.warn("Desconectado del canal de voz. El bot sigue operando en texto.");
      });

      console.log(`Intentando mantener conexión en el canal de voz: ${voiceChannel.name}`);
    }
  } catch (error) {
    console.warn("No se pudo conectar al canal de voz, pero el bot continúa activo:", error.message);
  }
});

// Manejo central de errores no capturados para que el servidor nunca colapse
process.on("uncaughtException", (err) => {
  console.error("Excepción capturada para prevenir caída:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("Rechazo no manejado para prevenir caída:", reason);
});

// Lógica principal de mensajes y libre albedrío
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.mentions.has(client.user)) {
    try {
      const prompt = `[Usuario: ${message.author.username}, ID: ${message.author.id}]: ${message.content.replace(/<@!?\d+>/g, "").trim()}`;

      await message.channel.sendTyping();

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: PERSONALIDAD,
          tools: tools,
          temperature: 0.8,
        },
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          if (call.name === "crearCanalTexto") {
            const nuevoCanal = await message.guild.channels.create({ name: call.args.nombreCanal });
            await message.reply(`listo, ya creé el canal #${nuevoCanal.name} jaja`);
          } else if (call.name === "expulsarUsuario") {
            const member = await message.guild.members.fetch(call.args.usuarioId).catch(() => null);
            if (member && member.kickable) {
              await member.kick(call.args.razon);
              await message.reply(`ya saqué a ${member.user.username} por ${call.args.razon} 👋`);
            } else {
              await message.reply("no pude sacar a ese usuario, o no tengo rango o es admin jaja");
            }
          } else if (call.name === "borrarMensajes") {
            await message.channel.bulkDelete(Math.min(call.args.cantidad, 50));
            await message.channel.send(`limpié ${call.args.cantidad} mensajes porque perception andaba muy desordenado esto`);
          }
        }
      } else if (response.text) {
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
      console.error("Error en la ejecución de Sharcita:", error);
      message.reply("uy me dio un error raro, intenta otra vez en un toque jaja");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);