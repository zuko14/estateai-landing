import { Lead, LeadSource, PropertyType, LeadStatus, Timeline, InvestmentIntent } from './lead.model';

/**
 * Map Supabase row (snake_case) to Lead model (camelCase)
 */
export function mapDbRowToLead(row: any): Lead {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    source: row.source as LeadSource,
    listingId: row.listing_id ?? undefined,
    propertyType: row.property_type as PropertyType,
    locationPreference: row.location_preference ?? '',
    budgetMin: row.budget_min ?? undefined,
    budgetMax: row.budget_max ?? undefined,
    timeline: row.timeline as Timeline,
    investmentIntent: row.investment_intent as InvestmentIntent,
    score: row.score ?? 0,
    status: row.status as LeadStatus,
    assignedAgent: row.assigned_agent ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at) : undefined,
    tags: row.tags ?? [],
    isDuplicate: row.is_duplicate ?? false,
    isOptedOut: row.is_opted_out ?? false,
    isDND: row.is_dnd ?? false,
  };
}

/**
 * Map Lead model (camelCase) to Supabase row (snake_case)
 */
export function mapLeadToDbRow(lead: Partial<Lead>): Record<string, any> {
  const row: Record<string, any> = {};

  if (lead.name !== undefined) row.name = lead.name;
  if (lead.phone !== undefined) row.phone = lead.phone;
  if (lead.email !== undefined) row.email = lead.email;
  if (lead.source !== undefined) row.source = lead.source;
  if (lead.listingId !== undefined) row.listing_id = lead.listingId;
  if (lead.propertyType !== undefined) row.property_type = lead.propertyType;
  if (lead.locationPreference !== undefined) row.location_preference = lead.locationPreference;
  if (lead.budgetMin !== undefined) row.budget_min = lead.budgetMin;
  if (lead.budgetMax !== undefined) row.budget_max = lead.budgetMax;
  if (lead.timeline !== undefined) row.timeline = lead.timeline;
  if (lead.investmentIntent !== undefined) row.investment_intent = lead.investmentIntent;
  if (lead.score !== undefined) row.score = lead.score;
  if (lead.status !== undefined) row.status = lead.status;
  if (lead.assignedAgent !== undefined) row.assigned_agent = lead.assignedAgent;
  if (lead.tags !== undefined) row.tags = lead.tags;
  if (lead.isDuplicate !== undefined) row.is_duplicate = lead.isDuplicate;
  if (lead.isOptedOut !== undefined) row.is_opted_out = lead.isOptedOut;
  if (lead.isDND !== undefined) row.is_dnd = lead.isDND;

  return row;
}
