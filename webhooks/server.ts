import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { normalizeLead } from '../src/capture/portalNormalizer';
import { processInboundMessage, sendInitialMessage, handleOptOut, containsOptOut } from '../src/whatsapp/engine';
import { scoreLead } from '../src/qualification/scorer';
import { handleHotLead } from '../src/qualification/hotLeadHandler';
import { appendLeadToSheet } from '../src/sheets/sheetsSync';
import { startDripCampaign } from '../src/nurture/dripCampaign';
import { handleInvalidPhone, checkDNDRegistry } from '../src/utils/edgeCases';
import { mergeDuplicateLead } from '../src/utils/edgeCases';
import { initializeDripCron } from '../src/nurture/dripCampaign';
import { initializeAnalyticsCron } from '../src/analytics/metrics';
import { logger } from '../src/utils/logger';
import { getSupabase } from '../src/utils/database';
import { mapDbRowToLead, mapLeadToDbRow } from '../src/utils/mappers';
import { portalConfigs } from '../config/portals.config';
import { LeadSource } from '../src/utils/lead.model';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Rate limiting: 200 req/min supports 100+ leads/day comfortably
const limiter = rateLimit({
  windowMs: 60000,
  max: 200,
  message: { error: 'Too many requests, please try again later' },
});
app.use(limiter);

// Zod schema for basic webhook payload validation
const webhookPayloadSchema = z.object({
  name: z.string().optional(),
  contactName: z.string().optional(),
  firstName: z.string().optional(),
  userName: z.string().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  mobileNumber: z.string().optional(),
  contact: z.string().optional(),
  contactNumber: z.string().optional(),
  phoneNumber: z.string().optional(),
}).passthrough().refine(
  (data) => !!(data.phone || data.mobile || data.mobileNumber || data.contact || data.contactNumber || data.phoneNumber),
  { message: 'At least one phone field is required' }
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

    // Verify webhook secret using portal config
    const portalConfig = portalConfigs[source];
    if (portalConfig) {
      const secretHeader = req.headers['x-webhook-secret'];
      const expectedSecret = process.env[portalConfig.secretEnvVar];

      if (expectedSecret && secretHeader !== expectedSecret) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    // Validate payload with Zod
    const validation = webhookPayloadSchema.safeParse(req.body);
    if (!validation.success) {
      logger.warn('Invalid webhook payload', { source, errors: validation.error.errors });
      res.status(400).json({ error: 'Invalid payload', details: validation.error.errors });
      return;
    }

    // Normalize lead data
    const leadData = normalizeLead(source as LeadSource, req.body);

    // Validate phone number
    if (!leadData.phone || leadData.phone.length < 10) {
      await handleInvalidPhone(leadData);
      res.status(400).json({ error: 'Invalid phone number' });
      return;
    }

    // Check DND registry before proceeding
    const isDND = await checkDNDRegistry(leadData.phone);
    if (isDND) {
      logger.info('Lead is on DND registry, skipping WhatsApp', { phone: leadData.phone });
      // Still store the lead, but mark as DND
      leadData.isDND = true;
    }

    const supabase = getSupabase();

    // Check for duplicates
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', leadData.phone)
      .order('created_at', { ascending: false })
      .limit(1);

    let leadId: string;

    if (existingLeads && existingLeads.length > 0) {
      // Merge duplicate lead
      const existing = mapDbRowToLead(existingLeads[0]);
      await mergeDuplicateLead(existing, leadData);
      leadId = existing.id;
      logger.info('Lead merged (duplicate)', { leadId });
    } else {
      // Insert new lead
      const dbRow = mapLeadToDbRow(leadData);
      const { data: newLead, error } = await supabase
        .from('leads')
        .insert({
          ...dbRow,
          status: 'New',
          score: 0,
          is_duplicate: false,
          is_opted_out: false,
          is_dnd: leadData.isDND || false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        logger.error('Failed to insert lead', { error });
        throw error;
      }
      leadId = newLead.id;
      logger.info('New lead created', { leadId });
    }

    // Fetch complete lead for scoring
    const { data: leadRow } = await supabase.from('leads').select('*').eq('id', leadId).single();

    if (leadRow) {
      const lead = mapDbRowToLead(leadRow);

      // Score the lead
      const scoreResult = scoreLead(lead);

      // Update with score
      await supabase.from('leads').update({
        score: scoreResult.total,
        status: scoreResult.classification === 'Hot' ? 'Hot' :
                scoreResult.classification === 'Warm' ? 'Warm' : 'Cold',
      }).eq('id', leadId);

      const scoredLead = { ...lead, score: scoreResult.total, status: scoreResult.classification as any };

      // Handle Hot leads
      if (scoreResult.classification === 'Hot') {
        await handleHotLead(scoredLead);
      }

      // Handle Cold leads - start drip
      if (scoreResult.classification === 'Cold') {
        await startDripCampaign(scoredLead);
      }

      // Sync to Google Sheets
      console.log('[Webhook] Syncing new lead to Google Sheets:', leadId);
      try {
        await appendLeadToSheet(scoredLead);
        console.log('[Webhook] Sheets sync successful for lead:', leadId);
      } catch (error) {
        console.error('[Webhook] Sheets sync failed for lead:', leadId, error);
        logger.error('Failed to sync lead to sheets from webhook', { leadId, error });
        // Continue - don't fail the webhook just because sheets sync failed
      }

      // Send initial WhatsApp message (skip if DND)
      if (!lead.isDND) {
        await sendInitialMessage(scoredLead);
      }
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
app.post('/webhook/99acres', (req: Request, res: Response) => handlePortalWebhook('99acres', req, res));
app.post('/webhook/magicbricks', (req: Request, res: Response) => handlePortalWebhook('magicbricks', req, res));
app.post('/webhook/housing', (req: Request, res: Response) => handlePortalWebhook('housing', req, res));
app.post('/webhook/commonfloor', (req: Request, res: Response) => handlePortalWebhook('commonfloor', req, res));
app.post('/webhook/whatsapp', handleWhatsAppInbound);
app.get('/webhook/whatsapp', handleWhatsAppVerification);
app.post('/opt-out', handleOptOutRequest);
app.get('/health', (_req: Request, res: Response) => res.json({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));

// Metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const { getRealTimeMetrics } = await import('../src/analytics/metrics');
    const metrics = await getRealTimeMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);

  // Initialize cron jobs
  initializeDripCron();
  initializeAnalyticsCron();
});

export default app;
