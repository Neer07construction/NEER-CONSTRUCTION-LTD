/**
 * ============================================================
 *  NEER CONSTRUCTION LTD — WhatsApp AI Sales Bot
 *  Full Production Server (Render-compatible, no native deps)
 * ============================================================
 *
 *  FEATURES:
 *    ✅ AI replies (Claude) with construction/engineering expertise
 *    ✅ Keyword instant replies (greetings, pricing, services, etc.)
 *    ✅ Order / project inquiry capture
 *    ✅ Appointment booking flow
 *    ✅ Pricing info auto-send
 *    ✅ Image & voice message handling
 *    ✅ JSON file database — leads, chats, bookings, orders (no compiling needed)
 *    ✅ Web dashboard — manage everything from browser
 *
 *  SETUP:
 *    npm install
 *    cp .env.example .env        ← fill in your keys
 *    node server.js
 * ============================================================
 */

const express  = require("express");
const axios    = require("axios");
const fs       = require("fs");
const path     = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ── Environment Config ────────────────────────────────────────────────────────
const {
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  VERIFY_TOKEN,
  ANTHROPIC_API_KEY,
  PORT = 3000,
} = process.env;

// ── Simple JSON File Database (no native compilation needed) ────────────────
const DB_FILE = path.join(__dirname, "data.json");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { leads: [], messages: [], bookings: [], orders: [], nextId: 1 };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return { leads: [], messages: [], bookings: [], orders: [], nextId: 1 };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nextId(db) {
  const id = db.nextId || 1;
  db.nextId = id + 1;
  return id;
}

// ── DB Helper Functions ───────────────────────────────────────────────────────
function upsertLead(phone) {
  const db = loadDB();
  let lead = db.leads.find(l => l.phone === phone);
  const now = new Date().toISOString();
  if (lead) {
    lead.last_seen = now;
    lead.msg_count = (lead.msg_count || 0) + 1;
  } else {
    lead = { id: nextId(db), phone, name: "Unknown", first_seen: now, last_seen: now, msg_count: 1, stage: "new" };
    db.leads.push(lead);
  }
  saveDB(db);
}

function updateLeadStage(phone, stage) {
  const db = loadDB();
  const lead = db.leads.find(l => l.phone === phone);
  if (lead) { lead.stage = stage; saveDB(db); }
}

function updateLeadName(phone, name) {
  const db = loadDB();
  const lead = db.leads.find(l => l.phone === phone);
  if (lead) { lead.name = name; saveDB(db); }
}

function insertMsg(phone, role, content, type = "text") {
  const db = loadDB();
  db.messages.push({ id: nextId(db), phone, role, content, type, created_at: new Date().toISOString() });
  saveDB(db);
}

function getHistory(phone, limit = 20) {
  const db = loadDB();
  return db.messages
    .filter(m => m.phone === phone)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-limit);
}

function insertBooking(phone, name, service, date, time, notes) {
  const db = loadDB();
  db.bookings.push({ id: nextId(db), phone, name, service, date, time, notes, status: "pending", created_at: new Date().toISOString() });
  saveDB(db);
}

function insertOrder(phone, name, service, location, budget, details) {
  const db = loadDB();
  db.orders.push({ id: nextId(db), phone, name, service, location, budget, details, status: "new", created_at: new Date().toISOString() });
  saveDB(db);
}

// ── In-memory booking/order state machine per user (resets on restart, that's fine) ──
const userState = {};

// ── Neer Construction System Prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `You are Maya, the professional AI assistant for NEER CONSTRUCTION LTD — a trusted construction and engineering services company.

YOUR ROLE:
- Help clients understand our construction and engineering services
- Qualify project leads by learning their needs, location, budget, and timeline
- Encourage clients to book a consultation or submit a project inquiry
- Answer questions about construction, engineering, materials, and project management professionally

OUR SERVICES INCLUDE:
- Residential construction (houses, apartments, renovations)
- Commercial construction (offices, warehouses, retail)
- Civil engineering (roads, drainage, foundations)
- Structural engineering and design
- Project management and consultation
- Quantity surveying and cost estimation

