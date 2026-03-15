# ROSALIA GROUP AI SYSTEM — MASTER GUIDE
## Last Updated: March 15, 2026

---

## 🌐 INFRASTRUCTURE

| Service | URL / Account | Purpose |
|---|---|---|
| Netlify | silver-ganache-1ee2ca.netlify.app | Hosts all functions & booking forms |
| GitHub | github.com/RosaliaGroup/Abrevo | Source code repo |
| Local | C:\Users\ana\OneDrive\Desktop\Abrevo-Clean | Local working folder |
| Supabase | fhkgpepkwibxbxsepetd.supabase.co | Lead database |

---

## 🔑 CREDENTIALS & KEYS

### Gmail
- User: inquiries@rosaliagroup.com
- App Password: yynglhtlkmoakini (env: GMAIL_PASS_INQUIRIES)

### Supabase
- URL: https://fhkgpepkwibxbxsepetd.supabase.co
- Service Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (env: SUPABASE_SERVICE_KEY)

### Vapi
- Private Key: 064f441d-a388-4404-8b6c-05e91e90f1ff (env: VAPI_KEY)
- Alex Assistant ID: 1cae5323-6b83-4434-8461-6330472da140
- Alex Phone: (862) 701-4607 | ID: 2e2b6713-f631-4e9e-95fa-3418ecc77c0a
- Jessica Outbound (Iron 65) Assistant ID: 35f4e4a2-aabc-47be-abfc-630cf6a85d58
- Jessica Inbound (Iron 65) Assistant ID: 3e439d0a-ab3e-4718-9b64-a6571e519d16
- Iron 65 Inbound Phone: (862) 333-1681 | ID: 8e91b213-7224-4246-b98c-07e5a384a7ca
- Iron Pointe (Ava) Phone: (862) 277-1673
- EmporionPros (Aria) Phone: (862) 419-1763

### Anthropic (Claude AI)
- Key: sk-ant-api03-Q4vmCwb... (env: ANTHROPIC_API_KEY)
- Org: Ana's Individual Org
- Balance: ~$15 (top up at console.anthropic.com)

### Textbelt (SMS)
- Key: 06aa74dcb12c73154e34300053413dd8479b0cddx35TUDd3zDznHUE2qiPma7cwr (env: TEXTBELT_KEY)
- Top up: textbelt.com

### Google Calendar
- Calendar ID: 4fcabed77eab22c25e9ff8440251d5836faaa66b7f8164b94134d439fab62398@group.calendar.google.com
- Service Account: abrevo-calendar@adroit-base-478202-j8.iam.gserviceaccount.com
- Credentials: GOOGLE_CREDENTIALS env var in Netlify

### Follow Up Boss (FUB)
- API Key: fka_0BintMy4p0REoWnt6504EBuAzvPkD7gi0h
- Account: User-level (not admin)

---

## 📋 NETLIFY FUNCTIONS (14 total)

### Scheduled Functions (run automatically)

#### readmail.js — Every 1 minute
**What it does:**
1. Connects to inquiries@rosaliagroup.com via IMAP
2. Reads unread emails from last 14 days (max 5 at a time)
3. Skips automated/internal senders
4. Detects lead emails from Zillow relay, Avail, Webflow forms, direct inquiries
5. Generates AI reply using Claude (with full property knowledge base)
6. Sends HTML email reply with clickable booking link
7. If lead has phone → triggers Alex outbound call via Vapi
8. Saves lead to Supabase
9. Sends notification email to inquiries@rosaliagroup.com

**Sources handled:**
- Direct email inquiries
- Zillow relay (convo.zillow.com)
- Avail lead notifications (reply.avail.co)
- Webflow/Resipointe form submissions

**Skip list:** noreply, automated, FUB notifications, internal rosaliagroup.com, mechanicalenterprise.com, etc.

---

#### autocall.js — Every 1 minute (business hours only)
**What it does:**
1. Checks business hours (M-F 9am-6pm, Sat 10am-5pm, Sun 11am-5pm ET)
2. Finds leads in Supabase with phone number but called_at = null
3. Routes to correct assistant:
   - client = 'iron65' → Jessica calls with Iron 65 booking form
   - all others → Alex calls with Rosalia booking form
