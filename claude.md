# CLAUDE.md — Real Estate Lead Intelligence & Automation System

## Project Overview
Build a real estate lead generation automation system for 100+ leads/day.
Uses entirely free services. Captures leads from all 4 major Indian property portals,
qualifies them via WhatsApp, and routes hot leads to agent instantly.

## Free Tech Stack
- **WhatsApp**: Meta WhatsApp Cloud API (free)
- **AI**: Groq API with Llama 3 (free)
- **Database**: Supabase PostgreSQL (free tier)
- **Lead Dashboard**: Google Sheets (free)
- **Calendar**: Google Calendar API (free)
- **Hosting**: Render.com (free tier)
- **Portals**: 99acres, MagicBricks, Housing.com, CommonFloor

---

## Agent Behavior Rules
- Always confirm destructive actions before executing
- Log every action with timestamps to `logs/system.log`
- On failure, retry once then log error and continue
- Never hardcode API keys — use `.env` exclusively
- Prefer async/await patterns for all API calls
- Use TypeScript for all new files unless instructed otherwise
- Handle 100+ concurrent leads without data loss using Supabase transactions
- Batch Google Sheets writes (max 1 write per 5 seconds to avoid API limits)

---

## Phase 1 — Project Scaffold

Create the following directory structure:

```
realestate-leads/
├── src/
│   ├── capture/          # Lead ingestion from all 4 portals
│   ├── whatsapp/         # WhatsApp Cloud API engine
│   ├── qualification/    # Scoring and classification logic
│   ├── sheets/           # Google Sheets sync (lead dashboard)
│   ├── calendar/         # Google Calendar auto-scheduling
│   ├── nurture/          # Drip campaign engine
│   ├── analytics/        # Metrics and reporting
│   └── utils/            # Shared helpers, logger, validators
├── config/
│   ├── scoring.config.ts # Qualification matrix thresholds
│   └── portals.config.ts # All 4 portal webhook configs
├── webhooks/             # Incoming webhook handlers
├── tests/                # Unit + integration tests
├── logs/                 # Runtime logs (gitignored)
├── .env.example          # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

**Commands to run:**
```bash
mkdir -p realestate-leads/{src/{capture,whatsapp,qualification,sheets,calendar,nurture,analytics,utils},config,webhooks,tests,logs}
cd realestate-leads
npm init -y
npm install typescript ts-node axios dotenv zod winston dayjs node-cron @supabase/supabase-js googleapis groq-sdk express express-rate-limit
npm install -D @types/node @types/express jest ts-jest
npx tsc --init
```

---

## Phase 2 — Environment Configuration

Create `.env.example`:

```env
# ─── WhatsApp Cloud API (Meta - Free) ───────────────────────
WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# ─── Property Portals ────────────────────────────────────────
NINETYNINE_ACRES_WEBHOOK_SECRET=
MAGICBRICKS_WEBHOOK_SECRET=
HOUSING_COM_WEBHOOK_SECRET=
COMMONFLOOR_WEBHOOK_SECRET=

# ─── AI - Groq (Free) ────────────────────────────────────────
GROQ_API_KEY=
GROQ_MODEL=llama3-8b-8192

# ─── Database - Supabase (Free) ──────────────────────────────
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# ─── Google (Free) ───────────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_SHEET_ID=
GOOGLE_CALENDAR_ID=

# ─── Agent Config ────────────────────────────────────────────
AGENT_NAME=
AGENT_PHONE=
AGENT_EMAIL=
BACKUP_AGENT_PHONE=
AGENT_TIMEZONE=Asia/Kolkata

# ─── Scoring Thresholds ──────────────────────────────────────
HOT_LEAD_THRESHOLD=70
WARM_LEAD_THRESHOLD=40
RESPONSE_WINDOW_MINUTES=2
HOT_LEAD_CALL_WINDOW_HOURS=2
WARM_LEAD_FOLLOWUP_HOURS=48