YOUR PERSONALITY:
- Professional, knowledgeable, and trustworthy
- Concise replies (2-4 sentences), warm but expert tone
- Use light emojis occasionally (🏗️ ✅ 📐 🔨) to feel approachable
- Ask one question at a time to learn the client's needs
- Never invent specific prices — direct to our pricing guide or consultation

IMPORTANT RULES:
- Never say you are an AI unless directly asked
- If asked about pricing, explain pricing depends on scope and offer to collect project details
- Always try to move the conversation toward booking a consultation or submitting a project
- If a client seems ready, say: "I can set up a consultation for you right now! Just type BOOK to get started 😊"
- If they want to submit a project inquiry, say: "Great! Type ORDER to submit your project details 📋"`;

// ── Services & Pricing Info ───────────────────────────────────────────────────
const PRICING_INFO = `🏗️ *NEER CONSTRUCTION LTD — Services & Pricing Guide*

Our pricing is project-based and depends on scope, location, and materials. Here's a general overview:

📐 *Residential Construction*
- Small house (up to 100m²): From $25,000
- Medium house (100–250m²): From $50,000
- Renovations & Extensions: From $8,000

🏢 *Commercial Construction*
- Office fit-outs: From $15,000
- Warehouses & Industrial: Custom quote
- Retail spaces: From $12,000

🔧 *Engineering Services*
- Structural design & drawings: From $1,500
- Site assessment & survey: From $800
- Project management: 8–12% of project cost
- Quantity surveying: From $500

📞 *All prices are estimates. Contact us for a FREE detailed quote!*
Type BOOK to schedule a free consultation 😊`;

const SERVICES_INFO = `🏗️ *NEER CONSTRUCTION LTD — Our Services*

✅ *Residential Construction*
Houses, apartments, extensions & renovations

✅ *Commercial Construction*
Offices, warehouses, retail & industrial buildings

✅ *Civil Engineering*
Roads, drainage systems, foundations & earthworks

✅ *Structural Engineering*
Structural design, analysis & technical drawings

✅ *Project Management*
End-to-end project supervision & coordination

✅ *Quantity Surveying*
Cost estimation, BOQ preparation & budget management

✅ *Consultation*
Site visits, feasibility studies & expert advice

Type BOOK for a free consultation 📐
Type ORDER to submit a project inquiry 📋
Type PRICING for our rate guide 💰`;

// ── Keyword Auto-Replies ──────────────────────────────────────────────────────
const KEYWORDS = {
  hello:       `👋 Hello! Welcome to *NEER CONSTRUCTION LTD*. I'm Maya, your project assistant.\n\nHow can I help you today? Whether it's a new build, renovation, or engineering query — I'm here! 🏗️`,
  hi:          `👋 Hi there! Welcome to *NEER CONSTRUCTION LTD*. I'm Maya.\n\nAre you looking to start a construction or engineering project? I'd love to help! 😊`,
  hola:        `👋 Hello! Bienvenido a *NEER CONSTRUCTION LTD*. I'm Maya, your assistant. How can I help?`,
  services:    SERVICES_INFO,
  service:     SERVICES_INFO,
  pricing:     PRICING_INFO,
  price:       PRICING_INFO,
  prices:      PRICING_INFO,
  quote:       `📋 We'd love to give you a quote! To get started, please type *ORDER* and I'll collect your project details, or type *BOOK* to schedule a free consultation call 😊`,
  hours:       `🕐 *NEER CONSTRUCTION LTD* office hours:\nMonday – Friday: 8:00 AM – 5:00 PM\nSaturday: 9:00 AM – 1:00 PM\nSunday: Closed\n\nYou can message us anytime and we'll respond during business hours! ✅`,
  contact:     `📞 *Contact NEER CONSTRUCTION LTD:*\n\n📱 WhatsApp: This number!\n📧 Email: info@neerconstruction.com\n🌐 Website: www.neerconstruction.com\n📍 Office: [Your Address Here]\n\nType BOOK to schedule a consultation 😊`,
  location:    `📍 We operate across the region and can travel to your project site.\n\nType BOOK to arrange a site visit or consultation! 🏗️`,
  bye:         `👋 Thank you for contacting *NEER CONSTRUCTION LTD*! Have a great day. Feel free to message us anytime 😊`,
  thanks:      `😊 You're welcome! Is there anything else I can help you with? We're here whenever you need us.`,
  stop:        `✅ You've been unsubscribed from updates. Reply START anytime to resume. Have a great day!`,
  start:       `👋 Welcome back! I'm Maya from *NEER CONSTRUCTION LTD*. How can I help you today? 🏗️`,
};

