ALTER TABLE organizations ADD COLUMN clientId varchar(64) NULL;
CREATE INDEX organizations_client_id_status_idx ON organizations (clientId, status);
