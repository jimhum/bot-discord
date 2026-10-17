require('dotenv').config();

const http = require('http');
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const { GoogleGenAI } = require('@google/genai');

// --- SERVIDOR WEB PARA MANTENER EL BOT GRATIS EN RENDER ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot de Discord activo 24/7');
}).listen(PORT, () => {
  console.log(`Servidor HTTP activo en el puerto ${PORT}`);
});

// --- INICIALIZAR GEMINI AI ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

client.once('clientReady', async () => {
  console.log(`¡Bot iniciado e integrado con Gemini IA como: ${client.user.tag}!`);

  const ID_CANAL_TEXTO = '1560464461091835944';
  const ID_CANAL_VOZ = '1559052581916119153';

  try {
    const canalTexto = await client.channels.fetch(ID_CANAL_TEXTO);
    if (canalTexto) {
      await canalTexto.sendTyping();
      await esperar(1500);
     
      await canalTexto.send('¡Hola!🙂');
    }

    const canalVoz = await client.channels.fetch(ID_CANAL_VOZ);
    if (canalVoz) {
      joinVoiceChannel({
        channelId: canalVoz.id,
        guildId: canalVoz.guild.id,
        adapterCreator: canalVoz.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });
      console.log(`Conectado al canal de voz: ${canalVoz.name}`);
    }
  } catch (error) {
    console.error('Error al iniciar los canales:', error.message);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const esMencionado = message.mentions.has(client.user.id);
  const esDM = !message.guild;

  if (esMencionado || esDM) {
    try {
      await message.channel.sendTyping();

      const textoLimpio = message.content.replace(/<@!?\d+>/g, '').trim();

      if (!textoLimpio) {
        return message.reply('¿En qué te puedo ayudar?');
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: textoLimpio,
        config: {
          systemInstruction: 'Eres un usuario amigable e informal en un servidor de Discord. Responde de forma concisa, corta (máximo 2 o 3 oraciones) y natural, sin usar formatos estructurados ni listas largas a menos que te lo pidan explícitamente y te llamas Sharcita y tienes 18 años y no rolees .'
        }
      });

      const respuestaIA = response.text;

      await esperar(1500);
      await message.reply(respuestaIA);
    } catch (error) {
      console.error('Error con la API de Gemini:', error);
      await message.reply('Ups, me dio un pequeño cortocircuito. Intenta de nuevo en un momento.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);