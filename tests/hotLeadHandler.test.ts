import { handleHotLead } from '../src/qualification/hotLeadHandler';
import { Lead } from '../src/utils/lead.model';

// Mock dependencies
jest.mock('../src/whatsapp/engine', () => ({
  sendWhatsAppMessage: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      update: jest.fn().mockResolvedValue({ data: null, error: null })
    }))
  }))
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn().mockImplementation(() => ({
        getClient: jest.fn().mockResolvedValue({})
      }))
    },
    calendar: jest.fn(() => ({
      events: {
        insert: jest.fn().mockResolvedValue({ data: { id: 'event-123' } })
      }
    }))
  }
}));

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
    tags: []
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process hot lead', async () => {
    await expect(handleHotLead(hotLead)).resolves.not.toThrow();
  });

  it('should handle lead without budget', async () => {
    const leadNoBudget: Lead = {
      ...hotLead,
      budgetMin: undefined,
      budgetMax: undefined
    };

    await expect(handleHotLead(leadNoBudget)).resolves.not.toThrow();
  });
});
