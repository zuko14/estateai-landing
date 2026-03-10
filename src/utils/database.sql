-- Leads table
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT CHECK (source IN ('99acres','magicbricks','housing','commonfloor','manual')),
  listing_id TEXT,
  property_type TEXT CHECK (property_type IN ('Plot','Apartment','Villa','Commercial')),
  location_preference TEXT,
  budget_min BIGINT,
  budget_max BIGINT,
  timeline TEXT,
  investment_intent TEXT,
  score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'New',
  assigned_agent TEXT,
  is_duplicate BOOLEAN DEFAULT false,
  is_opted_out BOOLEAN DEFAULT false,
  is_dnd BOOLEAN DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_contacted_at TIMESTAMPTZ
);

-- Messages table
CREATE TABLE messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  direction TEXT CHECK (direction IN ('inbound','outbound')),
  content TEXT,
  channel TEXT CHECK (channel IN ('whatsapp','sms','email')),
  status TEXT DEFAULT 'sent',
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Scheduled messages table (for drip campaigns and follow-ups)
CREATE TABLE scheduled_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Duplicate leads tracking table
CREATE TABLE duplicate_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  original_lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  duplicate_data JSONB,
  merged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups at 100+ leads/day
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_score ON leads(score);
CREATE INDEX idx_leads_created_at ON leads(created_at);
CREATE INDEX idx_messages_lead_id ON messages(lead_id);
CREATE INDEX idx_scheduled_messages_status ON scheduled_messages(status);
CREATE INDEX idx_scheduled_messages_scheduled_for ON scheduled_messages(scheduled_for);
CREATE INDEX idx_duplicate_leads_original ON duplicate_leads(original_lead_id);

-- Auto-update updated_at on lead changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Unique constraint to help with duplicate detection
CREATE UNIQUE INDEX idx_leads_phone_unique ON leads(phone) WHERE is_duplicate = false;
