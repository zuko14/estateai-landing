import axios from 'axios';
import { Lead } from '../utils/lead.model';
import { classifyIntent } from '../qualification/intentClassifier';
import { scoreLead } from '../qualification/scorer';
import { handleHotLead } from '../qualification/hotLeadHandler';
import { logger } from '../utils/logger';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Send initial qualification message within 2 minutes of lead capture
 */
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

/**
 * Process inbound reply from lead
 */
export async function processInboundMessage(phone: string, message: string): Promise<void> {
  try {
    // Find lead by phone
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .eq('is_opted_out', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !leads || leads.length === 0) {
      logger.warn('Lead not found for inbound message', { phone: maskPhone(phone) });
      return;
    }

    const lead = leads[0];

    // Save message to database
    await supabase.from('messages').insert({
      lead_id: lead.id,
      direction: 'inbound',
      content: message,
      channel: 'whatsapp',
      status: 'received'
    });

    // Classify intent via Groq
    const intent = await classifyIntent(message);

    // Update lead with new information
    const updates: any = {
      last_contacted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (intent.timeline) updates.timeline = intent.timeline;
    if (intent.budget) {
      updates.budget_min = intent.budget.min;
      updates.budget_max = intent.budget.max;
    }
    if (intent.investmentIntent) updates.investment_intent = intent.investmentIntent;
    if (intent.urgencySignals?.length) {
      updates.tags = [...(lead.tags || []), ...intent.urgencySignals];
    }

    await supabase.from('leads').update(updates).eq('id', lead.id);

    // Re-fetch lead for scoring
    const { data: updatedLead } = await supabase.from('leads').select('*').eq('id', lead.id).single();

    if (updatedLead) {
      const scoreResult = scoreLead(updatedLead as Lead);

      // Update score and status
      await supabase.from('leads').update({
        score: scoreResult.total,
        status: scoreResult.classification === 'Hot' ? 'Hot' :
                scoreResult.classification === 'Warm' ? 'Warm' : 'Cold'
      }).eq('id', lead.id);

      // Handle Hot leads
      if (scoreResult.classification === 'Hot') {
        await handleHotLead(updatedLead as Lead);
      }

      // Handle Cold leads - start drip campaign
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

/**
 * Send WhatsApp message via Meta API
 */
async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_API_TOKEN;

  if (!phoneNumberId || !token) {
    throw new Error('WhatsApp credentials not configured');
  }

  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    logger.error('Failed to send WhatsApp message', { error, to: maskPhone(to) });
    throw error;
  }
}

/**
 * Schedule follow-up messages
 */
export async function scheduleFollowUps(leadId: string): Promise<void> {
  // 4 hours no reply → send brochure
  // 24 hours no reply → mark Cold + start drip

  const fourHoursLater = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const twentyFourHoursLater = new Date(Date.now() + 24 * 60 * 60 * 1000);

  logger.info('Follow-ups scheduled', {
    leadId,
    brochureAt: fourHoursLater,
    dripAt: twentyFourHoursLater
  });
}

/**
 * Handle opt-out request
 */
export async function handleOptOut(phone: string): Promise<void> {
  const { data: leads } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', phone);

  if (leads && leads.length > 0) {
    for (const lead of leads) {
      await supabase.from('leads').update({
        is_opted_out: true,
        updated_at: new Date().toISOString()
      }).eq('id', lead.id);
    }
    logger.info('Lead opted out', { phone: maskPhone(phone) });
  }
}

/**
 * Check if message contains opt-out keywords
 */
export function containsOptOut(message: string): boolean {
  const optOutKeywords = ['stop', 'unsubscribe', 'opt out', 'dont contact', "don't contact"];
  return optOutKeywords.some(keyword =>
    message.toLowerCase().includes(keyword)
  );
}

/**
 * Mask phone number for logging
 */
function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.slice(0, -8) + 'XXXX' + phone.slice(-4);
}
