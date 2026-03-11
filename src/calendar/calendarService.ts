import { google, calendar_v3 } from 'googleapis';
import { logger } from '../utils/logger';
import dayjs from 'dayjs';

let authInstance: any = null;

/**
 * Parse and validate service account credentials
 */
function parseServiceAccountCredentials(): any {
  const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!jsonStr) {
    console.error('[GoogleAuth] GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable is required');
  }

  console.log('[GoogleAuth] Parsing GOOGLE_SERVICE_ACCOUNT_JSON...');

  try {
    const credentials = JSON.parse(jsonStr);

    if (!credentials.client_email) {
      throw new Error('Service account JSON missing client_email');
    }
    if (!credentials.private_key) {
      throw new Error('Service account JSON missing private_key');
    }

    console.log('[GoogleAuth] Service account credentials parsed successfully');
    console.log('[GoogleAuth] Service account email:', credentials.client_email);

    return credentials;
  } catch (error: any) {
    console.error('[GoogleAuth] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', error.message);
    throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${error.message}`);
  }
}

/**
 * Get cached Google Auth instance
 */
function getGoogleAuth() {
  if (!authInstance) {
    console.log('[GoogleAuth] Initializing Google Auth...');
    const credentials = parseServiceAccountCredentials();

    authInstance = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    });
    console.log('[GoogleAuth] Google Auth initialized successfully');
  }
  return authInstance;
}

/**
 * Get Google Calendar client
 */
export function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: getGoogleAuth() });
}

/**
 * Get Google Sheets client
 */
export function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}

/**
 * Create a calendar event for a lead call
 */
export async function createLeadCallEvent(options: {
  summary: string;
  description: string;
  startMinutesFromNow: number;
  durationMinutes: number;
}): Promise<string | undefined> {
  try {
    const calendar = getCalendarClient();

    const startTime = dayjs().add(options.startMinutesFromNow, 'minute').toISOString();
    const endTime = dayjs().add(options.startMinutesFromNow + options.durationMinutes, 'minute').toISOString();
    const timezone = process.env.AGENT_TIMEZONE || 'Asia/Kolkata';

    const event: calendar_v3.Schema$Event = {
      summary: options.summary,
      description: options.description,
      start: { dateTime: startTime, timeZone: timezone },
      end: { dateTime: endTime, timeZone: timezone },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 },
          { method: 'email', minutes: 30 },
        ],
      },
    };

    const result = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      requestBody: event,
    });

    logger.info('Calendar event created', { eventId: result.data.id });
    return result.data.id ?? undefined;
  } catch (error) {
    logger.error('Failed to create calendar event', { error });
    return undefined;
  }
}

/**
 * Create a callback event at a specific time
 */
export async function createCallbackEvent(options: {
  leadName: string;
  leadPhone: string;
  leadId: string;
  requestedTime: string;
}): Promise<string | undefined> {
  const requestedTime = dayjs(options.requestedTime);
  if (!requestedTime.isValid()) {
    logger.error('Invalid callback time format', { time: options.requestedTime });
    return undefined;
  }

  try {
    const calendar = getCalendarClient();
    const timezone = process.env.AGENT_TIMEZONE || 'Asia/Kolkata';

    const event: calendar_v3.Schema$Event = {
      summary: `📞 Callback: ${options.leadName}`,
      description: `Requested callback for ${options.leadName}\nPhone: ${options.leadPhone}\nReference: #${options.leadId.slice(0, 8)}`,
      start: { dateTime: requestedTime.toISOString(), timeZone: timezone },
      end: { dateTime: requestedTime.add(30, 'minute').toISOString(), timeZone: timezone },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 15 }],
      },
    };

    const result = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      requestBody: event,
    });

    logger.info('Callback event created', { eventId: result.data.id });
    return result.data.id ?? undefined;
  } catch (error) {
    logger.error('Failed to create callback event', { error });
    return undefined;
  }
}

/**
 * Reset auth (for testing)
 */
export function resetGoogleAuth(): void {
  authInstance = null;
}