4. Triggers Vapi outbound call
5. Sends SMS with booking link
6. Updates lead status to 'contacted'

---

#### fubsync.js — Every 1 minute
**What it does:**
1. Pulls leads from Follow Up Boss API
2. Saves new leads to Supabase tagged as client='iron65'
3. Deduplicates by email/phone
4. Sends notification email to inquiries@rosaliagroup.com for new leads

---

#### healthcheck.js — Every 30 minutes
**What it does:**
1. Checks Vapi credits (alerts if below $10)
2. Checks Textbelt SMS credits (alerts if below 100)
3. Checks Supabase connectivity
4. Checks Anthropic API status
5. Reports daily lead count
6. Sends email alert to inquiries@rosaliagroup.com if any issues

**Manual trigger:** curl https://silver-ganache-1ee2ca.netlify.app/.netlify/functions/healthcheck

---

### On-Demand Functions

#### book.js
Handles booking form submissions → creates Google Calendar event → sends confirmation SMS + email to lead → sends team notification

#### reschedule.js
Handles reschedule form submissions → updates Google Calendar event

#### bulkemail.js
One-time bulk emailer for past leads (manual trigger via curl POST)

#### cincwebhook.js
Receives CINC (real estate CRM) webhooks → saves leads to Supabase

#### parsefubemail.js
Parses forwarded FUB email notifications

#### lookup.js, outbound.js, followup.js
Supporting functions for lead management

---

## 📱 VAPI ASSISTANTS

| Assistant | Type | Phone | Handles |
|---|---|---|---|
| Iron 65 Inbound (Jessica) | Inbound | (862) 333-1681 | Calls to Iron 65 line |
| Rosalia Iron 65 Outbound | Outbound | (862) 333-1681 | FUB leads (Iron 65) |
| Rosalia Luxury Portfolio Outbound (Alex) | Outbound | (862) 701-4607 | All other leads |
| Iron Pointe — Ava | Inbound | (862) 277-1673 | Iron Pointe calls |
| Rosalia General Rentals Inbound | Inbound | (862) 419-1774 | General inbound |

**Alex Voice:** 11labs — Jessica (playful, bright, warm)
**Daily call limit:** None on (862) 701-4607 (Twilio-backed)

---

## 🏠 BOOKING FORMS

| Form | URL | Used by |
|---|---|---|
| booking-form | /booking-form | Iron 65 / Jessica |
| booking-rosalia | /booking-rosalia | All Rosalia / Alex / Email AI |
| reschedule-form | /reschedule-form | Iron 65 / Jessica |
| reschedule-rosalia | /reschedule-rosalia | All Rosalia / Alex |

**Properties in dropdown:**
- 486 Market St - River Pointe, Newark NJ
- 502 Market St, Newark NJ
- 39 Madison St - Iron Pointe, Newark NJ
- 556 Market St, Newark NJ
- 289 Halsey St, Newark NJ
- 77 Christie St, Newark NJ
- 1369 South Ave, Plainfield NJ
- 475 Main St - The Elks, Orange NJ
- 65 Mcwhorter St - Iron 65, Newark NJ
- Other (specify below)

---

## 📊 SUPABASE — LEADS TABLE

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | text | Lead name |
| email | text | Primary dedup key |
| phone | text | Format: +1XXXXXXXXXX |
| source | text | zillow/avail/webflow/fub/cinc/email |
| client | text | 'iron65' or 'rosalia' |
| message | text | Original inquiry |
| status | text | new/contacted |
| email_reply | text | Last AI reply sent |
| called_at | timestamptz | null = not called yet |
| replied_at | timestamptz | When email was sent |
| notes | text | Call notes / log |
| created_at | timestamptz | When lead was created |

---

## 🔄 COMPLETE LEAD FLOW

