// Test setup file
// Add global test configurations here

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.HOT_LEAD_THRESHOLD = '70';
process.env.WARM_LEAD_THRESHOLD = '40';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
process.env.GROQ_API_KEY = 'test-groq-key';
process.env.WHATSAPP_API_TOKEN = 'test-whatsapp-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '12345';
process.env.AGENT_NAME = 'Test Agent';
process.env.AGENT_PHONE = '+919999999999';

// Silence console logs during tests unless explicitly needed
if (process.env.SILENCE_LOGS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  };
}
