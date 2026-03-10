import {
  normalizePhone,
  normalize99Acres,
  normalizeMagicBricks,
  normalizeHousing,
  normalizeCommonFloor,
  normalizeLead
} from '../src/capture/portalNormalizer';
import { LeadSource } from '../src/utils/lead.model';

describe('Portal Normalizer', () => {
  describe('normalizePhone', () => {
    it('should convert phone to E.164 format', () => {
      expect(normalizePhone('9999999999')).toBe('+919999999999');
      expect(normalizePhone('999-999-9999')).toBe('+919999999999');
      expect(normalizePhone('999 999 9999')).toBe('+919999999999');
    });

    it('should handle phone with existing +91', () => {
      expect(normalizePhone('+919999999999')).toBe('+919999999999');
      expect(normalizePhone('919999999999')).toBe('+919999999999');
    });

    it('should handle phone with extra digits', () => {
      expect(normalizePhone('00919999999999')).toBe('+919999999999');
    });
  });

  describe('normalize99Acres', () => {
    it('should normalize 99Acres payload', () => {
      const payload = {
        name: 'John Doe',
        phone: '9999999999',
        email: 'john@example.com',
        propertyType: 'Apartment',
        location: 'Whitefield',
        budgetMin: '50 Lakhs',
        budgetMax: '80 Lakhs',
        timeline: 'Immediate',
        purpose: 'Investment',
        listingId: '12345'
      };

      const result = normalize99Acres(payload);

      expect(result.name).toBe('John Doe');
      expect(result.phone).toBe('+919999999999');
      expect(result.source).toBe('99acres');
      expect(result.propertyType).toBe('Apartment');
      expect(result.budgetMin).toBe(5000000);
      expect(result.budgetMax).toBe(8000000);
    });

    it('should handle missing optional fields', () => {
      const payload = {
        name: 'Jane Doe',
        phone: '8888888888'
      };

      const result = normalize99Acres(payload);

      expect(result.name).toBe('Jane Doe');
      expect(result.email).toBeUndefined();
      expect(result.budgetMin).toBeUndefined();
    });
  });

  describe('normalizeMagicBricks', () => {
    it('should normalize MagicBricks payload', () => {
      const payload = {
        name: 'John Doe',
        phone: '9999999999',
        emailId: 'john@example.com',
        propertyType: 'Villa',
        locality: 'Koramangala',
        minBudget: '1 Crore',
        maxBudget: '1.5 Crore',
        buyingTime: '1-3 months',
        buyingPurpose: 'Self-use'
      };

      const result = normalizeMagicBricks(payload);

      expect(result.propertyType).toBe('Villa');
      expect(result.locationPreference).toBe('Koramangala');
      expect(result.budgetMin).toBe(10000000);
      expect(result.budgetMax).toBe(15000000);
      expect(result.timeline).toBe('1-3 months');
    });
  });

  describe('normalizeHousing', () => {
    it('should normalize Housing.com payload', () => {
      const payload = {
        name: 'John Doe',
        phone: '9999999999',
        type: 'Apartment',
        locality: 'Indiranagar',
        budget: { min: 5000000, max: 8000000 },
        whenToBuy: '3-6 months'
      };

      const result = normalizeHousing(payload);

      expect(result.source).toBe('housing');
      expect(result.propertyType).toBe('Apartment');
      expect(result.timeline).toBe('3-6 months');
    });
  });

  describe('normalizeCommonFloor', () => {
    it('should normalize CommonFloor payload', () => {
      const payload = {
        name: 'John Doe',
        phone: '9999999999',
        propertyType: 'Plot',
        city: 'Bangalore',
        budgetMin: '30 Lakhs',
        timeline: '6+ months',
        purpose: 'Investment'
      };

      const result = normalizeCommonFloor(payload);

      expect(result.source).toBe('commonfloor');
      expect(result.propertyType).toBe('Plot');
      expect(result.budgetMin).toBe(3000000);
      expect(result.timeline).toBe('6+ months');
    });
  });

  describe('normalizeLead', () => {
    it('should route to correct normalizer', () => {
      const payload = { name: 'Test', phone: '9999999999' };

      expect(normalizeLead('99acres' as LeadSource, payload).source).toBe('99acres');
      expect(normalizeLead('magicbricks' as LeadSource, payload).source).toBe('magicbricks');
      expect(normalizeLead('housing' as LeadSource, payload).source).toBe('housing');
      expect(normalizeLead('commonfloor' as LeadSource, payload).source).toBe('commonfloor');
    });

    it('should throw error for unknown source', () => {
      expect(() => normalizeLead('unknown' as LeadSource, {})).toThrow('Unknown lead source');
    });
  });
});
