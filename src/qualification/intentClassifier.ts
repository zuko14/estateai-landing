import Groq from 'groq-sdk';
import { logger } from '../utils/logger';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface IntentClassification {
  timeline?: string;
  budget?: { min: number; max: number };
  investmentIntent?: string;
  urgencySignals?: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

/**
 * Classify intent from WhatsApp message using Groq AI
 */
export async function classifyIntent(message: string): Promise<IntentClassification> {
  try {
    const response = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL ?? 'llama3-8b-8192',
      messages: [
        {
          role: 'system',
          content: `You are a real estate lead qualification AI for the Indian property market.
Extract buying intent from WhatsApp messages. Respond in valid JSON only. No explanation.
JSON format:
{
  "timeline": "Immediate|1-3 months|3-6 months|6+ months|Browsing",
  "budget": { "min": number_in_INR, "max": number_in_INR },
  "investmentIntent": "Self-use|Investment|Both|Unclear",
  "urgencySignals": ["loan-approved"|"site-visited"|"ready-downpayment"|"first-inquiry"|"no-research"],
  "sentiment": "positive|neutral|negative"
}`
        },
        { role: 'user', content: message }
      ],
      max_tokens: 200,
      temperature: 0.1
    });

    const content = response.choices[0].message.content ?? '{}';

    try {
      const result = JSON.parse(content) as IntentClassification;
      logger.info('Intent classified successfully', { message: message.slice(0, 50), result });
      return result;
    } catch (parseError) {
      logger.error('Failed to parse Groq response', { content, error: parseError });
      return { sentiment: 'neutral' };
    }
  } catch (error) {
    logger.error('Groq API error', { error, message: message.slice(0, 50) });
    return { sentiment: 'neutral' };
  }
}

/**
 * Extract budget range from text
 */
export function extractBudgetFromText(text: string): { min?: number; max?: number } | undefined {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:lakh|lac|l)/i,
    /(\d+(?:\.\d+)?)\s*(?:crore|cr)/i,
    /(\d+(?:,\d{3})*)/g
  ];

  const numbers: number[] = [];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        let value = parseFloat(match.replace(/,/g, ''));
        const lowerText = text.toLowerCase();

        if (lowerText.includes('crore') || lowerText.includes('cr')) {
          value *= 10000000;
        } else if (lowerText.includes('lakh') || lowerText.includes('lac')) {
          value *= 100000;
        }

        if (!isNaN(value) && value > 100000) {
          numbers.push(value);
        }
      }
    }
  }

  if (numbers.length === 0) return undefined;
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };

  return {
    min: Math.min(...numbers),
    max: Math.max(...numbers)
  };
}
