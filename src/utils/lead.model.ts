export type LeadSource = '99acres' | 'magicbricks' | 'housing' | 'commonfloor' | 'manual';
export type PropertyType = 'Plot' | 'Apartment' | 'Villa' | 'Commercial';
export type LeadStatus = 'New' | 'Contacted' | 'Qualified' | 'Hot' | 'Warm' | 'Cold' | 'Converted' | 'Lost';
export type Timeline = 'Immediate' | '1-3 months' | '3-6 months' | '6+ months' | 'Browsing';
export type InvestmentIntent = 'Self-use' | 'Investment' | 'Both' | 'Unclear';

export interface Lead {
  id: string;
  name: string;
  phone: string;                     // E.164 format: +91XXXXXXXXXX
  email?: string;
  source: LeadSource;
  listingId?: string;
  propertyType: PropertyType;
  locationPreference: string;
  budgetMin?: number;                // INR
  budgetMax?: number;                // INR
  timeline: Timeline;
  investmentIntent: InvestmentIntent;
  score: number;                     // 0-100
  status: LeadStatus;
  assignedAgent?: string;
  createdAt: Date;
  updatedAt: Date;
  lastContactedAt?: Date;
  tags: string[];
  isDuplicate: boolean;
  isOptedOut: boolean;
  isDND: boolean;
}

export interface Message {
  id: string;
  leadId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  channel: 'whatsapp' | 'sms' | 'email';
  status: string;
  timestamp: Date;
}

export interface ScoreBreakdown {
  timeline: number;
  budgetClarity: number;
  investmentIntent: number;
  urgencySignals: number;
  total: number;
  classification: 'Hot' | 'Warm' | 'Cold';
}