# ─── Performance (for 100+ leads/day) ────────────────────────
SHEETS_WRITE_BATCH_INTERVAL_MS=5000
MAX_CONCURRENT_WHATSAPP_MESSAGES=10

# ─── Compliance ──────────────────────────────────────────────
DND_SCRUB_ENABLED=true
```

---

## Phase 3 — Supabase Database Setup

Create `src/utils/database.ts`.

First create these tables in Supabase SQL editor:

```sql
-- Leads table
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT CHECK (source IN ('99acres','magicbricks','housing','commonfloor','manual')),
  listing_id TEXT,
  property_type TEXT CHECK (property_type IN ('Plot','Apartment','Villa','Commercial')),
  location_preference TEXT,
  budget_min BIGINT,
  budget_max BIGINT,
  timeline TEXT,
  investment_intent TEXT,
  score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'New',
  assigned_agent TEXT,
  is_duplicate BOOLEAN DEFAULT false,
  is_opted_out BOOLEAN DEFAULT false,
  is_dnd BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_contacted_at TIMESTAMPTZ
);

-- Messages table
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  direction TEXT CHECK (direction IN ('inbound','outbound')),
  content TEXT,
  channel TEXT CHECK (channel IN ('whatsapp','sms','email')),
  status TEXT DEFAULT 'sent',
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups at 100+ leads/day
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_score ON leads(score);
```

---

## Phase 4 — Lead Data Model

Create `src/utils/lead.model.ts`:

```typescript
export type LeadSource = '99acres' | 'magicbricks' | 'housing' | 'commonfloor' | 'manual';
export type PropertyType = 'Plot' | 'Apartment' | 'Villa' | 'Commercial';
export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Hot' | 'Warm' | 'Cold' | 'Converted' | 'Lost';
export type Timeline = 'Immediate' | '1-3 months' | '3-6 months' | '6+ months' | 'Browsing';
export type InvestmentIntent = 'Self-use' | 'Investment' | 'Both' | 'Unclear';

export interface Lead {
  id: string;
  name: string;
  phone: string;                     // E.164 format: +91XXXXXXXXXX
  email?: string;
  source: LeadSource;
  listingId?: string;
  propertyType: PropertyType;
  locationPreference: string;
  budgetMin?: number;                // INR
  budgetMax?: number;                // INR
  timeline: Timeline;
  investmentIntent: InvestmentIntent;
  score: number;                     // 0-100
  status: LeadStatus;
  assignedAgent?: string;
  createdAt: Date;
  updatedAt: Date;
  lastContactedAt?: Date;
  tags: string[];
  isDuplicate: boolean;
  isOptedOut: boolean;
  isDND: boolean;
}
```

---

## Phase 5 — Portal Webhook Normalizer

Create `src/capture/portalNormalizer.ts`.

Each portal sends data in a different format.
Normalize all 4 into the standard Lead model:

```typescript
export function normalize99Acres(payload: any): Partial<Lead>
export function normalizeMagicBricks(payload: any): Partial<Lead>
export function normalizeHousing(payload: any): Partial<Lead>
export function normalizeCommonFloor(payload: any): Partial<Lead>

// Master function — auto-detects source and routes
export function normalizeLead(source: LeadSource, payload: any): Partial<Lead>
```

All phone numbers must be converted to E.164 (+91XXXXXXXXXX).
Strip spaces, dashes, and duplicate country codes.

---

## Phase 6 — Qualification Scoring Engine

Create `src/qualification/scorer.ts`:

```typescript
import { Lead } from '../utils/lead.model';

interface ScoreBreakdown {
  timeline: number;
  budgetClarity: number;
  investmentIntent: number;
  urgencySignals: number;
  total: number;
  classification: 'Hot' | 'Warm' | 'Cold';
}

