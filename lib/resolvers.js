'use strict';

const Barrier = require('cb-barrier');
const Boom = require('boom');
const Bounce = require('bounce');
const Forge = require('node-forge');
const Keypair = require('keypair');
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
      const sql = 'SELECT bridgeId, container1Id, container2Id, accountId, username, sshKeyId, namespace, name, directoryMap FROM bridges WHERE accountId = ?';
      const accountId = Common.getAccountId(request);
      const pool = request.server.app.mysql;
      const barrier = new Barrier();

      pool.query(sql, [accountId], (err, results, fields) => {
        if (err) {
          return barrier.pass(err);
        }

        barrier.pass(results.map(createBridgeFromDb));
      });

      return barrier;
    }
  },
  Mutation: {
    createBridge: async (root, bridge, request) => {
      const { sshKey, sshKeyName, sshKeyId } = await createSshKey(bridge, request);
      if (!sshKeyId) {
        return Boom.internal(`Error creating key for bridge: ${bridge.name}`);
      }

      const sql = 'INSERT INTO bridges (bridgeId, accountId, username, namespace, name, sshKey, sshKeyName, sshKeyId, accessKey, secretKey, directoryMap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const pool = request.server.app.mysql;
      const barrier = new Barrier();
      const bridgeId = Uuid.v4();
      const accountId = Common.getAccountId(request);
      const username = Common.getUsername(request);

      const args = [bridgeId, accountId, username, bridge.namespace, bridge.name,
        sshKey, sshKeyName, sshKeyId, bridge.accessKey, bridge.secretKey, bridge.directoryMap];

      pool.query(sql, args, (err, results, fields) => {
        if (err) {
          return barrier.pass(err);
        }

        // Sanity check. This should always be one.
        if (results.affectedRows !== 1) {
          return barrier.pass(new Error(`Insertion affected ${results.affectedRows} bridges`));
        }

        // Creating the containers will take a while, perform SQL update after
        // the creation is done after the initial bridge data is inserted.
        setImmediate(async () => {
          try {
            const [container1, container2] = await Docker.createBridge({ accountId, bridgeId, ...bridge });
            const updateArgs = [container1.id, container2.id, bridgeId];
            const updateSql = 'UPDATE bridges SET container1Id=?, container2Id=? WHERE bridgeId=?';
            pool.query(updateSql, updateArgs, (err, results) => {
              if (err) {
                request.server.log(['error', 'mysql', 'update-bridge'], `message: ${err.message} \n stack: ${err.stack}`);
                return;
              }

              if (results.affectedRows !== 1) {
                request.server.log(['error', 'mysql', 'update-bridge'], new Error(`Insertion affected ${results.affectedRows} bridges`));
              }
            });
          } catch (ex) {
            request.server.log(['error', 'docker-create'], `message: ${ex.message} \n stack: ${ex.stack}`);
          }
        });

        barrier.pass();
      });

      await barrier;

      return {
        bridgeId,
        accountId,
        username,
        sshKeyId,
        namespace: bridge.namespace,
        name: bridge.name,
        directoryMap: bridge.directoryMap
      };
    },

    deleteBridge: async (root, { bridgeId }, request) => {
      const dbBridge = await getDbBridge(bridgeId, request);
      try {
        await request.plugins.cloudapi.deleteSshKey(dbBridge.sshKeyName);
      } catch (ex) {
        request.server.log(['error', 'delete-sshkey', 'cloudapi'], ex);
      }

      const sql = 'DELETE FROM bridges WHERE bridgeId = ? AND accountId = ?';
      const accountId = Common.getAccountId(request);
      const pool = request.server.app.mysql;
      const barrier = new Barrier();

      // Delete the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.deleteBridge(dbBridge.containerId);
        } catch (ex) {
          request.server.log(['error', 'docker-delete'], ex);
        }
      });


      pool.query(sql, [bridgeId, accountId], (err, results, fields) => {
        if (err) {
          return barrier.pass(err);
        }

        // Sanity check. This should always be zero or one.
        if (results.affectedRows > 1) {
          return barrier.pass(new Error(`Delete affected ${results.affectedRows} bridges`));
        }

        barrier.pass(!!results.affectedRows);
      });

      return barrier;
    }
  }
};

function getDbBridge (bridgeId, request) {
  const sql = 'SELECT bridgeId, container1Id, container2Id, accountId, username, sshKey, sshKeyName, sshKeyId, namespace, name, directoryMap FROM bridges WHERE bridgeId = ? AND accountId = ?';
  const accountId = Common.getAccountId(request);
  const pool = request.server.app.mysql;
  const barrier = new Barrier();

  pool.query(sql, [bridgeId, accountId], (err, results, fields) => {
    if (err) {
      return barrier.pass(err);
    }

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

function createBridgeFromDb (row) {
  return {
    bridgeId: row.bridgeId,
    containerId: [row.container1Id, row.container2Id],
    accountId: row.accountId,
    username: row.username,
    sshKeyId: row.sshKeyId,
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
    console.log(ex);
    Bounce.rethrow(ex, 'system');
    request.log(['create-key', 'error'], ex);
  }

  return {
    sshKeyName,
    sshKeyId,
    sshKey: pair.private
  };
}
