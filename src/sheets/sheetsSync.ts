import { Lead } from '../utils/lead.model';
import { getSheetsClient } from '../calendar/calendarService';
import { logger } from '../utils/logger';

const HEADERS = [
  'ID', 'Name', 'Phone', 'Source', 'Property Type',
  'Location', 'Budget Min', 'Budget Max', 'Timeline',
  'Intent', 'Score', 'Status', 'Agent', 'Created At',
  'Last Contacted', 'Tags'
];

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
    lead.propertyType || '',
    lead.locationPreference || '',
    budgetMin,
    budgetMax,
    lead.timeline || '',
    lead.investmentIntent || '',
    lead.score.toString(),
    lead.status,
    lead.assignedAgent || '',
    lead.createdAt instanceof Date ? lead.createdAt.toISOString() : (lead.createdAt || ''),
    lead.lastContactedAt instanceof Date ? lead.lastContactedAt.toISOString() : (lead.lastContactedAt || ''),
    (lead.tags || []).join(', '),
  ];
}

/**
 * Ensure headers exist in row 1
 */
async function ensureHeaders(sheets: any, spreadsheetId: string): Promise<void> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Leads!A1:P1',
    });

    const firstRow = response.data.values?.[0];
    if (!firstRow || firstRow[0] !== 'ID') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Leads!A1:P1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADERS] },
      });
      console.log('[Sheets] Headers written to row 1');
    }
  } catch (error) {
    console.error('[Sheets] Failed to ensure headers:', error);
  }
}

/**
 * Find row index of a lead by ID
 * Returns -1 if not found
 */
async function findLeadRow(sheets: any, spreadsheetId: string, leadId: string): Promise<number> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Leads!A:A',
  });

  const rows = response.data.values || [];
  const rowIndex = rows.findIndex((row: any[]) => row[0] === leadId);
  return rowIndex; // 0-based index, row 0 = headers
}

/**
 * Append or update lead in Google Sheet
 * - If lead ID already exists → update that row
 * - If lead ID not found → append new row
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

    // Ensure headers exist
    await ensureHeaders(sheets, spreadsheetId!);

    const row = leadToRow(lead);
    console.log('[Sheets] Lead data formatted, row length:', row.length);

    // Check if lead already exists
    const existingRowIndex = await findLeadRow(sheets, spreadsheetId!, lead.id);

    if (existingRowIndex > 0) {
      // Update existing row (rowIndex is 0-based, sheets are 1-based, +1 for header)
      const sheetRow = existingRowIndex + 1;
      console.log('[Sheets] Lead already exists at row:', sheetRow, '— updating');

      const response = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Leads!A${sheetRow}:P${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });

      console.log('[Sheets] Google Sheets update successful!');
      console.log('[Sheets] API Response - Updated range:', response.data.updatedRange);
      logger.info('Lead updated in sheet', { leadId: lead.id, row: sheetRow });

    } else {
      // Append new row
      console.log('[Sheets] Lead not found — appending new row');
      console.log('[Sheets] Calling Google Sheets API...');

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Leads!A:P',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });

      console.log('[Sheets] Google Sheets sync successful!');
      console.log('[Sheets] API Response - Updated range:', response.data.updates?.updatedRange);
      console.log('[Sheets] API Response - Updated rows:', response.data.updates?.updatedRows);
      logger.info('Lead appended to sheet', { leadId: lead.id, range: response.data.updates?.updatedRange });
    }

  } catch (error: any) {
    console.error('[Sheets] Google Sheets sync failed with error:', error.message);
    if (error.response) {
      console.error('[Sheets] API Error Response:', {
        status: error.response.status,
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
  await appendLeadToSheet(lead);
}

/**
 * Add lead to batch queue for synced writing
 */
let batchQueue: Lead[] = [];
let batchTimeout: NodeJS.Timeout | null = null;
const BATCH_INTERVAL = Number(process.env.SHEETS_WRITE_BATCH_INTERVAL_MS || 5000);

export async function syncBatch(leads: Lead[]): Promise<void> {
  batchQueue.push(...leads);

  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  batchTimeout = setTimeout(() => {
    processBatch();
  }, BATCH_INTERVAL);
}

async function processBatch(): Promise<void> {
  if (batchQueue.length === 0) return;

  const batch = [...batchQueue];
  batchQueue = [];

  try {
    for (const lead of batch) {
      await appendLeadToSheet(lead);
    }
    logger.info('Batch sync completed', { count: batch.length });
  } catch (error) {
    logger.error('Batch sync failed', { error, count: batch.length });
    batchQueue.unshift(...batch);
  }
}