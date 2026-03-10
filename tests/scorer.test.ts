import { scoreLead, getScoreFactors } from '../src/qualification/scorer';
import { Lead } from '../src/utils/lead.model';

describe('Lead Scorer', () => {
  const baseLead: Lead = {
    id: 'test-123',
    name: 'Test User',
    phone: '+919999999999',
    source: '99acres',
    propertyType: 'Apartment',
    locationPreference: 'Whitefield',
    timeline: 'Browsing',
    investmentIntent: 'Unclear',
    score: 0,
    status: 'New',
    createdAt: new Date(),
    updatedAt: new Date(),
    tags: [],
    isDuplicate: false,
    isOptedOut: false,
    isDND: false,
  };

  describe('Score boundaries', () => {
    it('should return score of 0 for minimal lead', () => {
      const result = scoreLead(baseLead);
      expect(result.total).toBe(0);
    });

    it('should return score of 100 for perfect lead', () => {
      const perfectLead: Lead = {
        ...baseLead,
        timeline: 'Immediate',
        budgetMin: 5000000,
        budgetMax: 10000000,
        investmentIntent: 'Investment',
        tags: ['loan-approved', 'site-visited', 'ready-downpayment'],
      };

      const result = scoreLead(perfectLead);
      expect(result.total).toBe(100);
    });

    it('should cap score at 100', () => {
      const overflowLead: Lead = {
        ...baseLead,
        timeline: 'Immediate',
        budgetMin: 10000000,
        budgetMax: 20000000,
        investmentIntent: 'Both',
        tags: ['loan-approved', 'site-visited', 'ready-downpayment'],
      };

      const result = scoreLead(overflowLead);
      expect(result.total).toBe(100);
    });

    it('should floor score at 0', () => {
      const negativeLead: Lead = {
        ...baseLead,
        timeline: 'Browsing',
        tags: ['first-inquiry', 'no-research'],
      };

      const result = scoreLead(negativeLead);
      expect(result.total).toBe(0);
    });
  });

  describe('Classification', () => {
    it('should classify as Hot when score >= 70', () => {
      const hotLead: Lead = {
        ...baseLead,
        timeline: 'Immediate',
        budgetMin: 5000000,
        budgetMax: 10000000,
        investmentIntent: 'Investment',
      };

      const result = scoreLead(hotLead);
      expect(result.classification).toBe('Hot');
    });

    it('should classify as Warm when score is 40-69', () => {
      const warmLead: Lead = {
        ...baseLead,
        timeline: '1-3 months',
        budgetMin: 3000000,
        budgetMax: 5000000,
        investmentIntent: 'Self-use',
      };

      const result = scoreLead(warmLead);
      expect(result.classification).toBe('Warm');
    });

    it('should classify as Cold when score < 40', () => {
      const coldLead: Lead = {
        ...baseLead,
        timeline: '6+ months',
        tags: ['first-inquiry'],
      };

      const result = scoreLead(coldLead);
      expect(result.classification).toBe('Cold');
    });
  });

  describe('Timeline scoring', () => {
    it('should give 30 points for Immediate timeline', () => {
      const lead = { ...baseLead, timeline: 'Immediate' as const };
      const result = scoreLead(lead);
      expect(result.timeline).toBe(30);
    });

    it('should give 20 points for 1-3 months timeline', () => {
      const lead = { ...baseLead, timeline: '1-3 months' as const };
      const result = scoreLead(lead);
      expect(result.timeline).toBe(20);
    });

    it('should give 5 points for 3-6 months timeline', () => {
      const lead = { ...baseLead, timeline: '3-6 months' as const };
      const result = scoreLead(lead);
      expect(result.timeline).toBe(5);
    });

    it('should deduct 10 points for 6+ months timeline', () => {
      const lead = { ...baseLead, timeline: '6+ months' as const };
      const result = scoreLead(lead);
      expect(result.timeline).toBe(-10);
    });

    it('should deduct 10 points for Browsing timeline', () => {
      const lead = { ...baseLead, timeline: 'Browsing' as const };
      const result = scoreLead(lead);
      expect(result.timeline).toBe(-10);
    });
  });

  describe('Budget clarity scoring', () => {
    it('should give 25 points for full range with high value', () => {
      const lead = { ...baseLead, budgetMin: 5000000, budgetMax: 10000000 };
      const result = scoreLead(lead);
      expect(result.budgetClarity).toBe(25);
    });

    it('should give 15 points for full range with lower value', () => {
      const lead = { ...baseLead, budgetMin: 1000000, budgetMax: 3000000 };
      const result = scoreLead(lead);
      expect(result.budgetClarity).toBe(15);
    });

    it('should give 5 points for partial range', () => {
      const lead = { ...baseLead, budgetMin: 2000000 };
      const result = scoreLead(lead);
      expect(result.budgetClarity).toBe(5);
    });

    it('should deduct 15 points for no budget', () => {
      const lead = { ...baseLead };
      const result = scoreLead(lead);
      expect(result.budgetClarity).toBe(-15);
    });
  });

  describe('Investment intent scoring', () => {
    it('should give 20 points for Self-use', () => {
      const lead = { ...baseLead, investmentIntent: 'Self-use' as const };
      const result = scoreLead(lead);
      expect(result.investmentIntent).toBe(20);
    });

    it('should give 25 points for Investment', () => {
      const lead = { ...baseLead, investmentIntent: 'Investment' as const };
      const result = scoreLead(lead);
      expect(result.investmentIntent).toBe(25);
    });

    it('should give 25 points for Both', () => {
      const lead = { ...baseLead, investmentIntent: 'Both' as const };
      const result = scoreLead(lead);
      expect(result.investmentIntent).toBe(25);
    });

    it('should deduct 20 points for Unclear', () => {
      const lead = { ...baseLead, investmentIntent: 'Unclear' as const };
      const result = scoreLead(lead);
      expect(result.investmentIntent).toBe(-20);
    });
  });

  describe('Urgency signals', () => {
    it('should give 20 points for positive urgency tags', () => {
      const lead = { ...baseLead, tags: ['loan-approved', 'site-visited'] };
      const result = scoreLead(lead);
      expect(result.urgencySignals).toBe(20);
    });

    it('should deduct 10 points for cold tags', () => {
      const lead = { ...baseLead, tags: ['first-inquiry', 'no-research'] };
      const result = scoreLead(lead);
      expect(result.urgencySignals).toBe(-10);
    });

    it('should give 0 points for neutral tags', () => {
      const lead = { ...baseLead, tags: ['some-other-tag'] };
      const result = scoreLead(lead);
      expect(result.urgencySignals).toBe(0);
    });
  });

  describe('getScoreFactors', () => {
    it('should return formatted factor string', () => {
      const breakdown = {
        timeline: 30,
        budgetClarity: 25,
        investmentIntent: 20,
        urgencySignals: 20,
        total: 95,
        classification: 'Hot' as const,
      };

      const factors = getScoreFactors(breakdown);
      expect(factors).toContain('Timeline (+30)');
      expect(factors).toContain('Budget (+25)');
      expect(factors).toContain('Intent (+20)');
      expect(factors).toContain('Urgency (+20)');
    });
  });
});
