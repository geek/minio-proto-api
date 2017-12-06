'use strict';

const Barrier = require('cb-barrier');
const Boom = require('boom');
const Bounce = require('bounce');
const Forge = require('node-forge');
const Keypair = require('keypair');
const Reach = require('reach');
const Uuid = require('uuid');
const Common = require('./common');
const Docker = require('./docker');


module.exports = {
  Query: {
    bridge: async (root, { bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);
      return createBridgeFromDb(dbBridge);
    },

    listBridgesByAccount: async (root, options, request) => {
      const sql = 'CALL list_bridges_by_account(?)';
      const accountId = Common.getAccountId(request);
      const args = [accountId];
      const [results] = await doQuery(sql, args, request);

      return results.map(createBridgeFromDb);
    }
  },
  Mutation: {
    createBridge: async (root, bridge, request) => {
      const keyData = await createSshKey(bridge, request);

      if (!keyData.sshKeyId) {
        return Boom.internal(`Error creating key for bridge: ${bridge.name}`);
      }

      const dbBridge = await createDbBridge(bridge, keyData, request);

      // Creating the containers will take a while, perform SQL update after
      // the creation is done after the initial bridge data is inserted.
      setImmediate(async () => {
        try {
          const dockerBridge = await Docker.createBridge(dbBridge, keyData);

          await addContainersToDbBridge(dockerBridge, dbBridge, request);
        } catch (ex) {
          request.server.log(['error', 'docker-create'], `message: ${ex.message} \n stack: ${ex.stack}`);
        }
      });

      return dbBridge;
    },

    deleteBridge: async (root, { bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);

      try {
        await request.plugins.cloudapi.deleteSshKey(dbBridge.sshKeyName);
      } catch (ex) {
        request.server.log(['error', 'delete-sshkey', 'cloudapi'], ex);
      }

      // Delete the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.deleteBridge(dbBridge.containerId);
        } catch (ex) {
          request.server.log(['error', 'docker-delete'], ex);
        }
      });

      return deleteDbBridge(bridgeId, request);
    },

    stopBridge: async (root, { bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);

      // Stop the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.stopBridge(dbBridge.containerId);
        } catch (err) {
          request.server.log(['error', 'docker-stop'], err);
        }

        try {
          await stopDbBridge(bridgeId, request);
        } catch (err) {
          request.server.log(['error', 'db-stop'], err);
        }
      });

      return updateDbBridgeStatus(bridgeId, 'STOPPING', request);
    },

    resumeBridge: async (root, { bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);

      // Resume the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.resumeBridge(dbBridge.containerId);
        } catch (err) {
          request.server.log(['error', 'docker-resume'], err);
        }

        try {
          await resumeDbBridge(bridgeId, request);
        } catch (err) {
          request.server.log(['error', 'db-resume'], err);
        }
      });

      return updateDbBridgeStatus(bridgeId, 'STARTING', request);
    }
  }
};


async function createDbBridge (bridge, keyData, request) {
  const sql = 'CALL create_bridge (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const bridgeId = Uuid.v4();
  const accountId = Common.getAccountId(request);
  const username = Common.getUsername(request);
  const { namespace, name, directoryMap } = bridge;
  const { sshKey, sshKeyName, sshKeyId } = keyData;
  const args = [bridgeId, accountId, username, namespace, name, sshKey,
    sshKeyName, sshKeyId, directoryMap];
  const results = await doQuery(sql, args, request);

  // Sanity check. This should always be one.
  if (results.affectedRows !== 1) {
    throw new Error(`Insertion affected ${results.affectedRows} bridges`);
  }

  return {
    bridgeId,
    accountId,
    username,
    sshKeyId,
    sshKeyName,
    namespace,
    name,
    directoryMap,
    status: 'STARTING'
  };
}


async function getDbBridge (bridgeId, request) {
  const sql = 'CALL get_bridge(?, ?)';
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const [results] = await doQuery(sql, args, request);

  if (results.length === 0) {
    return null;
  }

  // Sanity check. This should always be one or zero.
  if (results.length > 1) {
    throw new Error(`Found ${results.length} matching bridges`);
  }

  return results[0];
}


