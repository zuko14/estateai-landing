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
 * Handle invalid phone number
 * Flags in Supabase, alerts agent, skips WhatsApp
 */
export async function handleInvalidPhone(lead: Partial<Lead>): Promise<void> {
  logger.warn('Invalid phone number detected', { phone: lead.phone, name: lead.name });

  // Flag in Supabase
  await supabase.from('leads').update({
    status: 'Invalid',
    tags: [...(lead.tags || []), 'invalid-phone'],
    updated_at: new Date().toISOString()
  }).eq('phone', lead.phone);

  // Alert agent
  const message = `⚠️ INVALID PHONE NUMBER

Lead: ${lead.name}
Phone: ${lead.phone}
Source: ${lead.source}

Action required: Manual follow-up needed.`;

  await sendWhatsAppMessage(process.env.AGENT_PHONE!, message);
}

/**
 * Schedule callback at requested time
 * Creates Google Calendar event + WhatsApp confirmation
 */
export async function scheduleCallbackRequest(
  lead: Lead,
  time: string
): Promise<void> {
  logger.info('Scheduling callback', { leadId: lead.id, time });

  // Parse requested time
  const requestedTime = dayjs(time);
  if (!requestedTime.isValid()) {
    logger.error('Invalid callback time format', { leadId: lead.id, time });
    return;
  }

  // Create calendar event
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}'),
      scopes: ['https://www.googleapis.com/auth/calendar']
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const event = {
      summary: `📞 Callback: ${lead.name}`,
      description: `Requested callback for ${lead.name}
Phone: ${lead.phone}
Reference: #${lead.id.slice(0, 8)}

Lead wants callback at: ${time}`,
      start: {
        dateTime: requestedTime.toISOString(),
        timeZone: process.env.AGENT_TIMEZONE || 'Asia/Kolkata'
      },
      end: {
        dateTime: requestedTime.add(30, 'minute').toISOString(),
        timeZone: process.env.AGENT_TIMEZONE || 'Asia/Kolkata'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 }
        ]
      }
    };

    await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      requestBody: event
    });

    // Confirm to lead
    const confirmationMessage = `Hi ${lead.name}, I've scheduled your callback for ${requestedTime.format('MMM DD, h:mm A')}.

${process.env.AGENT_NAME} will call you then.

If you need to reschedule, just reply with a new time.`;

    await sendWhatsAppMessage(lead.phone, confirmationMessage);

    logger.info('Callback scheduled', { leadId: lead.id, time });
  } catch (error) {
    logger.error('Failed to schedule callback', { error, leadId: lead.id });
  }
}

/**
 * Handle budget mismatch
 * Suggest alternative locations, downgrade score by 15, keep Warm
 */
export async function handleBudgetMismatch(lead: Lead): Promise<void> {
  logger.info('Handling budget mismatch', { leadId: lead.id });

  // Update lead
  await supabase.from('leads').update({
    score: Math.max(0, lead.score - 15),
    status: 'Warm',
    tags: [...lead.tags, 'budget-mismatch'],
    updated_at: new Date().toISOString()
  }).eq('id', lead.id);

  // Suggest alternatives
  const alternatives = getAlternativeLocations(lead.locationPreference);
  const message = `Hi ${lead.name}, I see your budget may not match properties in ${lead.locationPreference}.

Consider these nearby areas with better options in your range:
${alternatives.map(a => `• ${a}`).join('\n')}

Would you like to see listings in any of these areas?`;

  await sendWhatsAppMessage(lead.phone, message);
}

/**
 * Merge duplicate lead
 * Keeps existing, updates with new info, marks incoming duplicate, notifies agent
 */
export async function mergeDuplicateLead(
  existing: Lead,
  incoming: Partial<Lead>
): Promise<void> {
  logger.info('Merging duplicate lead', { existingId: existing.id });

  // Merge data - prefer existing, fill in missing from incoming
  const merged: any = {
    ...existing,
    ...incoming,
    // Keep existing data for these fields
    id: existing.id,
    createdAt: existing.createdAt,
    // Update with new info
    updatedAt: new Date(),
    lastContactedAt: new Date()
  };

  // Merge tags
  merged.tags = [...new Set([...existing.tags, ...(incoming.tags || [])])];

  // Mark as duplicate
  merged.tags.push('merged-duplicate');

  // Update existing lead
  await supabase.from('leads').update(merged).eq('id', existing.id);

  // Mark incoming as duplicate in logs
  await supabase.from('duplicate_leads').insert({
    original_lead_id: existing.id,
    duplicate_data: incoming,
    merged_at: new Date().toISOString()
  });

  // Notify agent
  const message = `🔄 DUPLICATE MERGED

Original: ${existing.name} (${existing.phone})
Source: ${existing.source}
Merged from: ${incoming.source}

Updated fields: ${Object.keys(incoming || {}).join(', ')}`;

  await sendWhatsAppMessage(process.env.AGENT_PHONE!, message);
}

/**
 * Reassign lead to backup agent
 */
export async function reassignToBackupAgent(lead: Lead): Promise<void> {
  logger.info('Reassigning to backup agent', { leadId: lead.id });

  const backupAgent = process.env.BACKUP_AGENT_PHONE;
  if (!backupAgent) {
    logger.error('No backup agent configured');
    return;
  }

  // Update lead
  await supabase.from('leads').update({
    assigned_agent: 'Backup Agent',
    status: 'Reassigned',
    tags: [...lead.tags, 'backup-assigned'],
    updated_at: new Date().toISOString()
  }).eq('id', lead.id);

  // Alert backup agent
  const backupMessage = `📋 BACKUP ASSIGNMENT

Lead: ${lead.name}
Phone: ${lead.phone}
Property: ${lead.propertyType} at ${lead.locationPreference}
Budget: ${lead.budgetMin && lead.budgetMax ? `₹${(lead.budgetMin/100000).toFixed(0)}-${(lead.budgetMax/100000).toFixed(0)}L` : 'Not specified'}

Primary agent unavailable. Please follow up within 2 hours.`;

  await sendWhatsAppMessage(backupAgent, backupMessage);

  // Notify lead of delay
  const leadMessage = `Hi ${lead.name}, ${process.env.AGENT_NAME} is currently unavailable.

My colleague will contact you shortly regarding your ${lead.propertyType} inquiry.

Apologies for any delay!`;

  await sendWhatsAppMessage(lead.phone, leadMessage);
}

/**
 * Get alternative locations based on original
 */
function getAlternativeLocations(original: string): string[] {
  const alternatives: Record<string, string[]> = {
    'Whitefield': ['K R Puram', 'Brookefield', 'Marathahalli'],
    'Koramangala': ['HSR Layout', 'BTM Layout', 'Jayanagar'],
    'Indiranagar': ['MG Road', 'Ulsoor', 'Domlur'],
    'Marathahalli': ['Whitefield', 'Kundalahalli', 'Brookefield'],
    'HSR Layout': ['Koramangala', 'BTM Layout', 'Bellandur'],
    'Jayanagar': ['JP Nagar', 'Basavanagudi', 'Banashankari'],
    'JP Nagar': ['Jayanagar', 'BTM Layout', 'Bannerghatta Road'],
    'MG Road': ['Indiranagar', 'Richmond Town', 'Ulsoor'],
    'default': ['Nearby Area 1', 'Nearby Area 2', 'Nearby Area 3']
  };

  // Find matching area or return default
  const area = Object.keys(alternatives).find(key =>
    original.toLowerCase().includes(key.toLowerCase())
  );

  return area ? alternatives[area] : alternatives.default;
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