export function scoreLead(lead: Lead): ScoreBreakdown {
  let timeline = 0;
  let budgetClarity = 0;
  let investmentIntent = 0;
  let urgencySignals = 0;

  switch (lead.timeline) {
    case 'Immediate':    timeline = 30;  break;
    case '1-3 months':  timeline = 20;  break;
    case '3-6 months':  timeline = 5;   break;
    case '6+ months':   timeline = -10; break;
    case 'Browsing':    timeline = -10; break;
  }

  if (lead.budgetMin && lead.budgetMax) {
    budgetClarity = lead.budgetMax >= 5000000 ? 25 : 15;
  } else if (lead.budgetMin || lead.budgetMax) {
    budgetClarity = 5;
  } else {
    budgetClarity = -15;
  }

  switch (lead.investmentIntent) {
    case 'Self-use':   investmentIntent = 20;  break;
    case 'Investment': investmentIntent = 25;  break;
    case 'Both':       investmentIntent = 25;  break;
    case 'Unclear':    investmentIntent = -20; break;
  }

  const urgencyTags = ['loan-approved', 'site-visited', 'ready-downpayment'];
  const coldTags = ['first-inquiry', 'no-research'];
  if (lead.tags.some(t => urgencyTags.includes(t))) urgencySignals = 20;
  else if (lead.tags.some(t => coldTags.includes(t))) urgencySignals = -10;

  const total = Math.max(0, Math.min(100,
    timeline + budgetClarity + investmentIntent + urgencySignals
  ));

  const hotThreshold = Number(process.env.HOT_LEAD_THRESHOLD ?? 70);
  const warmThreshold = Number(process.env.WARM_LEAD_THRESHOLD ?? 40);

  const classification =
    total >= hotThreshold ? 'Hot' :
    total >= warmThreshold ? 'Warm' : 'Cold';

  return { timeline, budgetClarity, investmentIntent, urgencySignals, total, classification };
}
```

---

## Phase 7 — Groq AI Intent Classifier

Create `src/qualification/intentClassifier.ts`:

```typescript
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function classifyIntent(message: string): Promise<{
  timeline?: string;
  budget?: { min: number; max: number };
  investmentIntent?: string;
  urgencySignals?: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}> {
  const response = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL ?? 'llama3-8b-8192',
    messages: [
      {
        role: 'system',
        content: `You are a real estate lead qualification AI for the Indian property market.
Extract buying intent from WhatsApp messages. Respond in valid JSON only. No explanation.
JSON format:
{
  "timeline": "Immediate|1-3 months|3-6 months|6+ months|Browsing",
  "budget": { "min": number_in_INR, "max": number_in_INR },
  "investmentIntent": "Self-use|Investment|Both|Unclear",
  "urgencySignals": ["loan-approved"|"site-visited"|"ready-downpayment"|"first-inquiry"|"no-research"],
  "sentiment": "positive|neutral|negative"
}`
      },
      { role: 'user', content: message }
    ],
    max_tokens: 200,
    temperature: 0.1
  });

  try {
    return JSON.parse(response.choices[0].message.content ?? '{}');
  } catch {
    return { sentiment: 'neutral' };
  }
}
```

---

## Phase 8 — WhatsApp Automation Engine

Create `src/whatsapp/engine.ts`:

```typescript
// 8.1 Send initial message within 2 minutes of lead capture
export async function sendInitialMessage(lead: Lead): Promise<void>
// POST to https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
// "Hi {name}, thanks for your interest in {propertyType} at {location}.
//  I'm {AGENT_NAME}'s assistant. Quick questions:
//  1. Buying for investment or self-use?
//  2. Budget range? (₹X - ₹Y lakhs)
//  3. Timeline? (Immediate / 3-6 months / Later)
//  4. Visited any sites in {area} recently?"

// 8.2 Process inbound reply
export async function processInboundMessage(phone: string, message: string): Promise<void>
// 1. Find lead by phone in Supabase
// 2. Save message to messages table
// 3. Run classifyIntent() via Groq
// 4. Update lead fields from result
// 5. Re-run scoreLead()
// 6. If Hot → trigger hotLeadHandler()
// 7. If Cold → start drip campaign
// 8. Sync to Google Sheets

