import { Lead } from '../src/utils/lead.model';

// Mock dependencies
jest.mock('../src/whatsapp/engine', () => ({
  sendWhatsAppMessage: jest.fn().mockResolvedValue(undefined),
  maskPhone: jest.fn((phone: string) => '****' + phone.slice(-4)),
}));

jest.mock('../src/utils/database', () => ({
  getSupabase: jest.fn(() => ({
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })),
  })),
}));

jest.mock('../src/calendar/calendarService', () => ({
  createLeadCallEvent: jest.fn().mockResolvedValue('event-123'),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { handleHotLead } from '../src/qualification/hotLeadHandler';

describe('Hot Lead Handler', () => {
  const hotLead: Lead = {
    id: 'lead-123',
    name: 'John Doe',
    phone: '+919999999999',
    source: '99acres',
    propertyType: 'Apartment',
    locationPreference: 'Whitefield',
    budgetMin: 8000000,
    budgetMax: 12000000,
    timeline: 'Immediate',
    investmentIntent: 'Investment',
    score: 85,
    status: 'Hot',
    assignedAgent: 'Agent Name',
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    isDuplicate: false,
    isOptedOut: false,
    isDND: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_PHONE = '+919999999999';
    process.env.AGENT_NAME = 'Test Agent';
    process.env.HOT_LEAD_CALL_WINDOW_HOURS = '2';
  });

  it('should process hot lead without throwing', async () => {
    await expect(handleHotLead(hotLead)).resolves.not.toThrow();
  });

  it('should handle lead without budget', async () => {
    const leadNoBudget: Lead = {
      ...hotLead,
      budgetMin: undefined,
      budgetMax: undefined,
    };

    await expect(handleHotLead(leadNoBudget)).resolves.not.toThrow();
  });

  it('should send WhatsApp alerts', async () => {
    const { sendWhatsAppMessage } = require('../src/whatsapp/engine');
    await handleHotLead(hotLead);
    // Should call sendWhatsAppMessage at least twice (agent alert + lead notification)
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(2);
  });

  it('should create calendar event', async () => {
    const { createLeadCallEvent } = require('../src/calendar/calendarService');
    await handleHotLead(hotLead);
    expect(createLeadCallEvent).toHaveBeenCalledTimes(1);
  });

  it('should update lead status in database', async () => {
    const { getSupabase } = require('../src/utils/database');
    await handleHotLead(hotLead);
    expect(getSupabase).toHaveBeenCalled();
  });
});