function checkKeyword(text) {
  const lower = text.toLowerCase().trim();
  for (const [kw, reply] of Object.entries(KEYWORDS)) {
    if (lower === kw || lower.startsWith(kw + " ") || lower.includes(" " + kw)) {
      return reply;
    }
  }
  return null;
}

// ── Booking Flow ──────────────────────────────────────────────────────────────
const BOOKING_STEPS = [
  { key: "name",    question: "📋 Great! Let's book your free consultation.\n\nFirst, what's your *full name*?" },
  { key: "service", question: "🏗️ What *type of service* are you interested in?\n\n(e.g. Residential Construction, Commercial Build, Engineering, Renovation, Consultation)" },
  { key: "date",    question: "📅 What *date* works best for you? (e.g. Monday 23 June, or next week)" },
  { key: "time",    question: "🕐 What *time* works for you? (e.g. 9am, 2pm)" },
  { key: "notes",   question: "📝 Any *additional notes* about your project or what to discuss? (or type SKIP)" },
];

const ORDER_STEPS = [
  { key: "name",     question: "📋 Let's collect your project details!\n\nWhat's your *full name*?" },
  { key: "service",  question: "🏗️ What *type of construction or engineering service* do you need?\n\n(e.g. Build a house, Office renovation, Road construction, Structural design)" },
  { key: "location", question: "📍 Where is the *project located*? (city or area)" },
  { key: "budget",   question: "💰 Do you have a *budget range* in mind?\n\n(e.g. $10,000–$20,000, or type UNSURE if you need guidance)" },
  { key: "details",  question: "📝 Please share any *extra details* about your project — size, timeline, special requirements, etc. (or type SKIP)" },
];

async function handleFlow(phone, text) {
  const state = userState[phone];
  if (!state) return null;

  const steps = state.flow === "booking" ? BOOKING_STEPS : ORDER_STEPS;
  const currentStep = steps[state.step];

  state.data[currentStep.key] = text.toLowerCase() === "skip" ? "N/A" : text;
  state.step++;

  if (state.step < steps.length) {
    return steps[state.step].question;
  }

  if (state.flow === "booking") {
    const d = state.data;
    insertBooking(phone, d.name, d.service, d.date, d.time, d.notes);
    updateLeadStage(phone, "booked");
    updateLeadName(phone, d.name);
    delete userState[phone];
    return `✅ *Consultation Booked Successfully!*\n\n📋 *Name:* ${d.name}\n🏗️ *Service:* ${d.service}\n📅 *Date:* ${d.date}\n🕐 *Time:* ${d.time}\n📝 *Notes:* ${d.notes}\n\nOur team will confirm your appointment shortly. Thank you for choosing *NEER CONSTRUCTION LTD*! 🏗️`;
  } else {
    const d = state.data;
    insertOrder(phone, d.name, d.service, d.location, d.budget, d.details);
    updateLeadStage(phone, "ordered");
    updateLeadName(phone, d.name);
    delete userState[phone];
    return `✅ *Project Inquiry Submitted!*\n\n📋 *Name:* ${d.name}\n🏗️ *Service:* ${d.service}\n📍 *Location:* ${d.location}\n💰 *Budget:* ${d.budget}\n📝 *Details:* ${d.details}\n\nOur team will review your inquiry and get back to you within 24 hours with a tailored proposal. Thank you for choosing *NEER CONSTRUCTION LTD*! 🏗️`;
  }
}

