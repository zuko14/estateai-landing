import { Lead } from '../utils/lead.model';
import { sendWhatsAppMessage } from '../whatsapp/engine';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { logger } from '../utils/logger';
import dayjs from 'dayjs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Handle hot lead execution protocol
 * Triggers when score >= HOT_LEAD_THRESHOLD (70)
 */
export async function handleHotLead(lead: Lead): Promise<void> {
  logger.info('Processing hot lead', { leadId: lead.id, score: lead.score });

  // 1. Send WhatsApp alert to agent
  await alertAgent(lead);

  // 2. Create Google Calendar event
  await createCalendarEvent(lead);

  // 3. Send confirmation to lead
  await notifyLead(lead);

  // 4. Update Supabase
  await supabase.from('leads').update({
    status: 'Hot',
    assigned_agent: process.env.AGENT_NAME,
    updated_at: new Date().toISOString()
  }).eq('id', lead.id);

  logger.info('Hot lead processed', { leadId: lead.id });
}

/**
 * Send WhatsApp alert to agent
 */
async function alertAgent(lead: Lead): Promise<void> {
  const budgetRange = lead.budgetMin && lead.budgetMax
    ? `₹${(lead.budgetMin / 100000).toFixed(1)}-${(lead.budgetMax / 100000).toFixed(1)}L`
    : 'Budget not specified';

  const message = `🔥 HOT LEAD ALERT!

Name: ${lead.name}
Phone: ${lead.phone}
Budget: ${budgetRange}
Property: ${lead.propertyType} at ${lead.locationPreference}
Timeline: ${lead.timeline}
Intent: ${lead.investmentIntent}

Score: ${lead.score}/100

Action required: Call within ${process.env.HOT_LEAD_CALL_WINDOW_HOURS || 2} hours.`;

  await sendWhatsAppMessage(process.env.AGENT_PHONE!, message);
  logger.info('Agent alerted for hot lead', { leadId: lead.id });
}

/**
 * Create Google Calendar event for follow-up
 */
async function createCalendarEvent(lead: Lead): Promise<void> {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}'),
      scopes: ['https://www.googleapis.com/auth/calendar']
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const budgetRange = lead.budgetMin && lead.budgetMax
      ? `₹${(lead.budgetMin / 100000).toFixed(1)}-${(lead.budgetMax / 100000).toFixed(1)}L`
      : 'Budget not specified';

    // Schedule within HOT_LEAD_CALL_WINDOW_HOURS
    const callWindowHours = Number(process.env.HOT_LEAD_CALL_WINDOW_HOURS || 2);
    const startTime = dayjs().add(30, 'minute').toISOString();
    const endTime = dayjs().add(30 + callWindowHours * 60, 'minute').toISOString();

    const event = {
      summary: `🔥 HOT LEAD CALL: ${lead.name} — ${budgetRange}`,
      description: `Lead Profile:
Name: ${lead.name}
Phone: ${lead.phone}
Email: ${lead.email || 'N/A'}
Source: ${lead.source}
Budget: ${budgetRange}
Property: ${lead.propertyType}
Location: ${lead.locationPreference}
Timeline: ${lead.timeline}
Intent: ${lead.investmentIntent}
Score: ${lead.score}/100

Action: Call within ${callWindowHours} hours`,
      start: {
        dateTime: startTime,
        timeZone: process.env.AGENT_TIMEZONE || 'Asia/Kolkata'
      },
      end: {
        dateTime: endTime,
        timeZone: process.env.AGENT_TIMEZONE || 'Asia/Kolkata'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'email', minutes: 60 }
        ]
      }
    };

    await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      requestBody: event
    });

    logger.info('Calendar event created', { leadId: lead.id });
  } catch (error) {
    logger.error('Failed to create calendar event', { error, leadId: lead.id });
  }
}

/**
 * Notify lead about upcoming call
 */
async function notifyLead(lead: Lead): Promise<void> {
  const message = `Hi ${lead.name}, thank you for your interest!

${process.env.AGENT_NAME} will call you within the next hour to discuss your ${lead.propertyType} requirements in ${lead.locationPreference}.

Reference: #${lead.id.slice(0, 8)}

If you have any questions before the call, just reply here.`;

  await sendWhatsAppMessage(lead.phone, message);
  logger.info('Lead notified of hot status', { leadId: lead.id });
}

// Placeholder - actual implementation in engine.ts
async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  const axios = (await import('axios')).default;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_API_TOKEN;

  if (!phoneNumberId || !token) {
    throw new Error('WhatsApp credentials not configured');
  }

  await axios.post(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
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
}
