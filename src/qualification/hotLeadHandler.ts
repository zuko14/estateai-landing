import { Lead } from '../utils/lead.model';
import { sendWhatsAppMessage, maskPhone } from '../whatsapp/engine';
import { getSupabase } from '../utils/database';
import { createLeadCallEvent } from '../calendar/calendarService';
import { logger } from '../utils/logger';

/**
 * Handle hot lead execution protocol
 * Triggers when score >= HOT_LEAD_THRESHOLD (70)
 */
export async function handleHotLead(lead: Lead): Promise<void> {
  logger.info('Processing hot lead', { leadId: lead.id, score: lead.score });

  // 1. Send WhatsApp alert to agent
  await alertAgent(lead);

  // 2. Create Google Calendar event
  await createCalendarEventForLead(lead);

  // 3. Send confirmation to lead
  await notifyLead(lead);

  // 4. Update Supabase
  const supabase = getSupabase();
  await supabase.from('leads').update({
    status: 'Hot',
    assigned_agent: process.env.AGENT_NAME,
    updated_at: new Date().toISOString(),
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
async function createCalendarEventForLead(lead: Lead): Promise<void> {
  const budgetRange = lead.budgetMin && lead.budgetMax
    ? `₹${(lead.budgetMin / 100000).toFixed(1)}-${(lead.budgetMax / 100000).toFixed(1)}L`
    : 'Budget not specified';

  const callWindowHours = Number(process.env.HOT_LEAD_CALL_WINDOW_HOURS || 2);

  await createLeadCallEvent({
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
    startMinutesFromNow: 30,
    durationMinutes: callWindowHours * 60,
  });
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
