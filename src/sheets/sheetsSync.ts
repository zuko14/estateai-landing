import { Lead } from '../utils/lead.model';
import { getSheetsClient } from '../calendar/calendarService';
import { logger } from '../utils/logger';

// Batch queue for rate limiting
let batchQueue: Lead[] = [];
let batchTimeout: NodeJS.Timeout | null = null;
const BATCH_INTERVAL = Number(process.env.SHEETS_WRITE_BATCH_INTERVAL_MS || 5000);

/**
 * Format lead data as a spreadsheet row
 */
function leadToRow(lead: Lead): any[] {
  const budgetMin = lead.budgetMin ? `₹${(lead.budgetMin / 100000).toFixed(1)}L` : '';
  const budgetMax = lead.budgetMax ? `₹${(lead.budgetMax / 100000).toFixed(1)}L` : '';

  return [
    lead.id,
    lead.name,
    lead.phone,
    lead.source,
    lead.propertyType,
    lead.locationPreference,
    budgetMin,
    budgetMax,
    lead.timeline,
    lead.investmentIntent,
    lead.score.toString(),
    lead.status,
    lead.assignedAgent || '',
    lead.createdAt instanceof Date ? lead.createdAt.toISOString() : lead.createdAt,
    lead.lastContactedAt instanceof Date ? lead.lastContactedAt.toISOString() : (lead.lastContactedAt || ''),
    lead.tags.join(', '),
  ];
}

/**
 * Append single lead to Google Sheet
 */
export async function appendLeadToSheet(lead: Lead): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID not configured');
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Leads!A:P',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [leadToRow(lead)] },
  });

  logger.info('Lead appended to sheet', { leadId: lead.id });
}

/**
 * Update existing lead in Google Sheet
 */
export async function updateLeadInSheet(lead: Lead): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) return;

  try {
    // Find the row with matching ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Leads!A:A',
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === lead.id);

    if (rowIndex === -1) {
      logger.warn('Lead not found in sheet for update, appending instead', { leadId: lead.id });
      await appendLeadToSheet(lead);
      return;
    }

    // Update the full row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Leads!A${rowIndex + 1}:P${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [leadToRow(lead)] },
    });

    logger.info('Lead updated in sheet', { leadId: lead.id });
  } catch (error) {
    logger.error('Failed to update lead in sheet', { error, leadId: lead.id });
  }
}

/**
 * Add lead to batch queue for synced writing
 */
export async function syncBatch(leads: Lead[]): Promise<void> {
  batchQueue.push(...leads);

  // Clear existing timeout and set new one
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  batchTimeout = setTimeout(() => {
    processBatch();
  }, BATCH_INTERVAL);
}

/**
 * Process batch queue
 */
async function processBatch(): Promise<void> {
  if (batchQueue.length === 0) return;

  const batch = [...batchQueue];
  batchQueue = [];

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) return;

    const rows = batch.map(lead => leadToRow(lead));

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Leads!A:P',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    logger.info('Batch sync completed', { count: batch.length });
  } catch (error) {
    logger.error('Batch sync failed', { error, count: batch.length });
    // Re-queue failed leads for next batch
    batchQueue.unshift(...batch);
  }
}
