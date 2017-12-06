CREATE TABLE IF NOT EXISTS bridges (
  bridgeId CHAR(36) NOT NULL,
  container1Id CHAR(64) DEFAULT NULL, -- The instances may need to be extracted to
  container2Id CHAR(64) DEFAULT NULL, -- a separate table at a later time.
  accountId CHAR(36) NOT NULL,
  username VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,         -- name of bridge
  namespace TEXT NULL,                -- s3 endpoint namespace
  sshKey TEXT NOT NULL,               -- private key
  sshKeyName VARCHAR(255) NOT NULL,   -- name of public key stored on account
  sshKeyId VARCHAR(255) NOT NULL,     -- key id of public key
  directoryMap TEXT NULL,             -- s3 bucket to manta directory mapping
  status ENUM('STARTING', 'RUNNING', 'STOPPING', 'STOPPED') NOT NULL,
  PRIMARY KEY (bridgeId)
);


CREATE TABLE IF NOT EXISTS bridge_usage (
  accountId CHAR(36) NOT NULL,
  bridgeId CHAR(36) NOT NULL,       -- bridge id cannot be a foreign key due to deletions
  started DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stopped DATETIME DEFAULT NULL,
  PRIMARY KEY (bridgeId, started),
  INDEX (accountId)
);


CREATE TABLE IF NOT EXISTS accounts (
  accountId CHAR(36) NOT NULL,
  PRIMARY KEY (accountId)
);


DROP PROCEDURE IF EXISTS does_account_exist;
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


DROP PROCEDURE IF EXISTS create_bridge;
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
  directory_map TEXT
)
BEGIN
  INSERT INTO bridges (bridgeId, accountId, username, namespace, name, sshKey,
                       sshKeyName, sshKeyId, directoryMap, status)
  VALUES (bridge_id, account_id, username, namespace, name, ssh_key,
          ssh_key_name, ssh_key_id, directory_map,
          'STARTING');
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS update_containers_in_bridge;
DELIMITER $$

CREATE PROCEDURE update_containers_in_bridge (
  container1 CHAR(64),
  container2 CHAR(64),
  bridge_id CHAR(36),
  account_id CHAR(36)
)
BEGIN
  DECLARE rows_updated INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
  END;

  START TRANSACTION;
    -- Associate the containers with the bridge.
    UPDATE bridges SET container1Id = container1, container2Id = container2,
                       status = 'RUNNING'
    WHERE bridgeId = bridge_id AND accountId = account_id AND status = 'STARTING';
    SELECT ROW_COUNT() INTO rows_updated;

    -- If a bridge was found, add a usage record.
    IF rows_updated > 0 THEN
      INSERT INTO bridge_usage (accountId, bridgeId)
      VALUES (account_id, bridge_id);
    END IF;

    SELECT rows_updated;
  COMMIT;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS get_bridge;
DELIMITER $$

CREATE PROCEDURE get_bridge (
  bridge_id CHAR(36),
  account_id CHAR(36)
)
BEGIN
  SELECT bridgeId, container1Id, container2Id, accountId, username, sshKeyName,
         sshKeyId, namespace, name, directoryMap, status
  FROM bridges WHERE bridgeId = bridge_id AND accountId = account_id;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS delete_bridge;
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
    -- Delete the bridge.
    DELETE FROM bridges WHERE bridgeId = bridge_id AND accountId = account_id;
    SELECT ROW_COUNT() INTO rows_deleted;

    -- If a bridge was found, update the usage record.
    IF rows_deleted > 0 THEN
      UPDATE bridge_usage SET stopped = CURRENT_TIMESTAMP()
      WHERE bridgeId = bridge_id AND accountId = account_id AND stopped IS NULL;
    END IF;

    SELECT rows_deleted;
  COMMIT;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS list_bridges_by_account;
DELIMITER $$

CREATE PROCEDURE list_bridges_by_account (
  account_id CHAR(36)
)
BEGIN
  SELECT bridgeId, container1Id, container2Id, accountId, username, sshKeyName,
         sshKeyId, namespace, name, directoryMap, status
  FROM bridges WHERE accountId = account_id;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS update_bridge_status;
DELIMITER $$

CREATE PROCEDURE update_bridge_status (
  bridge_id CHAR(36),
  account_id CHAR(36),
  new_status ENUM('STARTING', 'RUNNING', 'STOPPING', 'STOPPED')
)
BEGIN
  UPDATE bridges SET status = new_status
  WHERE bridgeId = bridge_id AND accountId = account_id;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS stop_bridge;
DELIMITER $$

CREATE PROCEDURE stop_bridge (
  bridge_id CHAR(36),
  account_id CHAR(36)
)
BEGIN
  DECLARE rows_updated INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
  END;

  START TRANSACTION;
    -- Set the bridge status to STOPPED.
    UPDATE bridges SET status = 'STOPPED'
    WHERE bridgeId = bridge_id AND accountId = account_id AND status = 'STOPPING';

    -- Get the number of rows that were updated.
    SELECT ROW_COUNT() INTO rows_updated;

    -- If a bridge was found, update the usage record.
    IF rows_updated > 0 THEN
      UPDATE bridge_usage SET stopped = CURRENT_TIMESTAMP()
      WHERE bridgeId = bridge_id AND accountId = account_id AND stopped IS NULL;
    END IF;

    SELECT rows_updated;
  COMMIT;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS resume_bridge;
DELIMITER $$

CREATE PROCEDURE resume_bridge (
  bridge_id CHAR(36),
  account_id CHAR(36)
)
BEGIN
  DECLARE rows_updated INT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
  END;

  START TRANSACTION;
    -- Set the bridge status to RUNNING.
    UPDATE bridges SET status = 'RUNNING'
    WHERE bridgeId = bridge_id AND accountId = account_id AND status = 'STOPPED';

    -- Get the number of rows that were updated.
    SELECT ROW_COUNT() INTO rows_updated;

    -- If a bridge was found, create a new usage record.
    IF rows_updated > 0 THEN
      INSERT INTO bridge_usage (accountId, bridgeId)
      VALUES (account_id, bridge_id);
    END IF;

    SELECT rows_updated;
  COMMIT;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS get_usage_by_account;
DELIMITER $$

CREATE PROCEDURE get_usage_by_account (
  account_id CHAR(36)
)
BEGIN
  SELECT * FROM bridge_usage WHERE accountId = account_id;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS delete_all_bridges_from_table;
DELIMITER $$

CREATE PROCEDURE delete_all_bridges_from_table ()
BEGIN
  DELETE FROM bridges;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS delete_all_accounts_from_table;
DELIMITER $$

CREATE PROCEDURE delete_all_accounts_from_table ()
BEGIN
  DELETE FROM accounts;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS delete_all_bridge_usage_from_table;
DELIMITER $$

CREATE PROCEDURE delete_all_bridge_usage_from_table ()
BEGIN
  DELETE FROM bridge_usage;
END$$

DELIMITER ;
