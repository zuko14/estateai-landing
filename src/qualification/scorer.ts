import { Lead, ScoreBreakdown } from '../utils/lead.model';
import { getScoringConfig } from '../../config/scoring.config';

/**
 * Calculate lead score based on qualification criteria
 * Uses configurable weights from scoring.config.ts
 */
export function scoreLead(lead: Lead): ScoreBreakdown {
  const config = getScoringConfig();
  let timeline = 0;
  let budgetClarity = 0;
  let investmentIntent = 0;
  let urgencySignals = 0;

  // Timeline scoring (using config weights)
  switch (lead.timeline) {
    case 'Immediate':    timeline = config.weights.timeline.immediate;   break;
    case '1-3 months':  timeline = config.weights.timeline.shortTerm;   break;
    case '3-6 months':  timeline = config.weights.timeline.mediumTerm;  break;
    case '6+ months':   timeline = config.weights.timeline.longTerm;    break;
    case 'Browsing':    timeline = config.weights.timeline.browsing;    break;
  }

  // Budget clarity scoring
  if (lead.budgetMin && lead.budgetMax) {
    budgetClarity = lead.budgetMax >= 5000000
      ? config.weights.budget.fullRange + config.weights.budget.highValueBonus
      : config.weights.budget.fullRange;
  } else if (lead.budgetMin || lead.budgetMax) {
    budgetClarity = config.weights.budget.partialRange;
  } else {
    budgetClarity = config.weights.budget.none;
  }

  // Investment intent scoring
  switch (lead.investmentIntent) {
    case 'Self-use':   investmentIntent = config.weights.intent.selfUse;     break;
    case 'Investment': investmentIntent = config.weights.intent.investment;  break;
    case 'Both':       investmentIntent = config.weights.intent.both;        break;
    case 'Unclear':    investmentIntent = config.weights.intent.unclear;     break;
  }

  // Urgency signals from tags
  const urgencyTags = ['loan-approved', 'site-visited', 'ready-downpayment'];
  const coldTags = ['first-inquiry', 'no-research'];

  if (lead.tags.some(t => urgencyTags.includes(t))) {
    urgencySignals = config.weights.urgency.positiveSignals;
  } else if (lead.tags.some(t => coldTags.includes(t))) {
    urgencySignals = config.weights.urgency.negativeSignals;
  }

  // Calculate total score (clamp between 0-100)
  const total = Math.max(0, Math.min(100,
    timeline + budgetClarity + investmentIntent + urgencySignals
  ));

  // Classify lead using config thresholds
  const classification: 'Hot' | 'Warm' | 'Cold' =
    total >= config.thresholds.hot ? 'Hot' :
    total >= config.thresholds.warm ? 'Warm' : 'Cold';

  return {
    timeline,
    budgetClarity,
    investmentIntent,
    urgencySignals,
    total,
    classification,
  };
}

/**
 * Get score factors as a readable string
 */
export function getScoreFactors(breakdown: ScoreBreakdown): string {
  const factors: string[] = [];
  if (breakdown.timeline > 0) factors.push(`Timeline (+${breakdown.timeline})`);
  if (breakdown.timeline < 0) factors.push(`Timeline (${breakdown.timeline})`);
  if (breakdown.budgetClarity > 0) factors.push(`Budget (+${breakdown.budgetClarity})`);
  if (breakdown.budgetClarity < 0) factors.push(`Budget (${breakdown.budgetClarity})`);
  if (breakdown.investmentIntent > 0) factors.push(`Intent (+${breakdown.investmentIntent})`);
  if (breakdown.investmentIntent < 0) factors.push(`Intent (${breakdown.investmentIntent})`);
  if (breakdown.urgencySignals !== 0) factors.push(`Urgency (${breakdown.urgencySignals > 0 ? '+' : ''}${breakdown.urgencySignals})`);
  return factors.join(' | ');
}