```
NEW LEAD ARRIVES
├── Via Email (Zillow/Avail/Webflow/Direct)
│   └── readmail.js picks up within 60 seconds
│       ├── AI generates reply using knowledge base
│       ├── Sends HTML email with booking link
│       ├── Saves to Supabase
│       └── If phone found → autocall picks up within 60 sec
│
├── Via FUB (Iron 65 leads)
│   └── fubsync.js picks up within 60 seconds
│       ├── Saves to Supabase (client='iron65')
│       └── Sends notification email to Ana
│
└── Via Booking Form
    └── book.js fires immediately
        ├── Creates Google Calendar event
        ├── Sends confirmation SMS + email to lead
        └── Sends team notification SMS + email

LEAD HAS PHONE NUMBER
└── autocall.js detects within 60 seconds (business hours)
    ├── iron65 lead → Jessica calls with Iron 65 booking form
    └── other lead → Alex calls with Rosalia booking form
        ├── Alex qualifies: area, bedrooms, budget, move-in
        ├── Sends booking link SMS
        └── Books tour if link not received
```

---

## 📚 KNOWLEDGE BASE

File: knowledge-base.txt (in repo root)
**Update it directly on GitHub when:**
- Prices change
- Units become available or rented
- New promotions added
- New properties added

URL: github.com/RosaliaGroup/Abrevo/edit/main/knowledge-base.txt

**The AI email assistant uses this file to answer lead questions about:**
- Unit availability and pricing
- Building amenities
- Utilities (what's included)
- Pet policies
- Parking
- Credit/income requirements
- Promotions and incentives

---

## ⚠️ MONITORING & ALERTS

### Healthcheck emails (every 30 min to inquiries@rosaliagroup.com)
- ⚠️ Vapi credits below $10 → top up at dashboard.vapi.ai
- ⚠️ Textbelt below 100 credits → top up at textbelt.com
- ❌ Supabase down → check supabase.com
- ❌ Anthropic API error → check console.anthropic.com

### Manual health check
```
curl https://silver-ganache-1ee2ca.netlify.app/.netlify/functions/healthcheck
```

### Netlify function logs
Netlify → Logs & metrics → Functions → [function name]

---

## 🚨 COMMON ISSUES & FIXES

### Readmail not processing emails
1. Check Netlify logs → readmail
2. Common cause: BOM encoding issue
3. Fix: redeploy with fix-readmail-bom.ps1

### netlify.toml BOM error (build fails)
Run: fix-netlify-v2.ps1 → git add → commit → push
Or trigger clear cache deploy in Netlify

### Alex not calling leads
1. Check business hours (M-F 9-6, Sat 10-5, Sun 11-5 ET)
2. Check Vapi credits
3. Check VAPI_PHONE_ID env var = 2e2b6713-f631-4e9e-95fa-3418ecc77c0a

### Booking form not saving to calendar
Check Google Calendar service account credentials in GOOGLE_CREDENTIALS env var

### Git push blocked (secret scanning)
Run: git reset HEAD~1 → remove secret → recommit

---

## 📅 DAILY OPERATIONS

**Every morning (9 AM ET):**
- Alex starts calling uncalled leads automatically
- Check inquiries@rosaliagroup.com for health reports and new lead notifications

**When updating knowledge base:**
1. Go to github.com/RosaliaGroup/Abrevo/edit/main/knowledge-base.txt
2. Update prices, units, promotions
3. Click Commit changes
4. Done — AI picks up changes immediately

**When deploying code changes:**
```
cd C:\Users\ana\OneDrive\Desktop\Abrevo-Clean
[run patch script]
git add -f [file]
git commit -m "Description"
git push
```

---

## 💳 SERVICES TO MONITOR & TOP UP

| Service | Where to top up | Alert threshold |
|---|---|---|
| Vapi | dashboard.vapi.ai → Billing | Below $10 |
| Textbelt | textbelt.com | Below 100 credits |
| Anthropic | console.anthropic.com | Below $5 |
| Netlify | app.netlify.com → Billing | Function execution limits |

---

*This guide covers the complete Rosalia Group AI automation system as of March 15, 2026.*
*For questions or issues, review Netlify function logs first.*
