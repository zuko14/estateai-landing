import { appendLeadToSheet, updateLeadInSheet, syncBatch } from '../src/sheets/sheetsSync';
import { Lead } from '../src/utils/lead.model';

// Mock Google APIs
jest.mock('../src/calendar/calendarService', () => ({
  getSheetsClient: jest.fn(() => ({
    spreadsheets: {
      values: {
        append: jest.fn().mockResolvedValue({ data: {} }),
        get: jest.fn().mockResolvedValue({
          data: { values: [['lead-123'], ['lead-456']] },
        }),
        update: jest.fn().mockResolvedValue({ data: {} }),
      },
    },
  })),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Sheets Sync', () => {
  const testLead: Lead = {
    id: 'lead-123',
    name: 'Test User',
    phone: '+919999999999',
    source: '99acres',
    propertyType: 'Apartment',
    locationPreference: 'Whitefield',
    budgetMin: 5000000,
    budgetMax: 10000000,
    timeline: 'Immediate',
    investmentIntent: 'Investment',
    score: 85,
    status: 'Hot',
    assignedAgent: 'Agent Name',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
    tags: ['loan-approved'],
    isDuplicate: false,
    isOptedOut: false,
    isDND: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_SHEET_ID = 'test-sheet-id';
  });

  describe('appendLeadToSheet', () => {
    it('should append lead data to sheet', async () => {
      await expect(appendLeadToSheet(testLead)).resolves.not.toThrow();
    });

    it('should throw if GOOGLE_SHEET_ID not configured', async () => {
      delete process.env.GOOGLE_SHEET_ID;
      await expect(appendLeadToSheet(testLead)).rejects.toThrow('GOOGLE_SHEET_ID not configured');
    });
  });

  describe('updateLeadInSheet', () => {
    it('should update existing lead in sheet', async () => {
      await expect(updateLeadInSheet(testLead)).resolves.not.toThrow();
    });

    it('should handle lead not found gracefully', async () => {
      const unknownLead = { ...testLead, id: 'unknown-id' };
      await expect(updateLeadInSheet(unknownLead)).resolves.not.toThrow();
    });
  });

  describe('syncBatch', () => {
    it('should queue leads for batch processing', async () => {
      await expect(syncBatch([testLead])).resolves.not.toThrow();
    });

    it('should handle multiple leads', async () => {
      const leads = [testLead, { ...testLead, id: 'lead-456', name: 'Another User' }];
      await expect(syncBatch(leads)).resolves.not.toThrow();
    });
  });
});
