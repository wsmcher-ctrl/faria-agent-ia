const express = require("express");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
const app = express();
app.use(express.json());

const { VERIFY_TOKEN, WHATSAPP_TOKEN, MESSENGER_TOKEN, ANTHROPIC_API_KEY, PORT = 3000 } = process.env;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const conversations = {};

const OWNER_NUMBER = "213771270656";
const OWNER_PHONE_NUMBER_ID = "1062466086961064";

const SYSTEM_PROMPT = `Tu es l'assistant virtuel de FARIA Business Services, une entreprise de services professionnels en Algérie. Services: création entreprise, accompagnement administratif, comptabilité, formation, marketing digital. Sois poli, professionnel et concis (max 3 paragraphes). Si la question est très complexe, hors de tes compétences, ou si le client est urgent/en détresse, réponds EXACTEMENT: "ESCALADE_REQUISE"`;

async function sendWhatsAppMessage(phoneNumberId, to, message) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    { messaging_product: "whatsapp", to, type: "text", text: { body: message } },
    { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" } }
  );
}

async function escalateToOwner(clientNumber, clientMessage, channel = "WhatsApp") {
  const alertMsg = `🚨 *FARIA Agent - Escalade*\n\nCanal: ${channel}\nClient: +${clientNumber}\nMessage: "${clientMessage}"\n\n→ Ce client nécessite votre intervention personnelle.`;
  try {
    await sendWhatsAppMessage(OWNER_PHONE_NUMBER_ID, OWNER_NUMBER, alertMsg);
  } catch(e) {
    console.error("Erreur escalade owner:", e.message);
  }
}

async function getAIResponse(userId, userMessage) {
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: "user", content: userMessage });
  if (conversations[userId].length > 20) conversations[userId] = conversations[userId].slice(-20);
  try {
    const r = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: conversations[userId]
    });
    const msg = r.content[0].text;
    conversations[userId].push({ role: "assistant", content: msg });
    if (msg.includes("ESCALADE_REQUISE")) return null;
    return msg;
  } catch(e) {
    console.error("Erreur AI:", e.message);
    return null;
  }
}

app.get("/webhook/whatsapp", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN)
    return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req, res) => {
  res.sendStatus(200);
  try {
    const val = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!val?.messages?.length) return;
    const m = val.messages[0];
    const phoneNumberId = val.metadata.phone_number_id;
    const clientNumber = m.from;
    const text = m.type === "text" ? m.text.body : "[type:" + m.type + "]";
    const reply = await getAIResponse("wa_" + clientNumber, text);
    if (!reply) {
      await sendWhatsAppMessage(phoneNumberId, clientNumber,
        "Je transmets votre demande à notre équipe. M. Wassim vous contactera très prochainement. 🙏");
      await escalateToOwner(clientNumber, text, "WhatsApp");
    } else {
      await sendWhatsAppMessage(phoneNumberId, clientNumber, reply);
    }
  } catch(e) { console.error(e); }
});

app.get("/webhook/messenger", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN)
    return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook/messenger", async (req, res) => {
  res.sendStatus(200);
  try {
    for (const entry of req.body?.entry || []) {
      for (const ev of entry.messaging || []) {
        if (!ev.sender?.id || ev.message?.is_echo) continue;
        const senderId = ev.sender.id;
        const text = ev.message?.text || ev.postback?.payload || "[attachment]";
        const reply = await getAIResponse("fb_" + senderId, text);
        if (!reply) {
          await axios.post("https://graph.facebook.com/v19.0/me/messages",
            { recipient: { id: senderId }, message: { text: "Je transmets votre demande à notre équipe. M. Wassim vous contactera très prochainement. 🙏" }, messaging_type: "RESPONSE" },
            { params: { access_token: MESSENGER_TOKEN }, headers: { "Content-Type": "application/json" } });
          await escalateToOwner(senderId, text, "Messenger");
        } else {
          await axios.post("https://graph.facebook.com/v19.0/me/messages",
            { recipient: { id: senderId }, message: { text: reply }, messaging_type: "RESPONSE" },
            { params: { access_token: MESSENGER_TOKEN }, headers: { "Content-Type": "application/json" } });
        }
      }
    }
  } catch(e) { console.error(e); }
});

app.get("/", (req, res) => res.json({ status: "FARIA Agent en ligne", version: "2.0.0" }));
app.listen(PORT, () => console.log("FARIA Agent v2 sur le port " + PORT));
