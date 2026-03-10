import { Lead, ScoreBreakdown } from '../utils/lead.model';

/**
 * Calculate lead score based on qualification criteria
 */
export function scoreLead(lead: Lead): ScoreBreakdown {
  let timeline = 0;
  let budgetClarity = 0;
  let investmentIntent = 0;
  let urgencySignals = 0;

  // Timeline scoring
  switch (lead.timeline) {
    case 'Immediate':    timeline = 30;  break;
    case '1-3 months':  timeline = 20;  break;
    case '3-6 months':  timeline = 5;   break;
    case '6+ months':   timeline = -10; break;
    case 'Browsing':    timeline = -10; break;
  }

  // Budget clarity scoring
  if (lead.budgetMin && lead.budgetMax) {
    budgetClarity = lead.budgetMax >= 5000000 ? 25 : 15;
  } else if (lead.budgetMin || lead.budgetMax) {
    budgetClarity = 5;
  } else {
    budgetClarity = -15;
  }

  // Investment intent scoring
  switch (lead.investmentIntent) {
    case 'Self-use':   investmentIntent = 20;  break;
    case 'Investment': investmentIntent = 25;  break;
    case 'Both':       investmentIntent = 25;  break;
    case 'Unclear':    investmentIntent = -20; break;
  }

  // Urgency signals from tags
  const urgencyTags = ['loan-approved', 'site-visited', 'ready-downpayment'];
  const coldTags = ['first-inquiry', 'no-research'];

  if (lead.tags.some(t => urgencyTags.includes(t))) {
    urgencySignals = 20;
  } else if (lead.tags.some(t => coldTags.includes(t))) {
    urgencySignals = -10;
  }

  // Calculate total score (clamp between 0-100)
  const total = Math.max(0, Math.min(100,
    timeline + budgetClarity + investmentIntent + urgencySignals
  ));

  // Get thresholds from environment
  const hotThreshold = Number(process.env.HOT_LEAD_THRESHOLD ?? 70);
  const warmThreshold = Number(process.env.WARM_LEAD_THRESHOLD ?? 40);

  // Classify lead
  const classification: 'Hot' | 'Warm' | 'Cold' =
    total >= hotThreshold ? 'Hot' :
    total >= warmThreshold ? 'Warm' : 'Cold';

  return {
    timeline,
    budgetClarity,
    investmentIntent,
    urgencySignals,
    total,
    classification
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
