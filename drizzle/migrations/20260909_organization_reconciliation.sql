ALTER TABLE organizations ADD COLUMN reconciliationStatus ENUM('matched','review') NOT NULL DEFAULT 'review';
ALTER TABLE organizations ADD COLUMN reconciliationNote TEXT NULL;
