# Real Estate Lead Intelligence & Automation System

Automated real estate lead generation system capturing 100+ leads/day from Indian property portals, qualifying via WhatsApp AI, and routing hot leads to agents instantly.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 99acres     │     │ MagicBricks │     │ Housing.com │     │ CommonFloor │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │                   │
       └───────────────────┴───────────────────┴───────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │      Webhook Server         │
                    │     (Express + Rate Limit)  │
                    └─────────────┬───────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │   Portal Normalizer         │
                    │   (Normalize all 4 formats) │
                    └─────────────┬───────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │   Lead Scoring Engine       │
                    │   (0-100 score, Hot/Warm/Cold)│
                    └─────────────┬───────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
             ┌─────────┐   ┌─────────┐   ┌─────────┐
             │   Hot   │   │  Warm   │   │  Cold   │
             │  (≥70)  │   │ (40-69) │   │  (<40)  │
             └────┬────┘   └────┬────┘   └────┬────┘
                  │             │             │
                  ▼             ▼             ▼
          ┌──────────────┐ ┌──────────┐ ┌──────────┐
          │ WhatsApp AI  │ │ Agent    │ │ Drip     │
          │ + Calendar   │ │ Queue    │ │ Campaign │
          │ + Sheets     │ │          │ │ (30-day) │
          └──────────────┘ └──────────┘ └──────────┘
```

## Free Tech Stack

| Component | Service | Cost |
|-----------|---------|------|
| WhatsApp API | Meta WhatsApp Cloud API | Free |
| AI Processing | Groq API (Llama 3) | Free |
| Database | Supabase PostgreSQL | Free Tier |
| Lead Dashboard | Google Sheets | Free |
| Calendar | Google Calendar API | Free |
| Hosting | Render.com | Free Tier |

## Features

- **Multi-Portal Capture**: Integrates with 99acres, MagicBricks, Housing.com, CommonFloor
- **AI Lead Qualification**: Uses Groq AI to extract intent from WhatsApp conversations
- **Smart Scoring**: 0-100 score based on timeline, budget, intent, urgency signals
- **Instant Routing**: Hot leads (≥70) trigger immediate WhatsApp + Calendar alerts
- **Drip Campaign**: Automated 30-day nurture sequence for cold leads
- **Real-time Sync**: Google Sheets dashboard with batch writes
- **Compliance**: DND registry support, opt-out handling, phone masking

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd realestate-leads
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Setup Supabase

Run the SQL in `src/utils/database.sql` in your Supabase SQL editor.

### 4. Start Server

```bash
npm run dev
```

### 5. Verify Health Check

```bash
curl http://localhost:3000/health
```

## Webhook Endpoints

Configure these URLs in your property portal dashboards:

| Portal | Webhook URL |
|--------|-------------|
| 99acres | `https://your-domain.com/webhook/99acres` |
| MagicBricks | `https://your-domain.com/webhook/magicbricks` |
| Housing.com | `https://your-domain.com/webhook/housing` |
| CommonFloor | `https://your-domain.com/webhook/commonfloor` |

## Scoring Matrix

| Factor | Hot (+) | Neutral | Cold (-) |
|--------|---------|---------|----------|
| **Timeline** | Immediate (+30) | 1-3mo (+20), 3-6mo (+5) | 6+mo (-10), Browsing (-10) |
| **Budget** | Full range + high value (+25) | Partial range (+5) | None (-15) |
| **Intent** | Investment/Both (+25) | Self-use (+20) | Unclear (-20) |
| **Signals** | loan-approved, site-visited (+20) | - | first-inquiry (-10) |

## Google Sheets Columns

| Column | Field |
|--------|-------|
| A | ID |
| B | Name |
| C | Phone |
| D | Source |
| E | Property Type |
| F | Location |
| G | Budget Min |
| H | Budget Max |
| I | Timeline |
| J | Intent |
| K | Score |
| L | Status |
| M | Agent |
| N | Created At |
| O | Last Contacted |
| P | Tags |

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test -- --coverage
```

## Deployment

### Render.com (Free Tier) - Recommended

**Option 1: Blueprint (Recommended)**

1. Fork this repository to your GitHub account
2. Create a **New Web Service** on Render
3. Select **Build and deploy from a Git repository**
4. Connect your GitHub repository
5. Render will auto-detect `render.yaml` and configure the service
6. Set your environment variables in the Render dashboard
7. Click **Create Web Service**

**Option 2: Manual Configuration**

If not using `render.yaml`, configure manually:

| Setting | Value |
|---------|-------|
| Environment | Node |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Plan | Free |

**Webhook URLs After Deployment:**

Once deployed, your webhook URLs will be:
```
https://your-service-name.onrender.com/webhook/99acres
https://your-service-name.onrender.com/webhook/magicbricks
https://your-service-name.onrender.com/webhook/housing
https://your-service-name.onrender.com/webhook/commonfloor
https://your-service-name.onrender.com/webhook/whatsapp
```

**Required Environment Variables on Render:**

Go to **Dashboard → Your Service → Environment** and add:

```
WHATSAPP_API_TOKEN=your_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token
GROQ_API_KEY=your_groq_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_CALENDAR_ID=your_calendar_id
AGENT_NAME=Your Name
AGENT_PHONE=+91XXXXXXXXXX
AGENT_EMAIL=your@email.com
```

**Post-Deploy Checklist:**

- [ ] Verify `/health` endpoint returns `{"status":"ok"}`
- [ ] Test webhook endpoints with curl
- [ ] Configure webhooks in property portal dashboards
- [ ] Set up WhatsApp webhook verification
- [ ] Verify Google Sheets integration

### Docker Deployment

Build and run with Docker:

```bash
docker build -t realestate-leads .
docker run -p 3000:3000 --env-file .env realestate-leads
```

### Environment Variables

See `.env.example` for all required variables.

## Compliance

- ✅ DND registry scrubbing (DND_SCRUB_ENABLED)
- ✅ STOP keyword opt-out handling
- ✅ Phone number masking in logs (+91XXXXX12345)
- ✅ Rate limiting (200 req/min)
- ✅ Secure credential storage (.env, never committed)

## Project Structure

```
realestate-leads/
├── src/
│   ├── capture/          # Lead ingestion from all 4 portals
│   ├── whatsapp/         # WhatsApp Cloud API engine
│   ├── qualification/    # Scoring and classification
│   ├── sheets/           # Google Sheets sync
│   ├── calendar/         # Google Calendar scheduling
│   ├── nurture/          # Drip campaign engine
│   ├── analytics/        # Metrics and reporting
│   └── utils/            # Shared helpers
├── config/               # Configuration files
├── webhooks/             # Express server
├── tests/                # Unit + integration tests
└── logs/                 # Runtime logs (gitignored)
```

## License

MIT

## Support

For issues and feature requests, please open a GitHub issue.

---

Built for the Indian real estate market. Handles 100+ leads/day on free tier.
