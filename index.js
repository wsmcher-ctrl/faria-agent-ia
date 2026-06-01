const express = require("express");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
const app = express();
app.use(express.json());
const { VERIFY_TOKEN, WHATSAPP_TOKEN, MESSENGER_TOKEN, ANTHROPIC_API_KEY, PORT = 3000 } = process.env;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const conversations = {};
const SYSTEM_PROMPT = `Tu es l'assistant virtuel de FARIA Business Services, une entreprise de services professionnels en Algerie. Services: creation entreprise, accompagnement administratif, comptabilite, formation, marketing digital. Sois poli, professionnel et concis (max 3 paragraphes).`;

async function getAIResponse(userId, userMessage) {
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: "user", content: userMessage });
  if (conversations[userId].length > 20) conversations[userId] = conversations[userId].slice(-20);
  try {
    const r = await anthropic.messages.create({ model: "claude-sonnet-4-20250514", max_tokens: 1024, system: SYSTEM_PROMPT, messages: conversations[userId] });
    const msg = r.content[0].text;
    conversations[userId].push({ role: "assistant", content: msg });
    return msg;
  } catch(e) { return "Desole, erreur technique. Veuillez recontacter notre equipe."; }
}

app.get("/webhook/whatsapp", (req,res) => {
  if (req.query["hub.mode"]==="subscribe" && req.query["hub.verify_token"]===VERIFY_TOKEN)
    return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req,res) => {
  res.sendStatus(200);
  try {
    const val = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!val?.messages?.length) return;
    const m = val.messages[0];
    const text = m.type==="text" ? m.text.body : "[type:"+m.type+"]";
    const reply = await getAIResponse("wa_"+m.from, text);
    await axios.post("https://graph.facebook.com/v19.0/"+val.metadata.phone_number_id+"/messages",
      {messaging_product:"whatsapp",to:m.from,type:"text",text:{body:reply}},
      {headers:{Authorization:"Bearer "+WHATSAPP_TOKEN,"Content-Type":"application/json"}});
  } catch(e) { console.error(e); }
});

app.get("/webhook/messenger", (req,res) => {
  if (req.query["hub.mode"]==="subscribe" && req.query["hub.verify_token"]===VERIFY_TOKEN)
    return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

app.post("/webhook/messenger", async (req,res) => {
  res.sendStatus(200);
  try {
    for (const entry of req.body?.entry||[]) {
      for (const ev of entry.messaging||[]) {
        if (!ev.sender?.id || ev.message?.is_echo) continue;
        const text = ev.message?.text || ev.postback?.payload || "[attachment]";
        const reply = await getAIResponse("fb_"+ev.sender.id, text);
        await axios.post("https://graph.facebook.com/v19.0/me/messages",
          {recipient:{id:ev.sender.id},message:{text:reply},messaging_type:"RESPONSE"},
          {params:{access_token:MESSENGER_TOKEN},headers:{"Content-Type":"application/json"}});
      }
    }
  } catch(e) { console.error(e); }
});

app.get("/", (req,res) => res.json({status:"FARIA Agent en ligne",version:"1.0.0"}));
app.listen(PORT, () => console.log("FARIA Agent sur le port "+PORT));