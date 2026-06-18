/**
 * ============================================================
 *  NEER CONSTRUCTION LTD — WhatsApp AI Sales Bot
 *  Full Production Server
 * ============================================================
 *
 *  FEATURES:
 *    ✅ AI replies (Claude) with construction/engineering expertise
 *    ✅ Keyword instant replies (greetings, pricing, services, etc.)
 *    ✅ Order / project inquiry capture
 *    ✅ Appointment booking flow
 *    ✅ Pricing info auto-send
 *    ✅ Image & voice message handling
 *    ✅ SQLite database — leads, chats, bookings, orders
 *    ✅ Web dashboard — manage everything from browser
 *
 *  SETUP (run these commands on your server):
 *    npm install
 *    cp .env.example .env        ← fill in your keys
 *    node server.js
 *
 *  DASHBOARD:  http://your-server-ip:3000/dashboard
 *  WEBHOOK:    http://your-server-ip:3000/webhook
 * ============================================================
 */

const express  = require("express");
const axios    = require("axios");
const Database = require("better-sqlite3");
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

// ── Database Setup ────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, "neer_bot.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT UNIQUE NOT NULL,
    name       TEXT DEFAULT 'Unknown',
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
    msg_count  INTEGER DEFAULT 0,
    stage      TEXT DEFAULT 'new'   -- new | interested | quoted | booked | ordered
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    type       TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    name       TEXT,
    service    TEXT,
    date       TEXT,
    time       TEXT,
    notes      TEXT,
    status     TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    name       TEXT,
    service    TEXT,
    location   TEXT,
    budget     TEXT,
    details    TEXT,
    status     TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Prepared statements
const stmts = {
  upsertLead:  db.prepare(`INSERT INTO leads (phone) VALUES (?) ON CONFLICT(phone) DO UPDATE SET last_seen=CURRENT_TIMESTAMP, msg_count=msg_count+1`),
  updateStage: db.prepare(`UPDATE leads SET stage=? WHERE phone=?`),
  updateName:  db.prepare(`UPDATE leads SET name=? WHERE phone=?`),
  insertMsg:   db.prepare(`INSERT INTO messages (phone, role, content, type) VALUES (?, ?, ?, ?)`),
  getHistory:  db.prepare(`SELECT role, content FROM messages WHERE phone=? ORDER BY created_at DESC LIMIT 20`),
  insertBook:  db.prepare(`INSERT INTO bookings (phone, name, service, date, time, notes) VALUES (?,?,?,?,?,?)`),
  insertOrder: db.prepare(`INSERT INTO orders (phone, name, service, location, budget, details) VALUES (?,?,?,?,?,?)`),
  getLead:     db.prepare(`SELECT * FROM leads WHERE phone=?`),
};

// ── In-memory booking/order state machine per user ───────────────────────────
const userState = {}; // { phone: { flow: 'booking'|'order', step: 0, data: {} } }

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

  // Save answer (handle SKIP)
  state.data[currentStep.key] = text.toLowerCase() === "skip" ? "N/A" : text;
  state.step++;

  if (state.step < steps.length) {
    // Next question
    return steps[state.step].question;
  }

  // Flow complete — save to DB
  if (state.flow === "booking") {
    const d = state.data;
    stmts.insertBook.run(phone, d.name, d.service, d.date, d.time, d.notes);
    stmts.updateStage.run("booked", phone);
    stmts.updateName.run(d.name, phone);
    delete userState[phone];
    return `✅ *Consultation Booked Successfully!*\n\n📋 *Name:* ${d.name}\n🏗️ *Service:* ${d.service}\n📅 *Date:* ${d.date}\n🕐 *Time:* ${d.time}\n📝 *Notes:* ${d.notes}\n\nOur team will confirm your appointment shortly. Thank you for choosing *NEER CONSTRUCTION LTD*! 🏗️`;
  } else {
    const d = state.data;
    stmts.insertOrder.run(phone, d.name, d.service, d.location, d.budget, d.details);
    stmts.updateStage.run("ordered", phone);
    stmts.updateName.run(d.name, phone);
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

  // Track lead
  stmts.upsertLead.run(from);
  stmts.insertMsg.run(from, "user", text, type);

  let reply = "";

  try {
    // 1. Check if user is in a booking or order flow
    if (userState[from]) {
      reply = await handleFlow(from, text);
    }
    // 2. Check for BOOK / ORDER trigger words
    else if (/^book$/i.test(text)) {
      userState[from] = { flow: "booking", step: 0, data: {} };
      reply = BOOKING_STEPS[0].question;
    }
    else if (/^order$/i.test(text)) {
      userState[from] = { flow: "order", step: 0, data: {} };
      reply = ORDER_STEPS[0].question;
    }
    // 3. Check keyword shortcuts
    else {
      const kw = checkKeyword(text);
      if (kw) {
        reply = kw;
      } else {
        // 4. AI reply
        reply = await getAIReply(from, text);
      }
    }

    stmts.insertMsg.run(from, "assistant", reply, "text");
    await sendMsg(from, reply);
    console.log(`📤 Replied to ${from}`);

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
});

// ── Claude AI Reply ───────────────────────────────────────────────────────────
async function getAIReply(phone, userMessage) {
  const rows    = stmts.getHistory.all(phone).reverse();
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
  const leads    = db.prepare("SELECT COUNT(*) as c FROM leads").get().c;
  const bookings = db.prepare("SELECT COUNT(*) as c FROM bookings").get().c;
  const orders   = db.prepare("SELECT COUNT(*) as c FROM orders").get().c;
  const messages = db.prepare("SELECT COUNT(*) as c FROM messages").get().c;
  res.json({ leads, bookings, orders, messages });
});

app.get("/api/leads", (req, res) => {
  res.json(db.prepare("SELECT * FROM leads ORDER BY last_seen DESC LIMIT 100").all());
});

app.get("/api/bookings", (req, res) => {
  res.json(db.prepare("SELECT * FROM bookings ORDER BY created_at DESC").all());
});

app.get("/api/orders", (req, res) => {
  res.json(db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all());
});

app.get("/api/messages/:phone", (req, res) => {
  res.json(db.prepare("SELECT * FROM messages WHERE phone=? ORDER BY created_at ASC").all(req.params.phone));
});

app.patch("/api/bookings/:id", (req, res) => {
  const { status } = req.body;
  db.prepare("UPDATE bookings SET status=? WHERE id=?").run(status, req.params.id);
  res.json({ ok: true });
});

app.patch("/api/orders/:id", (req, res) => {
  const { status } = req.body;
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, req.params.id);
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
   🔗  Webhook:   http://your-server-ip:${PORT}/webhook
  ============================================
  `);
});
