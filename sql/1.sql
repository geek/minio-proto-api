CREATE TABLE bridges (
  bridgeId CHAR(36) NOT NULL,
  container1Id CHAR(64) NULL,       -- The instances may need to be extracted to
  container2Id CHAR(64) NULL,       -- a separate table at a later time.
  accountId CHAR(36) NOT NULL,
  username VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,       -- name of bridge
  namespace TEXT NOT NULL,          -- s3 endpoint namespace
  sshKey TEXT NOT NULL,             -- private key
  sshKeyName VARCHAR(255) NOT NULL, -- name of public key stored on account
  sshKeyId VARCHAR(255) NOT NULL,   -- key id of public key
  accessKey CHAR(36) NOT NULL,      -- minio s3 access key
  secretKey CHAR(36) NOT NULL,      -- minio s3 secret
  directoryMap TEXT NOT NULL,       -- s3 bucket to manta directory mapping
  PRIMARY KEY (bridgeId)
);

CREATE TABLE accounts (
  accountId CHAR(36) NOT NULL,
  PRIMARY KEY (accountId)
);
