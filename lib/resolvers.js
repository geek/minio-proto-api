'use strict';

const Boom = require('boom');
const Bounce = require('bounce');
const Forge = require('node-forge');
const Keypair = require('keypair');
const Reach = require('reach');
const Uuid = require('uuid');
const Common = require('./common');
const Docker = require('./docker');


const Resolvers = {
  Query: {
    bridge: async (root, { id: bridgeId, name }, request) => {
      if (!bridgeId && name) {
        // get bridge by name
        const dbBridge = await getDbBridgeByName(name, request);
        return createBridgeFromDb(dbBridge);
      }

      const dbBridge = await getDbBridge(bridgeId, request);
      return createBridgeFromDb(dbBridge);
    },

    bridges: async (root, options, request) => {
      const sql = 'CALL list_bridges_by_account(?)';
      const pool = request.server.app.mysql;
      const accountId = Common.getAccountId(request);
      const args = [accountId];
      const [results] = await Common.doQuery(sql, args, pool);

      return results.map(createBridgeFromDb);
    }
  },
  Mutation: {
    createBridge: async (root, bridge, request) => {
      const keyData = await createSshKey(bridge, request);

      if (!keyData.sshKeyId) {
        throw Boom.internal(`Error creating key for bridge: ${bridge.name}`);
      }

      const dbBridge = await createDbBridge(bridge, keyData, request);

      // Creating the containers will take a while, perform SQL update after
      // the creation is done after the initial bridge data is inserted.
      setImmediate(async () => {
        let dockerBridge;
        try {
          dockerBridge = await Docker.createBridge(dbBridge, keyData);
          await addContainersToDbBridge(dockerBridge, dbBridge, request);
        } catch (ex) {
          request.server.log(['error', 'docker-create'], `message: ${ex.message} \n stack: ${ex.stack}`);
        }

        if (request.server.app.zoneId) {
          await setupDns(dockerBridge, dbBridge, request);
        }
      });

      return dbBridge;
    },

    deleteBridge: async (root, { id: bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);

      try {
        await request.plugins.cloudapi.deleteSshKey(dbBridge.sshKeyName);
      } catch (ex) {
        request.server.log(['error', 'delete-sshkey', 'cloudapi'], ex);
      }

      if (request.server.app.zoneId) {
        await deleteDns(dbBridge, request);
      }

      // Delete the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.deleteBridge(dbBridge.container1Id, dbBridge.container2Id);
        } catch (ex) {
          request.server.log(['error', 'docker-delete'], `message: ${ex.message} \n stack: ${ex.stack}`);
        }
      });

      return deleteDbBridge(bridgeId, request);
    },

    stopBridge: async (root, { id: bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);

      // Stop the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.stopBridge(dbBridge.container1Id, dbBridge.container2Id);
          await stopDbBridge(bridgeId, request);
        } catch (err) {
          request.server.log(['error', 'docker-stop'], err);
        }
      });

      return updateDbBridgeStatus(bridgeId, 'STOPPING', request);
    },

    resumeBridge: async (root, { id: bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);

      // Resume the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.resumeBridge(dbBridge.container1Id, dbBridge.container2Id);
          await resumeDbBridge(bridgeId, request);
        } catch (err) {
          request.server.log(['error', 'docker-resume'], err);
        }
      });

      return updateDbBridgeStatus(bridgeId, 'STARTING', request);
    }
  }
};

module.exports = Resolvers;