// 8.3 Schedule follow-ups
export async function scheduleFollowUps(leadId: string): Promise<void>
// 4 hours no reply → send brochure
// 24 hours no reply → mark Cold + start drip
// Use node-cron

// 8.4 Handle opt-out
export async function handleOptOut(phone: string): Promise<void>
// STOP keyword → isOptedOut = true → never message again
```

---

## Phase 9 — Hot Lead Execution Protocol

Create `src/qualification/hotLeadHandler.ts`.
Triggers when score >= HOT_LEAD_THRESHOLD (70):

```typescript
export async function handleHotLead(lead: Lead): Promise<void> {
  // 1. WhatsApp alert to agent:
  //    "🔥 HOT LEAD: {name} | {phone} | ₹{min}-{max}L | {propertyType} at {location}"

  // 2. Google Calendar event:
  //    Title: "HOT LEAD CALL: {name} — ₹{budget}"
  //    Time: Next 30-min slot within 2 hours
  //    Notes: Full lead profile + conversation

  // 3. WhatsApp to lead:
  //    "{name}, {AGENT_NAME} will call you within the hour.
  //     Reference: #{leadId}"

  // 4. Supabase update:
  //    status = 'Hot', assignedAgent = AGENT_NAME

  // 5. Google Sheets:
  //    Highlight row red, update status column
}
```

---

## Phase 10 — Google Sheets Sync

Create `src/sheets/sheetsSync.ts`.

Sheet columns:
```
A: ID | B: Name | C: Phone | D: Source | E: Property Type
F: Location | G: Budget Min | H: Budget Max | I: Timeline
J: Intent | K: Score | L: Status | M: Agent | N: Created At
O: Last Contacted | P: Tags
```

```typescript
export async function appendLeadToSheet(lead: Lead): Promise<void>
export async function updateLeadInSheet(lead: Lead): Promise<void>

// CRITICAL for 100+ leads/day — batch all writes
export async function syncBatch(leads: Lead[]): Promise<void>
// Runs every SHEETS_WRITE_BATCH_INTERVAL_MS (5000ms)
// Prevents hitting Google Sheets API rate limits
```

---

## Phase 11 — Cold Lead Drip Campaign

Create `src/nurture/dripCampaign.ts`:

```typescript
const DRIP_SCHEDULE = [
  { day: 1,  type: 'market_report',   message: 'Hi {name}, latest market update for {location}: prices moved {trend} this month. Reply to know more.' },
  { day: 3,  type: 'new_listings',    message: 'Hi {name}, new {propertyType} listings in {location} matching your budget just added. Want details?' },
  { day: 7,  type: 'price_trends',    message: 'Hi {name}, {area} price trend this week: {trend}. Good time to buy? Reply YES for full report.' },
  { day: 14, type: 'buyer_guide',     message: "Hi {name}, first-time buyer? Here's a quick guide to buying in {city}. Want me to send it?" },
  { day: 30, type: 'requalification', message: 'Hi {name}, still looking for {propertyType} in {location}? What is your current budget?' },
];

// On any reply → re-run classifyIntent → re-score → upgrade if warranted
```

---

## Phase 12 — Edge Case Handlers

Create `src/utils/edgeCases.ts`:

```typescript
export async function handleInvalidPhone(lead: Partial<Lead>): Promise<void>
// Flag in Supabase, alert agent, skip WhatsApp

export async function scheduleCallbackRequest(lead: Lead, time: string): Promise<void>
// Google Calendar event at requested time + WhatsApp confirmation

export async function handleBudgetMismatch(lead: Lead): Promise<void>
// Suggest alternative locations, downgrade score by 15, keep Warm

export async function mergeDuplicateLead(existing: Lead, incoming: Partial<Lead>): Promise<void>
// Keep existing, update with new info, mark incoming duplicate, notify agent

