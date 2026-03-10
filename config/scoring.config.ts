/**
 * Lead Scoring Configuration
 * Defines thresholds and weights for lead qualification
 */

export interface ScoringConfig {
  thresholds: {
    hot: number;
    warm: number;
    cold: number;
  };
  weights: {
    timeline: {
      immediate: number;
      shortTerm: number;
      mediumTerm: number;
      longTerm: number;
      browsing: number;
    };
    budget: {
      fullRange: number;
      partialRange: number;
      none: number;
      highValueBonus: number;
    };
    intent: {
      selfUse: number;
      investment: number;
      both: number;
      unclear: number;
    };
    urgency: {
      positiveSignals: number;
      negativeSignals: number;
    };
  };
  response: {
    windowMinutes: number;
    hotLeadCallWindowHours: number;
    warmLeadFollowupHours: number;
  };
}

export const defaultScoringConfig: ScoringConfig = {
  thresholds: {
    hot: Number(process.env.HOT_LEAD_THRESHOLD) || 70,
    warm: Number(process.env.WARM_LEAD_THRESHOLD) || 40,
    cold: 0
  },
  weights: {
    timeline: {
      immediate: 30,
      shortTerm: 20,
      mediumTerm: 5,
      longTerm: -10,
      browsing: -10
    },
    budget: {
      fullRange: 15,
      partialRange: 5,
      none: -15,
      highValueBonus: 10
    },
    intent: {
      selfUse: 20,
      investment: 25,
      both: 25,
      unclear: -20
    },
    urgency: {
      positiveSignals: 20,
      negativeSignals: -10
    }
  },
  response: {
    windowMinutes: Number(process.env.RESPONSE_WINDOW_MINUTES) || 2,
    hotLeadCallWindowHours: Number(process.env.HOT_LEAD_CALL_WINDOW_HOURS) || 2,
    warmLeadFollowupHours: Number(process.env.WARM_LEAD_FOLLOWUP_HOURS) || 48
  }
};

/**
 * Get current scoring configuration
 */
export function getScoringConfig(): ScoringConfig {
  return defaultScoringConfig;
}
