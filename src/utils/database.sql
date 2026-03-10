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
  lead_id UUID REFERENCES leads(id),
  direction TEXT CHECK (direction IN ('inbound','outbound')),
  content TEXT,
  channel TEXT CHECK (channel IN ('whatsapp','sms','email')),
  status TEXT DEFAULT 'sent',
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups at 100+ leads/day
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_score ON leads(score);