async function deleteDbBridge (bridgeId, request) {
  const sql = 'CALL delete_bridge(?, ?)';
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const results = await doQuery(sql, args, request);
  const affectedRows = Reach(results, '0.0.rows_deleted');

  // Sanity check. This should always be zero or one.
  if (affectedRows > 1) {
    throw new Error(`Delete affected ${affectedRows} bridges`);
  }

  return !!affectedRows;
}


async function stopDbBridge (bridgeId, request) {
  const sql = 'CALL stop_bridge(?, ?)';
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const results = await doQuery(sql, args, request);
  const affectedRows = Reach(results, '0.0.rows_updated');

  // Sanity check. This should always be zero or one.
  if (affectedRows > 1) {
    throw new Error(`Stop affected ${affectedRows} bridges`);
  }

  return !!affectedRows;
}


async function resumeDbBridge (bridgeId, request) {
  const sql = 'CALL resume_bridge(?, ?)';
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const results = await doQuery(sql, args, request);
  const affectedRows = Reach(results, '0.0.rows_updated');

  // Sanity check. This should always be zero or one.
  if (affectedRows > 1) {
    throw new Error(`Stop affected ${affectedRows} bridges`);
  }

  return !!affectedRows;
}


async function updateDbBridgeStatus (bridgeId, status, request) {
  const sql = 'CALL update_bridge_status(?, ?, ?)';
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId, status];
  const results = await doQuery(sql, args, request);

  // Sanity check. This should always be zero or one.
  if (results.affectedRows > 1) {
    throw new Error(`Update affected ${results.affectedRows} bridges`);
  }

  return !!results.affectedRows;
}


async function addContainersToDbBridge (dockerBridge, dbBridge, request) {
  const sql = 'CALL update_containers_in_bridge(?, ?, ?, ?)';
  const accountId = Common.getAccountId(request);
  const args = [dockerBridge[0].id, dockerBridge[1].id, dbBridge.bridgeId, accountId];
  const results = await doQuery(sql, args, request);
  const affectedRows = Reach(results, '0.0.rows_updated');

  // Sanity check. This should always be one.
  if (affectedRows !== 1) {
    throw new Error(`Insertion affected ${affectedRows} bridges`);
  }
}


function doQuery (sql, args, request) {
  const pool = request.server.app.mysql;
  const barrier = new Barrier();

  pool.query(sql, args, (err, results) => {
    if (err) {
      return barrier.pass(err);
    }

    barrier.pass(results);
  });

  return barrier;
}


function createBridgeFromDb (row) {
  return {
    bridgeId: row.bridgeId,
    accountId: row.accountId,
    username: row.username,
    sshKeyId: row.sshKeyId,
    sshKeyName: row.sshKeyName,
    namespace: row.namespace,
    name: row.name,
    directoryMap: row.directoryMap,
    status: row.status
  };
}


async function createSshKey (bridge, request) {
  const cloudapi = request.plugins.cloudapi;

  const pair = Keypair();
  const sshKeyName = `${bridge.name}-bridge`;
  const publicKey = Forge.pki.publicKeyFromPem(pair.public);
  const sshPublic = Forge.ssh.publicKeyToOpenSSH(publicKey, Common.getEmail(request));
  const privateKey = Forge.pki.privateKeyFromPem(pair.private);
  const sshPrivate = Forge.ssh.privateKeyToOpenSSH(privateKey);

  let sshKeyId;
  try {
    const createRes = await cloudapi.createSshKey(sshKeyName, sshPublic);
    sshKeyId = createRes.fingerprint;
  } catch (ex) {
    Bounce.rethrow(ex, 'system');
    request.log(['create-key', 'error'], ex);
  }

  return {
    sshKeyName,
    sshKeyId,
    sshKey: sshPrivate.replace(/\n/g, '#')
  };
}
