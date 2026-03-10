import { Lead } from '../utils/lead.model';
import { sendWhatsAppMessage } from '../whatsapp/engine';
import { getSupabase } from '../utils/database';
import { mapDbRowToLead } from '../utils/mappers';
import { logger } from '../utils/logger';
import cron from 'node-cron';

interface DripMessage {
  day: number;
  type: string;
  message: string;
}

const DRIP_SCHEDULE: DripMessage[] = [
  {
    day: 1,
    type: 'market_report',
    message: 'Hi {name}, latest market update for {location}: prices moved {trend} this month. Reply to know more.',
  },
  {
    day: 3,
    type: 'new_listings',
    message: 'Hi {name}, new {propertyType} listings in {location} matching your budget just added. Want details?',
  },
  {
    day: 7,
    type: 'price_trends',
    message: 'Hi {name}, {area} price trend this week: {trend}. Good time to buy? Reply YES for full report.',
  },
  {
    day: 14,
    type: 'buyer_guide',
    message: "Hi {name}, first-time buyer? Here's a quick guide to buying in {city}. Want me to send it?",
  },
  {
    day: 30,
    type: 'requalification',
    message: 'Hi {name}, still looking for {propertyType} in {location}? What is your current budget?',
  },
];

/**
 * Start drip campaign for a cold lead
 */
export async function startDripCampaign(lead: Lead): Promise<void> {
  logger.info('Starting drip campaign', { leadId: lead.id });

  const supabase = getSupabase();

  const rows = DRIP_SCHEDULE.map(drip => {
    const scheduleDate = new Date();
    scheduleDate.setDate(scheduleDate.getDate() + drip.day);

    return {
      lead_id: lead.id,
      scheduled_for: scheduleDate.toISOString(),
      message_type: drip.type,
      content: personalizeMessage(drip.message, lead),
      status: 'pending',
    };
  });

  const { error } = await supabase.from('scheduled_messages').insert(rows);

  if (error) {
    logger.error('Failed to schedule drip campaign', { error, leadId: lead.id });
  } else {
    logger.info('Drip campaign scheduled', { leadId: lead.id, count: rows.length });
  }
}

/**
 * Personalize message template with lead data
 */
function personalizeMessage(template: string, lead: Lead): string {
  const trends = ['up 2%', 'stable', 'up 5%', 'down 1%'];
  const randomTrend = trends[Math.floor(Math.random() * trends.length)];

  return template
    .replace(/{name}/g, lead.name.split(' ')[0])
    .replace(/{location}/g, lead.locationPreference)
    .replace(/{area}/g, lead.locationPreference)
    .replace(/{city}/g, lead.locationPreference.split(',')[0] || lead.locationPreference)
    .replace(/{propertyType}/g, lead.propertyType.toLowerCase())
    .replace(/{trend}/g, randomTrend);
}

/**
 * Process scheduled drip messages
 * Runs daily via cron
 */
export async function processScheduledMessages(): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: messages, error } = await supabase
    .from('scheduled_messages')
    .select('*, leads(*)')
    .eq('status', 'pending')
    .lte('scheduled_for', now);

  if (error || !messages) {
    logger.error('Failed to fetch scheduled messages', { error });
    return;
  }

  for (const message of messages) {
    try {
      const lead = mapDbRowToLead(message.leads);

      // Skip if opted out
      if (lead.isOptedOut) {
        await supabase.from('scheduled_messages')
          .update({ status: 'cancelled' })
          .eq('id', message.id);
        continue;
      }

      // Send message
      await sendWhatsAppMessage(lead.phone, message.content);

      // Mark as sent
      await supabase.from('scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', message.id);

      logger.info('Drip message sent', { leadId: lead.id, type: message.message_type });
    } catch (error) {
      logger.error('Failed to send drip message', { error, messageId: message.id });

      // Mark as failed
      await supabase.from('scheduled_messages')
        .update({ status: 'failed' })
        .eq('id', message.id);
    }
  }
}

/**
 * Initialize cron job for drip campaigns
 */
export function initializeDripCron(): void {
  // Run every hour to process scheduled messages (more responsive than daily)
  cron.schedule('0 * * * *', () => {
    logger.info('Running scheduled drip messages');
    processScheduledMessages().catch(error => {
      logger.error('Drip cron job failed', { error });
    });
  });

  logger.info('Drip campaign cron initialized (hourly)');
}