async function createDbBridge (bridge, keyData, request) {
  const sql = 'CALL create_bridge (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const pool = request.server.app.mysql;
  const bridgeId = Uuid.v4();
  const accountId = Common.getAccountId(request);
  const username = Common.getUsername(request);
  const { name, directoryMap } = bridge;
  const namespace = `${name}.${request.server.app.arecordParent}`;
  const { sshKey, sshKeyName, sshKeyId } = keyData;
  const args = [bridgeId, accountId, username, namespace, name, sshKey,
    sshKeyName, sshKeyId, directoryMap];
  const results = await Common.doQuery(sql, args, pool);

  // Sanity check. This should always be one.
  if (results.affectedRows !== 1) {
    throw Boom.internal(`Insertion affected ${results.affectedRows} bridges`);
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
  const pool = request.server.app.mysql;
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const [results] = await Common.doQuery(sql, args, pool);

  if (results.length === 0) {
    return null;
  }

  // Sanity check. This should always be one or zero.
  if (results.length > 1) {
    throw Boom.internal(`Found ${results.length} matching bridges`);
  }

  return results[0];
}


async function getDbBridgeByName (name, request) {
  const sql = 'CALL get_bridge_by_name(?, ?)';
  const pool = request.server.app.mysql;
  const accountId = Common.getAccountId(request);
  const args = [name, accountId];
  const [results] = await Common.doQuery(sql, args, pool);

  if (results.length === 0) {
    return null;
  }

  // Sanity check. This should always be one or zero.
  if (results.length > 1) {
    throw Boom.internal(`Found ${results.length} matching bridges`);
  }

  return results[0];
}


async function deleteDbBridge (bridgeId, request) {
  const sql = 'CALL delete_bridge(?, ?)';
  const pool = request.server.app.mysql;
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const results = await Common.doQuery(sql, args, pool);
  const affectedRows = Reach(results, '0.0.rows_deleted');

  // Sanity check. This should always be zero or one.
  if (affectedRows > 1) {
    throw Boom.internal(`Delete affected ${affectedRows} bridges`);
  }

  return !!affectedRows;
}


async function stopDbBridge (bridgeId, request) {
  const sql = 'CALL stop_bridge(?, ?)';
  const pool = request.server.app.mysql;
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const results = await Common.doQuery(sql, args, pool);
  const affectedRows = Reach(results, '0.0.rows_updated');

  // Sanity check. This should always be zero or one.
  if (affectedRows > 1) {
    throw Boom.internal(`Stop affected ${affectedRows} bridges`);
  }

  return !!affectedRows;
}


async function resumeDbBridge (bridgeId, request) {
  const sql = 'CALL resume_bridge(?, ?)';
  const pool = request.server.app.mysql;
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId];
  const results = await Common.doQuery(sql, args, pool);
  const affectedRows = Reach(results, '0.0.rows_updated');

  // Sanity check. This should always be zero or one.
  if (affectedRows > 1) {
    throw Boom.internal(`Stop affected ${affectedRows} bridges`);
  }

  return !!affectedRows;
}


async function updateDbBridgeStatus (bridgeId, status, request) {
  const sql = 'CALL update_bridge_status(?, ?, ?)';
  const pool = request.server.app.mysql;
  const accountId = Common.getAccountId(request);
  const args = [bridgeId, accountId, status];
  const results = await Common.doQuery(sql, args, pool);

  // Sanity check. This should always be zero or one.
  if (results.affectedRows > 1) {
    throw Boom.internal(`Update affected ${results.affectedRows} bridges`);
  }

  return !!results.affectedRows;
}


async function addContainersToDbBridge (dockerBridge, dbBridge, request) {
  const sql = 'CALL update_containers_in_bridge(?, ?, ?, ?)';
  const pool = request.server.app.mysql;
  const accountId = Common.getAccountId(request);
  const args = [dockerBridge[0].id, dockerBridge[1].id, dbBridge.bridgeId, accountId];
  const results = await Common.doQuery(sql, args, pool);
  const affectedRows = Reach(results, '0.0.rows_updated');

  // Sanity check. This should always be one.
  if (affectedRows !== 1) {
    throw Boom.internal(`Insertion affected ${affectedRows} bridges`);
  }
}


function createBridgeFromDb (row) {
  return row && {
    id: row.bridgeId,
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


async function setupDns ([container1, container2], { namespace }, request) {
  const container1Details = await container1.inspect();
  const container2Details = await container2.inspect();

  const container1Ip = Reach(container1Details, 'NetworkSettings.IPAddress');
  const container2Ip = Reach(container2Details, 'NetworkSettings.IPAddress');
  const cf = request.server.app.cloudflare;
  try {
    await cf.dnsRecords.add(request.server.app.zoneId, {
      type: 'A',
      name: namespace,
      content: container1Ip,
      ttl: 120
    });

    await cf.dnsRecords.add(request.server.app.zoneId, {
      type: 'A',
      name: namespace,
      content: container2Ip,
      ttl: 120
    });
  } catch (ex) {
    request.server.log(['error', 'cloudflare-create'], `message: ${ex.message} \n stack: ${ex.stack}`);
  }
}

async function deleteDns ({ namespace }, request) {
  const cf = request.server.app.cloudflare;
  try {
    const records = await cf.dnsRecords.browse(request.server.app.zoneId);
    for (const record of records.result) {
      if (record.name === namespace) {
        await cf.dnsRecords.del(request.server.app.zoneId, record.id);
      }
    }
  } catch (ex) {
    request.server.log(['error', 'cloudflare-delete'], `message: ${ex.message} \n stack: ${ex.stack}`);
  }
}
