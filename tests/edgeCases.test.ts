import { Lead } from '../src/utils/lead.model';

// Mock dependencies before importing
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
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({ data: { is_dnd: false }, error: null }),
        })),
      })),
    })),
  })),
}));

jest.mock('../src/calendar/calendarService', () => ({
  createCallbackEvent: jest.fn().mockResolvedValue('event-123'),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  handleInvalidPhone,
  scheduleCallbackRequest,
  handleBudgetMismatch,
  mergeDuplicateLead,
  reassignToBackupAgent,
  checkDNDRegistry,
} from '../src/utils/edgeCases';

describe('Edge Cases', () => {
  const testLead: Lead = {
    id: 'lead-123',
    name: 'Test User',
    phone: '+919999999999',
    source: '99acres',
    propertyType: 'Apartment',
    locationPreference: 'Whitefield',
    timeline: 'Immediate',
    investmentIntent: 'Investment',
    score: 85,
    status: 'Hot',
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
    process.env.BACKUP_AGENT_PHONE = '+918888888888';
  });

  describe('handleInvalidPhone', () => {
    it('should handle invalid phone without throwing', async () => {
      await expect(handleInvalidPhone({ name: 'Test', phone: '123', source: '99acres' })).resolves.not.toThrow();
    });

    it('should handle missing phone', async () => {
      await expect(handleInvalidPhone({ name: 'Test' })).resolves.not.toThrow();
    });
  });

  describe('scheduleCallbackRequest', () => {
    it('should schedule callback at valid time', async () => {
      await expect(scheduleCallbackRequest(testLead, '2026-03-15T14:00:00')).resolves.not.toThrow();
    });

    it('should handle invalid time format', async () => {
      await expect(scheduleCallbackRequest(testLead, 'not-a-date')).resolves.not.toThrow();
    });
  });

  describe('handleBudgetMismatch', () => {
    it('should handle budget mismatch', async () => {
      await expect(handleBudgetMismatch(testLead)).resolves.not.toThrow();
    });
  });

  describe('mergeDuplicateLead', () => {
    it('should merge duplicate leads', async () => {
      const incoming = { name: 'Test User', phone: '+919999999999', source: 'magicbricks' as const };
      await expect(mergeDuplicateLead(testLead, incoming)).resolves.not.toThrow();
    });
  });

  describe('reassignToBackupAgent', () => {
    it('should reassign to backup agent', async () => {
      await expect(reassignToBackupAgent(testLead)).resolves.not.toThrow();
    });

    it('should handle missing backup agent config', async () => {
      delete process.env.BACKUP_AGENT_PHONE;
      await expect(reassignToBackupAgent(testLead)).resolves.not.toThrow();
    });
  });

  describe('checkDNDRegistry', () => {
    it('should return false when DND check is disabled', async () => {
      process.env.DND_SCRUB_ENABLED = 'false';
      const result = await checkDNDRegistry('+919999999999');
      expect(result).toBe(false);
    });

    it('should check DND when enabled', async () => {
      process.env.DND_SCRUB_ENABLED = 'true';
      const result = await checkDNDRegistry('+919999999999');
      expect(result).toBe(false); // Mocked to return false
    });
  });
});
