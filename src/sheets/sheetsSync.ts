import { Lead } from '../utils/lead.model';
import { getSheetsClient } from '../calendar/calendarService';
import { logger } from '../utils/logger';

// Batch queue for rate limiting
let batchQueue: Lead[] = [];
let batchTimeout: NodeJS.Timeout | null = null;
const BATCH_INTERVAL = Number(process.env.SHEETS_WRITE_BATCH_INTERVAL_MS || 5000);

/**
 * Validate Google Sheets configuration
 */
function validateConfig(): { valid: boolean; error?: string } {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!spreadsheetId) {
    return { valid: false, error: 'GOOGLE_SHEET_ID not configured' };
  }

  if (!serviceAccountJson) {
    return { valid: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' };
  }

  try {
    const credentials = JSON.parse(serviceAccountJson);
    if (!credentials.client_email || !credentials.private_key) {
      return { valid: false, error: 'Invalid service account JSON: missing client_email or private_key' };
    }
    console.log('[Sheets] Service account credentials validated for:', credentials.client_email);
  } catch (error) {
    return { valid: false, error: `Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${error}` };
  }

  return { valid: true };
}

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
  console.log('[Sheets] Attempting to sync lead to Google Sheets:', { leadId: lead.id, name: lead.name });

  const config = validateConfig();
  if (!config.valid) {
    console.error('[Sheets] Configuration error:', config.error);
    throw new Error(config.error);
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  console.log('[Sheets] Using spreadsheet ID:', spreadsheetId?.slice(0, 5) + '...');

  try {
    const sheets = getSheetsClient();
    console.log('[Sheets] Google Sheets client initialized');

    const row = leadToRow(lead);
    console.log('[Sheets] Lead data formatted, row length:', row.length);

    console.log('[Sheets] Calling Google Sheets API...');
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Leads!A:P',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    console.log('[Sheets] Google Sheets sync successful!');
    console.log('[Sheets] API Response - Updated range:', response.data.updates?.updatedRange);
    console.log('[Sheets] API Response - Updated rows:', response.data.updates?.updatedRows);

    logger.info('Lead appended to sheet', { leadId: lead.id, range: response.data.updates?.updatedRange });
  } catch (error: any) {
    console.error('[Sheets] Google Sheets sync failed with error:', error.message);
    console.error('[Sheets] Full error details:', error);

    if (error.response) {
      console.error('[Sheets] API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      });
    }

    logger.error('Failed to append lead to sheet', { error, leadId: lead.id });
    throw error;
  }
}

/**
 * Update existing lead in Google Sheet
 */
export async function updateLeadInSheet(lead: Lead): Promise<void> {
  console.log('[Sheets] Attempting to update lead in Google Sheets:', { leadId: lead.id, name: lead.name });

  const config = validateConfig();
  if (!config.valid) {
    console.error('[Sheets] Configuration error:', config.error);
    return;
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  try {
    const sheets = getSheetsClient();
    console.log('[Sheets] Searching for existing lead in sheet...');

    // Find the row with matching ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Leads!A:A',
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === lead.id);

    if (rowIndex === -1) {
      console.log('[Sheets] Lead not found in sheet, appending instead');
      logger.warn('Lead not found in sheet for update, appending instead', { leadId: lead.id });
      await appendLeadToSheet(lead);
      return;
    }

    console.log('[Sheets] Found lead at row:', rowIndex + 1);

    // Update the full row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Leads!A${rowIndex + 1}:P${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [leadToRow(lead)] },
    });

    console.log('[Sheets] Google Sheets update successful for row:', rowIndex + 1);
    logger.info('Lead updated in sheet', { leadId: lead.id, row: rowIndex + 1 });
  } catch (error: any) {
    console.error('[Sheets] Google Sheets update failed:', error.message);
    console.error('[Sheets] Full error details:', error);
    logger.error('Failed to update lead in sheet', { error, leadId: lead.id });
    throw error;
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
