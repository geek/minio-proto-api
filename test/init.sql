CREATE TABLE bridges (
  bridgeId CHAR(36) NOT NULL,
  instance1Id CHAR(36) NOT NULL,  -- The instances may need to be extracted to
  instance2Id CHAR(36) NOT NULL,  -- a separate table at a later time.
  accountId CHAR(36) NOT NULL,
  username VARCHAR(255) NOT NULL,
  namespace TEXT NOT NULL,
  sshKey TEXT NOT NULL,
  accessKey CHAR(36) NOT NULL,
  secretKey CHAR(36) NOT NULL,
  directoryMap TEXT NOT NULL,
  PRIMARY KEY (bridgeId)
);
