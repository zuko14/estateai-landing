import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get singleton Supabase client instance
 * Reuses a single connection across the entire application
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    supabaseInstance = createClient(url, key);
    logger.info('Supabase client initialized');
  }

  return supabaseInstance;
}

/**
 * Reset client (useful for testing)
 */
export function resetSupabase(): void {
  supabaseInstance = null;
}