// ── Webhook Verification ──────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Receive WhatsApp Messages ─────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // always acknowledge immediately

  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return;

  const from = message.from;
  const type = message.type;
  let text = "";

  if (type === "text") {
    text = message.text.body.trim();
  } else if (type === "image") {
    text = message.image?.caption
      ? `[Customer sent a photo with caption: "${message.image.caption}"]`
      : "[Customer sent a site photo or image]";
  } else if (type === "audio") {
    text = "[Customer sent a voice note]";
  } else if (type === "video") {
    text = "[Customer sent a video]";
  } else if (type === "document") {
    text = "[Customer sent a document or file]";
  } else {
    await sendMsg(from, "Thanks for reaching out! 😊 Please send a text message and I'll help you right away.");
    return;
  }

  console.log(`📩 [${type}] from ${from}: ${text}`);

  upsertLead(from);
  insertMsg(from, "user", text, type);

  let reply = "";

  try {
    if (userState[from]) {
      reply = await handleFlow(from, text);
    }
    else if (/^book$/i.test(text)) {
      userState[from] = { flow: "booking", step: 0, data: {} };
      reply = BOOKING_STEPS[0].question;
    }
    else if (/^order$/i.test(text)) {
      userState[from] = { flow: "order", step: 0, data: {} };
      reply = ORDER_STEPS[0].question;
    }
    else {
      const kw = checkKeyword(text);
      if (kw) {
        reply = kw;
      } else {
        reply = await getAIReply(from, text);
      }
    }

    insertMsg(from, "assistant", reply, "text");
    await sendMsg(from, reply);
    console.log(`📤 Replied to ${from}`);

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
});

// ── Claude AI Reply ───────────────────────────────────────────────────────────
async function getAIReply(phone, userMessage) {
  const rows    = getHistory(phone);
  const history = rows.map(r => ({ role: r.role, content: r.content }));
  history.push({ role: "user", content: userMessage });

  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-6",
      max_tokens: 350,
      system: SYSTEM_PROMPT,
      messages: history,
    },
    {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    }
  );

  return res.data.content[0].text;
}

// ── Send WhatsApp Message ─────────────────────────────────────────────────────
async function sendMsg(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`,
    { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ── Dashboard API endpoints ───────────────────────────────────────────────────
app.get("/api/stats", (req, res) => {
  const db = loadDB();
  res.json({
    leads: db.leads.length,
    bookings: db.bookings.length,
    orders: db.orders.length,
    messages: db.messages.length,
  });
});

app.get("/api/leads", (req, res) => {
  const db = loadDB();
  res.json([...db.leads].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen)));
});

app.get("/api/bookings", (req, res) => {
  const db = loadDB();
  res.json([...db.bookings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.get("/api/orders", (req, res) => {
  const db = loadDB();
  res.json([...db.orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.get("/api/messages/:phone", (req, res) => {
  const db = loadDB();
  res.json(db.messages
    .filter(m => m.phone === req.params.phone)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
});

app.patch("/api/bookings/:id", (req, res) => {
  const db = loadDB();
  const b = db.bookings.find(x => x.id === parseInt(req.params.id));
  if (b) { b.status = req.body.status; saveDB(db); }
  res.json({ ok: true });
});

app.patch("/api/orders/:id", (req, res) => {
  const db = loadDB();
  const o = db.orders.find(x => x.id === parseInt(req.params.id));
  if (o) { o.status = req.body.status; saveDB(db); }
  res.json({ ok: true });
});

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ============================================
   🏗️  NEER CONSTRUCTION LTD — WhatsApp Bot
  ============================================
   ✅  Server running on port ${PORT}
   📊  Dashboard: http://localhost:${PORT}
  ============================================
  `);
});
