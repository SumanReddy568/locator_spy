-- Schema for Cloudflare D1 (SQLite) or generic SQL
-- Stores logs pushed from the Locator Spy extension and other products

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product TEXT NOT NULL,       -- e.g. 'locator_spy'
    log_type TEXT NOT NULL,      -- e.g. 'info', 'error', 'debug'
    user_id TEXT,                -- e.g. 'user_123' or 'anonymous'
    message TEXT NOT NULL,       -- Log message description
    extra_data TEXT,             -- JSON string containing locators, metadata, system info
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster filtering by product and type
CREATE INDEX IF NOT EXISTS idx_logs_product_type ON logs(product, log_type);

-- Index for querying by user
CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);

-- Index by date for timeline views
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
