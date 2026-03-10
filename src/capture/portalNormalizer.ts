import { Lead, LeadSource, PropertyType, Timeline, InvestmentIntent } from '../utils/lead.model';

/**
 * Convert phone number to E.164 format (+91XXXXXXXXXX)
 */
export function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Remove leading 91 if already present to avoid duplication
  const withoutCountryCode = digits.startsWith('91') && digits.length > 10
    ? digits.slice(2)
    : digits;

  // Add +91 prefix
  return `+91${withoutCountryCode.slice(-10)}`;
}

/**
 * Normalize 99Acres payload
 */
export function normalize99Acres(payload: any): Partial<Lead> {
  return {
    name: payload.name || payload.contactName || 'Unknown',
    phone: normalizePhone(payload.phone || payload.mobile || payload.contactNumber),
    email: payload.email,
    source: '99acres' as LeadSource,
    listingId: payload.listingId || payload.propertyId,
    propertyType: mapPropertyType(payload.propertyType),
    locationPreference: payload.location || payload.city || payload.area || 'Unknown',
    budgetMin: parseBudget(payload.budgetMin),
    budgetMax: parseBudget(payload.budgetMax),
    timeline: mapTimeline(payload.timeline || payload.lookingToBuy),
    investmentIntent: mapInvestmentIntent(payload.purpose || payload.investmentIntent),
    tags: extractTags(payload),
  };
}

/**
 * Normalize MagicBricks payload
 */
export function normalizeMagicBricks(payload: any): Partial<Lead> {
  return {
    name: payload.name || (payload.firstName && payload.lastName ? `${payload.firstName} ${payload.lastName}` : 'Unknown'),
    phone: normalizePhone(payload.phone || payload.mobileNumber || payload.contact),
    email: payload.emailId || payload.email,
    source: 'magicbricks' as LeadSource,
    listingId: payload.propertyId || payload.listingId,
    propertyType: mapPropertyType(payload.propertyType || payload.property),
    locationPreference: payload.locality || payload.city || payload.area || 'Unknown',
    budgetMin: parseBudget(payload.minBudget),
    budgetMax: parseBudget(payload.maxBudget),
    timeline: mapTimeline(payload.buyingTime || payload.timeline),
    investmentIntent: mapInvestmentIntent(payload.buyingPurpose || payload.purpose),
    tags: extractTags(payload),
  };
}

/**
 * Normalize Housing.com payload
 */
export function normalizeHousing(payload: any): Partial<Lead> {
  return {
    name: payload.name || payload.userName || 'Unknown',
    phone: normalizePhone(payload.phone || payload.mobile || payload.contactNumber),
    email: payload.email,
    source: 'housing' as LeadSource,
    listingId: payload.id || payload.propertyId || payload.listingId,
    propertyType: mapPropertyType(payload.type || payload.propertyType),
    locationPreference: payload.locality || payload.location || payload.area || 'Unknown',
    budgetMin: parseBudget(payload.budget?.min),
    budgetMax: parseBudget(payload.budget?.max),
    timeline: mapTimeline(payload.whenToBuy || payload.timeline),
    investmentIntent: mapInvestmentIntent(payload.purpose),
    tags: extractTags(payload),
  };
}

/**
 * Normalize CommonFloor payload
 */
export function normalizeCommonFloor(payload: any): Partial<Lead> {
  return {
    name: payload.name || payload.contactName || 'Unknown',
    phone: normalizePhone(payload.phone || payload.mobile || payload.phoneNumber),
    email: payload.email,
    source: 'commonfloor' as LeadSource,
    listingId: payload.propertyId || payload.listingId,
    propertyType: mapPropertyType(payload.propertyType),
    locationPreference: payload.locality || payload.city || 'Unknown',
    budgetMin: parseBudget(payload.budgetMin),
    budgetMax: parseBudget(payload.budgetMax),
    timeline: mapTimeline(payload.timeline),
    investmentIntent: mapInvestmentIntent(payload.purpose),
    tags: extractTags(payload),
  };
}

/**
 * Master function - auto-detects source and routes
 */
export function normalizeLead(source: LeadSource, payload: any): Partial<Lead> {
  switch (source) {
    case '99acres':
      return normalize99Acres(payload);
    case 'magicbricks':
      return normalizeMagicBricks(payload);
    case 'housing':
      return normalizeHousing(payload);
    case 'commonfloor':
      return normalizeCommonFloor(payload);
    case 'manual':
      return {
        name: payload.name,
        phone: normalizePhone(payload.phone),
        email: payload.email,
        source: 'manual',
        propertyType: mapPropertyType(payload.propertyType),
        locationPreference: payload.location || 'Unknown',
        budgetMin: parseBudget(payload.budgetMin),
        budgetMax: parseBudget(payload.budgetMax),
        timeline: mapTimeline(payload.timeline),
        investmentIntent: mapInvestmentIntent(payload.investmentIntent),
        tags: payload.tags || [],
      };
    default:
      throw new Error(`Unknown lead source: ${source}`);
  }
}

// Helper functions
function mapPropertyType(type: string): PropertyType {
  const normalized = (type || '').toLowerCase();
  if (normalized.includes('plot') || normalized.includes('land')) return 'Plot';
  if (normalized.includes('villa') || normalized.includes('independent')) return 'Villa';
  if (normalized.includes('commercial') || normalized.includes('shop') || normalized.includes('office')) return 'Commercial';
  return 'Apartment';
}

function mapTimeline(timeline: string): Timeline {
  const normalized = (timeline || '').toLowerCase();
  if (normalized.includes('immediate') || normalized.includes('ready to move')) return 'Immediate';
  if (normalized.includes('1-3') || normalized.includes('1 to 3')) return '1-3 months';
  if (normalized.includes('3-6') || normalized.includes('3 to 6')) return '3-6 months';
  if (normalized.includes('6+') || normalized.includes('6 months') || normalized.includes('more than 6')) return '6+ months';
  return 'Browsing';
}

function mapInvestmentIntent(intent: string): InvestmentIntent {
  const normalized = (intent || '').toLowerCase();
  if (normalized.includes('self') || normalized.includes('own use') || normalized.includes('end use')) return 'Self-use';
  if (normalized.includes('invest') && normalized.includes('self')) return 'Both';
  if (normalized.includes('invest')) return 'Investment';
  return 'Unclear';
}

function parseBudget(budget: any): number | undefined {
  if (!budget) return undefined;
  // Handle strings like "50 Lakhs", "1 Crore", "5000000"
  const str = budget.toString().toLowerCase();
  let value = parseInt(str.replace(/\D/g, ''));
  if (isNaN(value)) return undefined;

  if (str.includes('crore') || str.includes('cr')) {
    value *= 10000000;
  } else if (str.includes('lakh') || str.includes('lac')) {
    value *= 100000;
  }
  return value;
}

function extractTags(payload: any): string[] {
  const tags: string[] = [];
  if (payload.isFirstInquiry) tags.push('first-inquiry');
  if (payload.hasVisitedSite) tags.push('site-visited');
  if (payload.loanApproved) tags.push('loan-approved');
  if (payload.readyDownpayment) tags.push('ready-downpayment');
  if (payload.noResearch) tags.push('no-research');
  return tags;
}
