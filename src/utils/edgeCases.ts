import { Lead } from '../utils/lead.model';
import { sendWhatsAppMessage, maskPhone } from '../whatsapp/engine';
import { getSupabase } from '../utils/database';
import { createCallbackEvent } from '../calendar/calendarService';
import { logger } from '../utils/logger';
import dayjs from 'dayjs';

/**
 * Handle invalid phone number
 * Flags in Supabase, alerts agent, skips WhatsApp
 */
export async function handleInvalidPhone(lead: Partial<Lead>): Promise<void> {
  logger.warn('Invalid phone number detected', { phone: maskPhone(lead.phone || ''), name: lead.name });

  const supabase = getSupabase();

  // Flag in Supabase
  if (lead.phone) {
    await supabase.from('leads').update({
      status: 'Invalid',
      tags: [...(lead.tags || []), 'invalid-phone'],
      updated_at: new Date().toISOString(),
    }).eq('phone', lead.phone);
  }

  // Alert agent
  const message = `⚠️ INVALID PHONE NUMBER

Lead: ${lead.name}
Phone: ${maskPhone(lead.phone || 'unknown')}
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

  const requestedTime = dayjs(time);
  if (!requestedTime.isValid()) {
    logger.error('Invalid callback time format', { leadId: lead.id, time });
    return;
  }

  const eventId = await createCallbackEvent({
    leadName: lead.name,
    leadPhone: lead.phone,
    leadId: lead.id,
    requestedTime: time,
  });

  if (eventId) {
    // Confirm to lead
    const confirmationMessage = `Hi ${lead.name}, I've scheduled your callback for ${requestedTime.format('MMM DD, h:mm A')}.

${process.env.AGENT_NAME} will call you then.

If you need to reschedule, just reply with a new time.`;

    await sendWhatsAppMessage(lead.phone, confirmationMessage);
    logger.info('Callback scheduled', { leadId: lead.id, time });
  }
}

/**
 * Handle budget mismatch
 * Suggest alternative locations, downgrade score by 15, keep Warm
 */
export async function handleBudgetMismatch(lead: Lead): Promise<void> {
  logger.info('Handling budget mismatch', { leadId: lead.id });

  const supabase = getSupabase();

  // Update lead
  await supabase.from('leads').update({
    score: Math.max(0, lead.score - 15),
    status: 'Warm',
    tags: [...lead.tags, 'budget-mismatch'],
    updated_at: new Date().toISOString(),
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

  const supabase = getSupabase();

  // Merge tags
  const mergedTags = [...new Set([...existing.tags, ...(incoming.tags || []), 'merged-duplicate'])];

  // Update existing lead with new info (prefer existing for core fields)
  await supabase.from('leads').update({
    email: incoming.email || existing.email,
    budget_min: incoming.budgetMin || existing.budgetMin,
    budget_max: incoming.budgetMax || existing.budgetMax,
    timeline: incoming.timeline || existing.timeline,
    investment_intent: incoming.investmentIntent || existing.investmentIntent,
    tags: mergedTags,
    updated_at: new Date().toISOString(),
    last_contacted_at: new Date().toISOString(),
  }).eq('id', existing.id);

  // Log duplicate in duplicate_leads table
  await supabase.from('duplicate_leads').insert({
    original_lead_id: existing.id,
    duplicate_data: incoming,
    merged_at: new Date().toISOString(),
  });

  // Notify agent (mask phone for compliance)
  const message = `🔄 DUPLICATE MERGED

Original: ${existing.name} (${maskPhone(existing.phone)})
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

  const supabase = getSupabase();

  // Update lead
  await supabase.from('leads').update({
    assigned_agent: 'Backup Agent',
    status: 'Reassigned',
    tags: [...lead.tags, 'backup-assigned'],
    updated_at: new Date().toISOString(),
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
 * Check DND registry (stub — integrate with actual DND API when available)
 */
export async function checkDNDRegistry(phone: string): Promise<boolean> {
  if (process.env.DND_SCRUB_ENABLED !== 'true') {
    return false; // DND check disabled
  }

  // TODO: Integrate with actual TRAI DND registry API
  // For now, check the lead's is_dnd flag in the database
  const supabase = getSupabase();
  const { data } = await supabase
    .from('leads')
    .select('is_dnd')
    .eq('phone', phone)
    .single();

  return data?.is_dnd ?? false;
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
    'default': ['Nearby Area 1', 'Nearby Area 2', 'Nearby Area 3'],
  };

  const area = Object.keys(alternatives).find(key =>
    original.toLowerCase().includes(key.toLowerCase())
  );

  return area ? alternatives[area] : alternatives.default;
}
