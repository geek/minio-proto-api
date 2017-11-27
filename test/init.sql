CREATE TABLE bridges (
  bridgeId CHAR(36) NOT NULL,
  container1Id CHAR(64) NULL,  -- The instances may need to be extracted to
  container2Id CHAR(64) NULL,  -- a separate table at a later time.
  accountId CHAR(36) NOT NULL,
  username VARCHAR(255) NOT NULL,
  namespace TEXT NOT NULL,
  sshKey TEXT NOT NULL,
  accessKey CHAR(36) NOT NULL,
  secretKey CHAR(36) NOT NULL,
  directoryMap TEXT NOT NULL,
  PRIMARY KEY (bridgeId)
);

CREATE TABLE accounts (
  accountId CHAR(36) NOT NULL,
  PRIMARY KEY (accountId)
);
