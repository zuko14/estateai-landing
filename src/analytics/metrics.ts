import { getSupabase } from '../utils/database';
import { getSheetsClient } from '../calendar/calendarService';
import { logger } from '../utils/logger';
import dayjs from 'dayjs';
import cron from 'node-cron';

export interface DashboardMetrics {
  today: {
    totalLeads: number;
    hotLeads: number;
    warmLeads: number;
    coldLeads: number;
  };
  conversionBySource: {
    '99acres': number;
    magicbricks: number;
    housing: number;
    commonfloor: number;
  };
  avgResponseTimeMinutes: number;
  hotLeadAccuracyPercent: number;
  weeklyLeadVolume: number[];
  topPerformingSource: string;
  campaignEngagementRate: number;
}

/**
 * Generate daily analytics report
 * Runs every midnight via node-cron
 */
export async function generateDailyReport(): Promise<void> {
  const supabase = getSupabase();

  try {
    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');

    // Get today's leads
    const { data: todayLeads } = await supabase
      .from('leads')
      .select('*')
      .gte('created_at', `${today}T00:00:00Z`)
      .lt('created_at', `${dayjs().add(1, 'day').format('YYYY-MM-DD')}T00:00:00Z`);

    // Calculate metrics
    const metrics: DashboardMetrics = {
      today: {
        totalLeads: todayLeads?.length || 0,
        hotLeads: todayLeads?.filter(l => l.status === 'Hot').length || 0,
        warmLeads: todayLeads?.filter(l => l.status === 'Warm').length || 0,
        coldLeads: todayLeads?.filter(l => l.status === 'Cold').length || 0,
      },
      conversionBySource: {
        '99acres': 0,
        magicbricks: 0,
        housing: 0,
        commonfloor: 0,
      },
      avgResponseTimeMinutes: 0,
      hotLeadAccuracyPercent: 0,
      weeklyLeadVolume: [],
      topPerformingSource: '',
      campaignEngagementRate: 0,
    };

    // Calculate conversion by source
    const sources = ['99acres', 'magicbricks', 'housing', 'commonfloor'] as const;
    for (const source of sources) {
      const { data: sourceLeads } = await supabase
        .from('leads')
        .select('status')
        .eq('source', source)
        .gte('created_at', `${yesterday}T00:00:00Z`);

      const total = sourceLeads?.length || 0;
      const converted = sourceLeads?.filter(l =>
        l.status === 'Hot' || l.status === 'Converted'
      ).length || 0;

      metrics.conversionBySource[source] = total > 0
        ? Math.round((converted / total) * 100)
        : 0;
    }

    // Get weekly volume
    for (let i = 6; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      const { count } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', `${date}T00:00:00Z`)
        .lt('created_at', `${dayjs(date).add(1, 'day').format('YYYY-MM-DD')}T00:00:00Z`);
      metrics.weeklyLeadVolume.push(count || 0);
    }

    // Calculate average response time
    const { data: respondedLeads } = await supabase
      .from('leads')
      .select('created_at, last_contacted_at')
      .not('last_contacted_at', 'is', null)
      .gte('created_at', `${yesterday}T00:00:00Z`);

    if (respondedLeads && respondedLeads.length > 0) {
      const totalResponseTime = respondedLeads.reduce((sum, lead) => {
        const created = dayjs(lead.created_at);
        const contacted = dayjs(lead.last_contacted_at);
        return sum + contacted.diff(created, 'minute');
      }, 0);
      metrics.avgResponseTimeMinutes = Math.round(totalResponseTime / respondedLeads.length);
    }

    // Top performing source
    const sourcePerformance = Object.entries(metrics.conversionBySource);
    const topSource = sourcePerformance.sort((a, b) => b[1] - a[1])[0];
    metrics.topPerformingSource = topSource ? topSource[0] : 'N/A';

    // Write to Google Sheets Analytics tab
    await writeToAnalyticsSheet(metrics, today);

    logger.info('Daily report generated', { date: today, metrics: metrics.today });
  } catch (error) {
    logger.error('Failed to generate daily report', { error });
  }
}

/**
 * Write metrics to Analytics tab in Google Sheets
 */
async function writeToAnalyticsSheet(
  metrics: DashboardMetrics,
  date: string
): Promise<void> {
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) return;

    const rows = [
      ['Daily Report', date],
      [],
      ['Metric', 'Value'],
      ['Total Leads', metrics.today.totalLeads],
      ['Hot Leads', metrics.today.hotLeads],
      ['Warm Leads', metrics.today.warmLeads],
      ['Cold Leads', metrics.today.coldLeads],
      ['Avg Response Time', `${metrics.avgResponseTimeMinutes} min`],
      [],
      ['Source', 'Conversion %'],
      ['99acres', `${metrics.conversionBySource['99acres']}%`],
      ['MagicBricks', `${metrics.conversionBySource.magicbricks}%`],
      ['Housing.com', `${metrics.conversionBySource.housing}%`],
      ['CommonFloor', `${metrics.conversionBySource.commonfloor}%`],
      [],
      ['Day', 'Leads'],
      ['6 days ago', metrics.weeklyLeadVolume[0]],
      ['5 days ago', metrics.weeklyLeadVolume[1]],
      ['4 days ago', metrics.weeklyLeadVolume[2]],
      ['3 days ago', metrics.weeklyLeadVolume[3]],
      ['2 days ago', metrics.weeklyLeadVolume[4]],
      ['Yesterday', metrics.weeklyLeadVolume[5]],
      ['Today', metrics.weeklyLeadVolume[6]],
      [],
      ['Top Source', metrics.topPerformingSource],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Analytics!A:B',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });

    logger.info('Analytics written to sheet', { date });
  } catch (error) {
    logger.error('Failed to write analytics', { error });
  }
}

/**
 * Get real-time metrics for dashboard
 */
export async function getRealTimeMetrics(): Promise<Partial<DashboardMetrics>> {
  const supabase = getSupabase();
  const today = dayjs().format('YYYY-MM-DD');

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .gte('created_at', `${today}T00:00:00Z`);

  return {
    today: {
      totalLeads: leads?.length || 0,
      hotLeads: leads?.filter(l => l.status === 'Hot').length || 0,
      warmLeads: leads?.filter(l => l.status === 'Warm').length || 0,
      coldLeads: leads?.filter(l => l.status === 'Cold').length || 0,
    },
  };
}

/**
 * Initialize analytics cron job
 */
export function initializeAnalyticsCron(): void {
  // Run daily at midnight
  cron.schedule('0 0 * * *', () => {
    logger.info('Running daily analytics report');
    generateDailyReport().catch(error => {
      logger.error('Analytics cron job failed', { error });
    });
  });

  logger.info('Analytics cron initialized');
}
