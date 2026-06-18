# 🏗️ NEER CONSTRUCTION LTD — WhatsApp AI Bot

A complete WhatsApp sales bot with AI replies, booking system, project inquiry collection, and a web dashboard.

---

## 📁 Files in this package

```
neer-whatsapp-bot/
├── server.js          ← Main bot server
├── package.json       ← Dependencies
├── .env.example       ← Config template (copy to .env)
└── public/
    └── index.html     ← Web dashboard
```

---

## 🚀 Setup on Your Server (Step by Step)

### Step 1 — Upload files
Upload all files to your server in a folder, e.g. `/home/neer-bot/`

### Step 2 — Install Node.js (if not installed)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Step 3 — Install dependencies
```bash
cd /home/neer-bot
npm install
```

### Step 4 — Create your .env file
```bash
cp .env.example .env
nano .env
```
Fill in your 4 keys (see below for where to get them).

### Step 5 — Start the bot
```bash
node server.js
```

### Step 6 — Connect WhatsApp
In Meta Developer Console → WhatsApp → Configuration → Webhook:
- **Callback URL:** `http://YOUR-SERVER-IP:3000/webhook`
- **Verify Token:** `NeerBotSecret2024` (or whatever you put in .env)
- Subscribe to: **messages**

---

## 🔑 Where to Get Your Keys

| Key | Where to Get It |
|-----|----------------|
| `WHATSAPP_TOKEN` | [developers.facebook.com](https://developers.facebook.com) → App → WhatsApp → API Setup |
| `WHATSAPP_PHONE_ID` | Same page as above |
| `VERIFY_TOKEN` | Make up any word/phrase |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |

---

## 📊 Dashboard

Once running, open your browser:
```
http://YOUR-SERVER-IP:3000
```

You'll see:
- 📊 Live stats (leads, bookings, inquiries, messages)
- 👥 All WhatsApp leads
- 💬 Full chat history per contact
- 📅 Consultation bookings (with status management)
- 📋 Project inquiries (with status management)
- ⚙️ Setup guide

---

## 💬 Bot Commands

| Customer types | Bot does |
|----------------|----------|
| `BOOK` | Starts consultation booking (name → service → date → time) |
| `ORDER` | Starts project inquiry (service → location → budget → details) |
| `PRICING` or `PRICE` | Sends full pricing guide |
| `SERVICES` | Sends list of all services |
| `CONTACT` | Sends office contact details |
| `HOURS` | Sends business hours |
| `HI` / `HELLO` | Greeting |
| Anything else | Claude AI replies as "Maya" 🤖 |

---

## 🔄 Keep Bot Running (Optional — Recommended)

Install PM2 to keep the bot running even after you close the terminal:
```bash
npm install -g pm2
pm2 start server.js --name neer-bot
pm2 save
pm2 startup
```

---

## ✏️ Customizing the Bot

- **Change AI personality:** Edit `SYSTEM_PROMPT` in `server.js`
- **Add keywords:** Add to the `KEYWORDS` object in `server.js`
- **Change services/pricing:** Edit `SERVICES_INFO` and `PRICING_INFO` in `server.js`
- **Change bot name:** Replace "Maya" in `SYSTEM_PROMPT`
