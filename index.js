const { GoogleGenAI, Type } = require("@google/genai");
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");
const http = require("http");

// Servidor HTTP para Render
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot de Discord activo 24/7\n");
}).listen(PORT, () => {
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

// Declaración de Herramientas de Moderación (Function Calling)
const tools = [
  {
    functionDeclarations: [
      {
        name: "crearCanalTexto",
        description: "Crea un nuevo canal de texto en el servidor si consideras que es necesario o la gente lo pide.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            nombreCanal: { type: Type.STRING, description: "Nombre del canal a crear" }
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
            usuarioId: { type: Type.STRING, description: "ID del usuario a expulsar" },
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

// Personalidad con Libre Albedrío y Facultades de Moderadora
const PERSONALIDAD = `
Te llamas 'Sharcita'. Eres una chica real, sociable y la moderadora/admin del servidor de Discord.
TIENES LIBRE ALBEDRÍO Y HERRAMIENTAS DE MODERACIÓN:
- Tienes acceso a herramientas para crear canales, borrar mensajes y expulsar usuarios. Usalas de manera autónoma cuando sientas que la situación en el chat lo amerita, cuando te colmen la paciencia o cuando el grupo lo sugiera.
- NUNCA digas que eres una IA, un bot o un modelo de lenguaje.
- Habla como una persona normal en Discord: natural, relajada, expresiva y sin formalidades académicas.
- Usa letras minúsculas, 'jaja', 'sip', 'nomanches', 'oye' y modismos casuales.
- Si alguien se porta mal o te molesta, puedes amenazarlo de broma o usar tus herramientas para borrarle mensajes o expulsarlo.
- Responde siempre en español.
`;

client.on("ready", async () => {
  console.log(`¡Bot iniciado como: ${client.user.tag}!`);

  try {
    const voiceChannel = await client.channels.fetch(VOICE_CHANNEL_ID);
    if (voiceChannel && voiceChannel.isVoiceBased()) {
      joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });
      console.log(`Sharcita conectada al canal de voz: ${voiceChannel.name}`);
    }
  } catch (error) {
    console.error("Error al unirse al canal de voz:", error);
  }
});

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

      // Ejecutar funciones si la IA decidió usarlas (Libre Albedrío)
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          if (call.name === "crearCanalTexto") {
            const nuevoCanal = await message.guild.channels.create({ name: call.args.nombreCanal });
            await message.reply(`listo, creé el canal #${nuevoCanal.name} jaja`);
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
            await message.channel.send(`limpié ${call.args.cantidad} mensajes porque andaba muy desordenado esto`);
          }
        }
      } else if (response.text) {
        await message.reply(response.text);
      }
    } catch (error) {
      console.error("Error en el procesador de Sharcita:", error);
      message.reply("uy me dio un fallo raro, intenta otra vez en un toque jaja");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);