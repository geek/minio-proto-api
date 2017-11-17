CREATE TABLE bridges (
  instanceId CHAR(36) NOT NULL,
  accountId CHAR(36) NOT NULL,
  username VARCHAR(255) NOT NULL,
  namespace TEXT NOT NULL,
  sshKey TEXT NOT NULL,
  accessKey CHAR(36) NOT NULL,
  secretKey CHAR(36) NOT NULL,
  directoryMap TEXT NOT NULL,
  PRIMARY KEY (instanceId)
);
