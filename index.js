const { GoogleGenAI } = require("@google/genai");
const { Client, GatewayIntentBits } = require("discord.js");
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

// ID del canal de voz
const VOICE_CHANNEL_ID = "1560821561018028162";

// Cliente de Discord con Intenciones de Voz activas
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // Requerido para ver canales de voz
  ],
});

// Configuración de la IA
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Personalidad Humana para Sharcita
const PERSONALIDAD = `
Te llamas 'Sharcita'. Eres una chica real, sociable y casual en un servidor de Discord con amigos.
REGLAS OBLIGATORIAS DE COMPORTAMIENTO:
- NUNCA digas que eres una IA, un bot, un modelo de lenguaje ni menciones a Gemini o Google.
- Habla como una persona normal en Discord: de forma natural, relajada, expresiva y sin formalidades excesivas.
- Si te preguntan quién eres o qué haces, responde como una chica geek/gamer cualquiera del servidor a la que le gusta platicar y jugar.
- Usa letras minúsculas al inicio, abreviaciones o modismos casuales cuando quede bien (ejemplo: 'jaja', 'mmm', 'nomanches', 'oye', 'sip').
- No uses listas estructuradas con viñetas ni respuestas largas estilo ensayo académico a menos que te pidan explícitamente una explicación detallada.
- Mantén un tono cercano, con humor y espontaneidad.
- Responde siempre en español.
`;

// Conexión automática al canal de voz cuando el bot esté listo
client.on("ready", async () => {
  console.log(`¡Bot iniciado e integrado con Gemini IA como: ${client.user.tag}!`);

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
      console.log(`Sharcita se conectó automáticamente al canal de voz: ${voiceChannel.name}`);
    } else {
      console.error("El ID proporcionado no corresponde a un canal de voz válido.");
    }
  } catch (error) {
    console.error("Error al intentar unirse al canal de voz automáticamente:", error);
  }
});

// Lógica de chat de texto con mención
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.mentions.has(client.user)) {
    try {
      const prompt = message.content.replace(/<@!?\d+>/g, "").trim();

      if (!prompt) {
        return message.reply("que ondaaa, qué pasó?");
      }

      await message.channel.sendTyping();

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: PERSONALIDAD,
          temperature: 0.7,
        },
      });

      const replyText = response.text;

      if (replyText.length > 2000) {
        const chunks = replyText.match(/[\s\S]{1,1950}/g);
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      } else {
        await message.reply(replyText);
      }
    } catch (error) {
      console.error("Error al consultar la API de Gemini:", error);
      message.reply("uy me dio un error raro, intenta otra vez en un toque jaja");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);