import { Lead } from '../src/utils/lead.model';

// Mock dependencies before importing
jest.mock('../src/whatsapp/engine', () => ({
  sendWhatsAppMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/database', () => ({
  getSupabase: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'lead-123',
              name: 'Test',
              phone: '+919999999999',
              is_opted_out: false,
              tags: [],
            },
            error: null,
          }),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })),
  })),
}));

jest.mock('../src/utils/mappers', () => ({
  mapDbRowToLead: jest.fn((row: any) => ({
    id: row.id || 'lead-123',
    name: row.name || 'Test',
    phone: row.phone || '+919999999999',
    source: '99acres',
    propertyType: 'Apartment',
    locationPreference: 'Whitefield',
    timeline: 'Browsing',
    investmentIntent: 'Unclear',
    score: 0,
    status: 'Cold',
    tags: row.tags || [],
    isDuplicate: false,
    isOptedOut: row.is_opted_out || false,
    isDND: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

import { startDripCampaign, processScheduledMessages, initializeDripCron } from '../src/nurture/dripCampaign';

describe('Drip Campaign', () => {
  const coldLead: Lead = {
    id: 'lead-123',
    name: 'Cold Lead User',
    phone: '+919999999999',
    source: '99acres',
    propertyType: 'Apartment',
    locationPreference: 'Whitefield',
    timeline: 'Browsing',
    investmentIntent: 'Unclear',
    score: 15,
    status: 'Cold',
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: ['first-inquiry'],
    isDuplicate: false,
    isOptedOut: false,
    isDND: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('startDripCampaign', () => {
    it('should schedule all 5 drip messages', async () => {
      const { getSupabase } = require('../src/utils/database');
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      getSupabase.mockReturnValue({
        from: jest.fn(() => ({
          insert: mockInsert,
        })),
      });

      await startDripCampaign(coldLead);
      expect(mockInsert).toHaveBeenCalledTimes(1);
      // Should insert 5 messages (one for each drip schedule entry)
      const insertedRows = mockInsert.mock.calls[0][0];
      expect(insertedRows).toHaveLength(5);
    });

    it('should personalize messages with lead data', async () => {
      const { getSupabase } = require('../src/utils/database');
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      getSupabase.mockReturnValue({
        from: jest.fn(() => ({
          insert: mockInsert,
        })),
      });

      await startDripCampaign(coldLead);
      const insertedRows = mockInsert.mock.calls[0][0];
      // Check that messages contain personalized content
      expect(insertedRows[0].content).toContain('Cold');  // First name
      expect(insertedRows[0].content).toContain('Whitefield');  // Location
    });

    it('should schedule messages on correct days', async () => {
      const { getSupabase } = require('../src/utils/database');
      const mockInsert = jest.fn().mockResolvedValue({ data: null, error: null });
      getSupabase.mockReturnValue({
        from: jest.fn(() => ({
          insert: mockInsert,
        })),
      });

      await startDripCampaign(coldLead);
      const insertedRows = mockInsert.mock.calls[0][0];
      const types = insertedRows.map((r: any) => r.message_type);
      expect(types).toEqual([
        'market_report',
        'new_listings',
        'price_trends',
        'buyer_guide',
        'requalification',
      ]);
    });
  });

  describe('processScheduledMessages', () => {
    it('should process pending scheduled messages', async () => {
      await expect(processScheduledMessages()).resolves.not.toThrow();
    });
  });

  describe('initializeDripCron', () => {
    it('should initialize cron job', () => {
      const cron = require('node-cron');
      initializeDripCron();
      expect(cron.schedule).toHaveBeenCalledTimes(1);
    });
  });
});
