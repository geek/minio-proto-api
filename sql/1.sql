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


CREATE TABLE bridge_usage (
  accountId CHAR(36) NOT NULL,
  bridgeId CHAR(36) NOT NULL,       -- bridge id cannot be a foreign key due to deletions
  created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted DATETIME NULL,
  PRIMARY KEY (bridgeId),
  INDEX (accountId)
);


CREATE TABLE accounts (
  accountId CHAR(36) NOT NULL,
  PRIMARY KEY (accountId)
);


DELIMITER $$

CREATE PROCEDURE does_account_exist (
  account_id CHAR(36)
)
BEGIN
  -- According to Stack Overflow, this is a fast way to check existence.
  -- https://stackoverflow.com/questions/1676551/best-way-to-test-if-a-row-exists-in-a-mysql-table
  SELECT EXISTS(SELECT 1 FROM accounts WHERE accountId = account_id LIMIT 1);
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE create_bridge (
  bridge_id CHAR(36),
  account_id CHAR(36),
  username VARCHAR(255),
  namespace TEXT,
  name VARCHAR(255),
  ssh_key TEXT,
  ssh_key_name VARCHAR(255),
  ssh_key_id VARCHAR(255),
  access_key CHAR(36),
  secret_key CHAR(36),
  directory_map TEXT
)
BEGIN
  INSERT INTO bridges (bridgeId, accountId, username, namespace, name, sshKey,
                       sshKeyName, sshKeyId, accessKey, secretKey, directoryMap)
  VALUES (bridge_id, account_id, username, namespace, name, ssh_key,
          ssh_key_name, ssh_key_id, access_key, secret_key, directory_map);
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE update_containers_in_bridge (
  container1 CHAR(64),
  container2 CHAR(64),
  bridge_id CHAR(36)
)
BEGIN
  DECLARE account_id CHAR(36);
  DECLARE rows_updated INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
  END;

  START TRANSACTION;
    -- Get the account associated with the bridge.
    SELECT accountId INTO account_id FROM bridges
    WHERE bridgeId = bridge_id;

    -- Add the usage data.
    INSERT INTO bridge_usage (accountId, bridgeId)
    VALUES (account_id, bridge_id);

    -- Associate the containers with the bridge.
    UPDATE bridges SET container1Id = container1, container2Id = container2
    WHERE bridgeId = bridge_id;
    SELECT ROW_COUNT() INTO rows_updated;

    SELECT rows_updated;
  COMMIT;
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE get_bridge (
  bridge_id CHAR(36),
  account_id CHAR(36)
)
BEGIN
  SELECT bridgeId, container1Id, container2Id, accountId, username, sshKeyName,
         sshKeyId, namespace, name, directoryMap
  FROM bridges WHERE bridgeId = bridge_id AND accountId = account_id;
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE delete_bridge (
  bridge_id CHAR(36),
  account_id CHAR(36)
)
BEGIN
  DECLARE rows_deleted INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
  END;

  START TRANSACTION;
    DELETE FROM bridges WHERE bridgeId = bridge_id AND accountId = account_id;
    SELECT ROW_COUNT() INTO rows_deleted;

    UPDATE bridge_usage SET deleted = CURRENT_TIMESTAMP()
    WHERE bridgeId = bridge_id;

    SELECT rows_deleted;
  COMMIT;
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE list_bridges_by_account (
  account_id CHAR(36)
)
BEGIN
  SELECT bridgeId, container1Id, container2Id, accountId, username, sshKeyName,
         sshKeyId, namespace, name, directoryMap
  FROM bridges WHERE accountId = account_id;
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE get_usage_by_account (
  account_id CHAR(36)
)
BEGIN
  SELECT * FROM bridge_usage WHERE accountId = account_id;
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE delete_all_bridges_from_table ()
BEGIN
  DELETE FROM bridges;
END$$

DELIMITER ;


DELIMITER $$

CREATE PROCEDURE delete_all_accounts_from_table ()
BEGIN
  DELETE FROM accounts;
END$$

DELIMITER ;
