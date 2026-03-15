import axios from 'axios';
import { Lead } from '../utils/lead.model';
import { classifyIntent } from '../qualification/intentClassifier';
import { scoreLead } from '../qualification/scorer';
import { handleHotLead } from '../qualification/hotLeadHandler';
import { logger } from '../utils/logger';
import { getSupabase } from '../utils/database';
import { mapDbRowToLead } from '../utils/mappers';
import { withRetry } from '../utils/retry';
import { appendLeadToSheet, updateLeadInSheet } from '../sheets/sheetsSync';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

// Normalize phone to always strip + for storage lookups
function normalizePhone(phone: string): string[] {
  const stripped = phone.replace('+', '');
  const withPlus = `+${stripped}`;
  return [stripped, withPlus];
}

export async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_API_TOKEN;

  if (!phoneNumberId || !token) {
    throw new Error('WhatsApp credentials not configured');
  }

  await withRetry(async () => {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  }, `WhatsApp message to ${maskPhone(to)}`);
}

export async function sendInitialMessage(lead: Lead): Promise<void> {
  const message = `Hi ${lead.name}, thanks for your interest in ${lead.propertyType} at ${lead.locationPreference}.

I'm ${process.env.AGENT_NAME}'s assistant. Quick questions:
1. Buying for investment or self-use?
2. Budget range? (₹X - ₹Y lakhs)
3. Timeline? (Immediate / 3-6 months / Later)
4. Visited any sites in ${lead.locationPreference} recently?

Reply to get personalized recommendations!`;

  await sendWhatsAppMessage(lead.phone, message);
  logger.info('Initial message sent', { leadId: lead.id, phone: maskPhone(lead.phone) });
}

export async function processInboundMessage(phone: string, message: string): Promise<void> {
  const supabase = getSupabase();

  try {
    // Handle both +919493386498 and 919493386498 formats
    const phoneVariants = normalizePhone(phone);

    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .in('phone', phoneVariants)
      .eq('is_opted_out', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !leads || leads.length === 0) {
      logger.warn('Lead not found for inbound message', { phone: maskPhone(phone) });
      return;
    }

    const lead = mapDbRowToLead(leads[0]);

    // Save message to database
    await supabase.from('messages').insert({
      lead_id: lead.id,
      direction: 'inbound',
      content: message,
      channel: 'whatsapp',
      status: 'received',
    });

    // Classify intent via Groq
    const intent = await classifyIntent(message);

    // Update lead with new information
    const updates: Record<string, any> = {
      last_contacted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (intent.timeline) updates.timeline = intent.timeline;
    if (intent.budget) {
      updates.budget_min = intent.budget.min;
      updates.budget_max = intent.budget.max;
    }
    if (intent.investmentIntent) updates.investment_intent = intent.investmentIntent;
    if (intent.urgencySignals?.length) {
      updates.tags = [...new Set([...(lead.tags || []), ...intent.urgencySignals])];
    }

    await supabase.from('leads').update(updates).eq('id', lead.id);

    // Re-fetch lead for scoring
    const { data: updatedRow } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead.id)
      .single();

    if (updatedRow) {
      const updatedLead = mapDbRowToLead(updatedRow);
      const scoreResult = scoreLead(updatedLead);

      // Update score and status
      await supabase.from('leads').update({
        score: scoreResult.total,
        status: scoreResult.classification === 'Hot' ? 'Hot' :
          scoreResult.classification === 'Warm' ? 'Warm' : 'Cold',
      }).eq('id', lead.id);

      // Build scored lead object with correct score — pass this everywhere
      const scoredLead = {
        ...updatedLead,
        score: scoreResult.total,
        status: scoreResult.classification as any,
      };

      // Sync lead to Google Sheets
      console.log('[WhatsApp Engine] Syncing lead to Google Sheets:', lead.id);
      try {
        await appendLeadToSheet(scoredLead);
        console.log('[WhatsApp Engine] Sheets sync completed successfully');
      } catch (sheetsError) {
        console.error('[WhatsApp Engine] Sheets sync failed:', sheetsError);
        logger.error('Failed to sync lead to sheets', { leadId: lead.id, error: sheetsError });
      }

      // Handle Hot leads
      if (scoreResult.classification === 'Hot') {
        await handleHotLead(scoredLead);
      }

      // Handle Cold leads
      if (scoreResult.classification === 'Cold') {
        await scheduleFollowUps(lead.id);
      }
    }

    logger.info('Inbound message processed', { leadId: lead.id, phone: maskPhone(phone) });
  } catch (error) {
    logger.error('Error processing inbound message', { error, phone: maskPhone(phone) });
    throw error;
  }
}

export async function scheduleFollowUps(leadId: string): Promise<void> {
  const supabase = getSupabase();

  const brochureTime = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const dripTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await supabase.from('scheduled_messages').insert([
      {
        lead_id: leadId,
        scheduled_for: brochureTime.toISOString(),
        message_type: 'brochure_followup',
        content: 'Hi {name}, would you like a brochure for the properties in {location}? Reply YES and I\'ll send it right away!',
        status: 'pending',
      },
      {
        lead_id: leadId,
        scheduled_for: dripTime.toISOString(),
        message_type: 'cold_drip_start',
        content: 'Hi {name}, just checking in about your {propertyType} search in {location}. Any updates on your timeline?',
        status: 'pending',
      },
    ]);

    logger.info('Follow-ups scheduled', { leadId, brochureAt: brochureTime, dripAt: dripTime });
  } catch (error) {
    logger.error('Failed to schedule follow-ups', { error, leadId });
  }
}

export async function handleOptOut(phone: string): Promise<void> {
  const supabase = getSupabase();

  const phoneVariants = normalizePhone(phone);

  const { data: leads } = await supabase
    .from('leads')
    .select('id')
    .in('phone', phoneVariants);

  if (leads && leads.length > 0) {
    for (const lead of leads) {
      await supabase.from('leads').update({
        is_opted_out: true,
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id);
    }

    await supabase.from('scheduled_messages')
      .update({ status: 'cancelled' })
      .in('lead_id', leads.map(l => l.id))
      .eq('status', 'pending');

    logger.info('Lead opted out', { phone: maskPhone(phone) });
  }
}

export function containsOptOut(message: string): boolean {
  const optOutKeywords = ['stop', 'unsubscribe', 'opt out', 'dont contact', "don't contact"];
  return optOutKeywords.some(keyword =>
    message.toLowerCase().includes(keyword)
  );
}

export function maskPhone(phone: string): string {
  if (phone.length < 8) return '****';
  return phone.slice(0, -8) + 'XXXX' + phone.slice(-4);
}