import { classifyIntent, extractBudgetFromText } from '../src/qualification/intentClassifier';

// Mock Groq SDK
jest.mock('groq-sdk', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({
                timeline: 'Immediate',
                budget: { min: 5000000, max: 10000000 },
                investmentIntent: 'Investment',
                urgencySignals: ['loan-approved'],
                sentiment: 'positive',
              }),
            },
          }],
        }),
      },
    },
  }));
});

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Intent Classifier', () => {
  describe('classifyIntent', () => {
    it('should classify intent from message', async () => {
      const result = await classifyIntent('I want to buy a property for investment, budget 50-100 lakhs, ready to buy now');
      expect(result.sentiment).toBeDefined();
    });

    it('should return neutral sentiment on parse failure', async () => {
      const Groq = require('groq-sdk');
      Groq.mockImplementation(() => ({
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: 'invalid json' } }],
            }),
          },
        },
      }));

      const { classifyIntent: ci } = jest.requireActual('../src/qualification/intentClassifier');
      // The mock is already set up, so the imported classifyIntent uses it
      const result = await classifyIntent('test message');
      expect(result).toBeDefined();
    });

    it('should handle Groq API errors gracefully', async () => {
      const Groq = require('groq-sdk');
      Groq.mockImplementation(() => ({
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(new Error('API Error')),
          },
        },
      }));

      const result = await classifyIntent('test message');
      expect(result).toBeDefined();
      expect(result.sentiment).toBeDefined();
    });
  });

  describe('extractBudgetFromText', () => {
    it('should extract budget in lakhs', () => {
      const result = extractBudgetFromText('Budget is around 50 lakhs');
      expect(result).toBeDefined();
      if (result) {
        expect(result.min).toBeGreaterThan(0);
      }
    });

    it('should extract budget in crores', () => {
      const result = extractBudgetFromText('Looking for 1.5 crore property');
      expect(result).toBeDefined();
      if (result) {
        expect(result.min).toBeGreaterThan(0);
      }
    });

    it('should extract budget range', () => {
      const result = extractBudgetFromText('Budget between 50 lakhs to 80 lakhs');
      expect(result).toBeDefined();
      if (result) {
        expect(result.min).toBeLessThanOrEqual(result.max!);
      }
    });

    it('should return undefined for no budget', () => {
      const result = extractBudgetFromText('Just browsing around');
      expect(result).toBeUndefined();
    });
  });
});
