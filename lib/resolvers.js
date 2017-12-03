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
    bridge: async (root, { bridgeId }, request) => { // eslint-disable-line require-await
      const dbBridge = await getDbBridge(bridgeId, request);
      return createBridgeFromDb(dbBridge);
    },

    listBridgesByAccount: async (root, options, request) => { // eslint-disable-line require-await
      const sql = 'CALL list_bridges_by_account(?)';
      const accountId = Common.getAccountId(request);
      const pool = request.server.app.mysql;
      const barrier = new Barrier();

      pool.query(sql, [accountId], (err, results, fields) => {
        if (err) {
          return barrier.pass(err);
        }

        results = results[0];
        barrier.pass(results.map(createBridgeFromDb));
      });

      return barrier;
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
          const { accountId, bridgeId } = dbBridge;
          const dockerBridge = await Docker.createBridge({accountId, bridgeId, ...bridge });

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
    }
  }
};


function createDbBridge (bridge, keyData, request) {
  const sql = 'CALL create_bridge (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const pool = request.server.app.mysql;
  const barrier = new Barrier();
  const bridgeId = Uuid.v4();
  const accountId = Common.getAccountId(request);
  const username = Common.getUsername(request);
  const { namespace, name, accessKey, secretKey, directoryMap } = bridge;
  const { sshKey, sshKeyName, sshKeyId } = keyData;
  const args = [bridgeId, accountId, username, namespace, name, sshKey,
    sshKeyName, sshKeyId, accessKey, secretKey, directoryMap];

  pool.query(sql, args, (err, results, fields) => {
    if (err) {
      return barrier.pass(err);
    }

    // Sanity check. This should always be one.
    if (results.affectedRows !== 1) {
      return barrier.pass(new Error(`Insertion affected ${results.affectedRows} bridges`));
    }

    barrier.pass({
      bridgeId,
      accountId,
      username,
      sshKeyId,
      sshKeyName,
      namespace,
      name,
      directoryMap
    });
  });

  return barrier;
}


function getDbBridge (bridgeId, request) {
  const sql = 'CALL get_bridge(?, ?)';
  const accountId = Common.getAccountId(request);
  const pool = request.server.app.mysql;
  const barrier = new Barrier();

  pool.query(sql, [bridgeId, accountId], (err, results, fields) => {
    if (err) {
      return barrier.pass(err);
    }

    results = results[0];

    if (results.length === 0) {
      return barrier.pass(null);
    }

    // Sanity check. This should always be one or zero.
    if (results.length > 1) {
      return barrier.pass(new Error(`Found ${results.length} matching bridges`));
    }

    barrier.pass(results[0]);
  });

  return barrier;
}


function deleteDbBridge (bridgeId, request) {
  const sql = 'CALL delete_bridge(?, ?)';
  const accountId = Common.getAccountId(request);
  const pool = request.server.app.mysql;
  const barrier = new Barrier();

  pool.query(sql, [bridgeId, accountId], (err, results, fields) => {
    if (err) {
      return barrier.pass(err);
    }

    // Sanity check. This should always be zero or one.
    const affectedRows = Reach(results, '0.0.rows_deleted');

    if (affectedRows > 1) {
      return barrier.pass(new Error(`Delete affected ${affectedRows} bridges`));
    }

    barrier.pass(!!affectedRows);
  });

  return barrier;
}


function addContainersToDbBridge (dockerBridge, dbBridge, request) {
  const sql = 'CALL update_containers_in_bridge(?, ?, ?)';
  const pool = request.server.app.mysql;
  const barrier = new Barrier();
  const args = [dockerBridge[0].id, dockerBridge[1].id, dbBridge.bridgeId];

  pool.query(sql, args, (err, results) => {
    if (err) {
      return barrier.pass(err);
    }

    const affectedRows = Reach(results, '0.0.rows_updated');

    if (affectedRows !== 1) {
      return barrier.pass(new Error(`Insertion affected ${affectedRows} bridges`));
    }

    barrier.pass();
  });

  return barrier;
}


function createBridgeFromDb (row) {
  return {
    bridgeId: row.bridgeId,
    containerId: [row.container1Id, row.container2Id],
    accountId: row.accountId,
    username: row.username,
    sshKeyId: row.sshKeyId,
    sshKeyName: row.sshKeyName,
    namespace: row.namespace,
    name: row.name,
    directoryMap: row.directoryMap
  };
}


async function createSshKey (bridge, request) {
  const cloudapi = request.plugins.cloudapi;
  const username = Common.getUsername(request);

  const pair = Keypair();
  const sshKeyName = `${bridge.name}-bridge`;
  const publicKey = Forge.pki.publicKeyFromPem(pair.public);
  const ssh = Forge.ssh.publicKeyToOpenSSH(publicKey, Common.getEmail(request));

  let sshKeyId;

  try {
    const createRes = await cloudapi.createSshKey(sshKeyName, ssh);
    sshKeyId = `/${username}/keys/${createRes.fingerprint}`;
  } catch (ex) {
    Bounce.rethrow(ex, 'system');
    request.log(['create-key', 'error'], ex);
  }

  return {
    sshKeyName,
    sshKeyId,
    sshKey: pair.private
  };
}
