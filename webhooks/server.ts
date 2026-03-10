import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { normalizeLead } from '../src/capture/portalNormalizer';
import { processInboundMessage, handleOptOut, containsOptOut } from '../src/whatsapp/engine';
import { scoreLead } from '../src/qualification/scorer';
import { handleHotLead } from '../src/qualification/hotLeadHandler';
import { appendLeadToSheet } from '../src/sheets/sheetsSync';
import { startDripCampaign } from '../src/nurture/dripCampaign';
import { handleInvalidPhone } from '../src/utils/edgeCases';
import { initializeDripCron } from '../src/nurture/dripCampaign';
import { initializeAnalyticsCron } from '../src/analytics/metrics';
import { logger } from '../src/utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Rate limiting: 200 req/min supports 100+ leads/day comfortably
const limiter = rateLimit({
  windowMs: 60000,
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});
app.use(limiter);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handle portal webhook (99acres, MagicBricks, Housing, CommonFloor)
 */
async function handlePortalWebhook(
  source: string,
  req: Request,
  res: Response
): Promise<void> {
  try {
    logger.info(`Webhook received from ${source}`, { payload: req.body });

    // Verify webhook secret
    const secretHeader = req.headers['x-webhook-secret'];
    const expectedSecret = process.env[`${source.toUpperCase()}_WEBHOOK_SECRET`];

    if (expectedSecret && secretHeader !== expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Normalize lead data
    const leadData = normalizeLead(source as any, req.body);

    // Validate phone number
    if (!leadData.phone || leadData.phone.length < 10) {
      await handleInvalidPhone(leadData);
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }

    // Check for duplicates
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', leadData.phone)
      .order('created_at', { ascending: false })
      .limit(1);

    let leadId: string;

    if (existingLeads && existingLeads.length > 0) {
      // Update existing lead
      const existing = existingLeads[0];
      await supabase.from('leads').update({
        ...leadData,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
      leadId = existing.id;
      logger.info('Lead updated (duplicate)', { leadId });
    } else {
      // Insert new lead
      const { data: newLead, error } = await supabase
        .from('leads')
        .insert({
          ...leadData,
          status: 'New',
          score: 0,
          is_duplicate: false,
          is_opted_out: false,
          is_dnd: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      leadId = newLead.id;
      logger.info('New lead created', { leadId });
    }

    // Fetch complete lead for scoring
    const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();

    if (lead) {
      // Score the lead
      const scoreResult = scoreLead(lead as any);

      // Update with score
      await supabase.from('leads').update({
        score: scoreResult.total,
        status: scoreResult.classification === 'Hot' ? 'Hot' :
                scoreResult.classification === 'Warm' ? 'Warm' : 'Cold'
      }).eq('id', leadId);

      // Handle Hot leads
      if (scoreResult.classification === 'Hot') {
        await handleHotLead(lead as any);
      }

      // Handle Cold leads - start drip
      if (scoreResult.classification === 'Cold') {
        await startDripCampaign(lead as any);
      }

      // Sync to Google Sheets
      await appendLeadToSheet({ ...lead, score: scoreResult.total } as any);

      // Send initial WhatsApp message
      const { sendInitialMessage } = await import('../src/whatsapp/engine');
      await sendInitialMessage({ ...lead, score: scoreResult.total } as any);
    }

    res.status(200).json({ success: true, leadId });
  } catch (error) {
    logger.error(`Webhook processing error: ${source}`, { error });
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle WhatsApp inbound messages
 */
async function handleWhatsAppInbound(req: Request, res: Response): Promise<void> {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      res.status(200).send('OK');
      return;
    }

    const message = messages[0];
    const phone = message.from;
    const text = message.text?.body || '';

    logger.info('WhatsApp message received', { phone: phone?.slice(-4), text: text.slice(0, 50) });

    // Check for opt-out
    if (containsOptOut(text)) {
      await handleOptOut(phone);
      res.status(200).send('OK');
      return;
    }

    // Process message
    await processInboundMessage(phone, text);

    res.status(200).send('OK');
  } catch (error) {
    logger.error('WhatsApp inbound error', { error });
    res.status(500).send('Error');
  }
}

/**
 * Handle WhatsApp webhook verification
 */
function handleWhatsAppVerification(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

/**
 * Handle opt-out request
 */
async function handleOptOutRequest(req: Request, res: Response): Promise<void> {
  const { phone } = req.body;

  if (!phone) {
    res.status(400).json({ error: 'Phone number required' });
    return;
  }

  await handleOptOut(phone);
  res.status(200).json({ success: true, message: 'Opted out successfully' });
}

// Routes
app.post('/webhook/99acres', (req, res) => handlePortalWebhook('99acres', req, res));
app.post('/webhook/magicbricks', (req, res) => handlePortalWebhook('magicbricks', req, res));
app.post('/webhook/housing', (req, res) => handlePortalWebhook('housing', req, res));
app.post('/webhook/commonfloor', (req, res) => handlePortalWebhook('commonfloor', req, res));
app.post('/webhook/whatsapp', handleWhatsAppInbound);
app.get('/webhook/whatsapp', handleWhatsAppVerification);
app.post('/opt-out', handleOptOutRequest);
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);

  // Initialize cron jobs
  initializeDripCron();
  initializeAnalyticsCron();
});

export default app;