export async function reassignToBackupAgent(lead: Lead): Promise<void>
// Assign to BACKUP_AGENT_PHONE, alert backup, notify lead of delay
```

---

## Phase 13 — Analytics Module

Create `src/analytics/metrics.ts`:

```typescript
export interface DashboardMetrics {
  today: {
    totalLeads: number;
    hotLeads: number;
    warmLeads: number;
    coldLeads: number;
  };
  conversionBySource: {
    '99acres': number;
    magicbricks: number;
    housing: number;
    commonfloor: number;
  };
  avgResponseTimeMinutes: number;
  hotLeadAccuracyPercent: number;
  weeklyLeadVolume: number[];
  topPerformingSource: string;
  campaignEngagementRate: number;
}

// Runs every midnight via node-cron
// Writes summary to "Analytics" tab in Google Sheets
export async function generateDailyReport(): Promise<void>
```

---

## Phase 14 — Webhook Server

Create `webhooks/server.ts`:

```typescript
import express from 'express';
import rateLimit from 'express-rate-limit';

const app = express();
app.use(express.json());

// 200 req/min supports 100+ leads/day comfortably
const limiter = rateLimit({ windowMs: 60000, max: 200 });
app.use(limiter);

app.post('/webhook/99acres',      (req, res) => handlePortalWebhook('99acres', req, res));
app.post('/webhook/magicbricks',  (req, res) => handlePortalWebhook('magicbricks', req, res));
app.post('/webhook/housing',      (req, res) => handlePortalWebhook('housing', req, res));
app.post('/webhook/commonfloor',  (req, res) => handlePortalWebhook('commonfloor', req, res));
app.post('/webhook/whatsapp',     handleWhatsAppInbound);
app.get('/webhook/whatsapp',      handleWhatsAppVerification);
app.post('/opt-out',              handleOptOutRequest);
app.get('/health', (req, res) =>  res.json({ status: 'ok', uptime: process.uptime() }));

app.listen(3000);
```

---

## Phase 15 — Testing

```
tests/scorer.test.ts             — Score boundaries (0, 40, 70, 100)
tests/portalNormalizer.test.ts   — All 4 portal payload formats
tests/intentClassifier.test.ts   — Mock Groq, verify intent extraction
tests/hotLeadHandler.test.ts     — All 5 actions trigger correctly
tests/sheetsSync.test.ts         — Batch write + rate limit handling
tests/edgeCases.test.ts          — All 5 edge case handlers
tests/dripCampaign.test.ts       — Day sequencing + reactivation
```

Run: `npx jest --coverage`

---

## Phase 16 — README

Auto-generate `README.md` with:
- ASCII system architecture diagram
- Full free stack summary with signup links
- Setup instructions
- All webhook endpoint URLs
- Scoring matrix table
- Google Sheets column reference
- How to connect each of the 4 portals
- Render.com deployment guide

---

## Execution Order for Claude Code

```
Phase 1  → Scaffold + install dependencies
Phase 2  → .env.example
Phase 3  → Supabase SQL (print, do not execute)
Phase 4  → Lead data model
Phase 5  → Portal normalizer (all 4 portals)
Phase 6  → Qualification scorer
Phase 7  → Groq intent classifier
Phase 8  → WhatsApp engine
Phase 9  → Hot lead handler
Phase 10 → Google Sheets sync with batching
Phase 11 → Drip campaign
Phase 12 → Edge case handlers
Phase 13 → Analytics module
Phase 14 → Webhook server with rate limiting
Phase 15 → Tests
Phase 16 → README
```

> After all phases complete, run `npx ts-node webhooks/server.ts`
> Confirm `/health` returns 200 before marking project complete.

---

## Compliance Checklist
- [ ] DND registry scrubbing enabled (DND_SCRUB_ENABLED=true)
- [ ] STOP keyword → isOptedOut = true, never message again
- [ ] Phone numbers masked in logs (+91XXXXX12345)
- [ ] .env added to .gitignore
- [ ] Rate limiting active (200 req/min)
- [ ] POST /opt-out endpoint live
- [ ] Supabase service key never in frontend code
- [ ] Google service account JSON never committed to GitHub