'use strict';

const Barrier = require('cb-barrier');
const Boom = require('boom');
const Reach = require('reach');
const Uuid = require('uuid');
const Docker = require('./docker');


module.exports = {
  Query: {
    bridge: async (root, { bridgeId }, request) => { // eslint-disable-line require-await
      const sql = 'SELECT bridgeId, container1Id, container2Id, accountId, username, namespace, directoryMap FROM bridges WHERE bridgeId = ? AND accountId = ?';
      const accountId = getAccountId(request);
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

        barrier.pass(createBridgeFromDb(results[0]));
      });

      return barrier;
    },

    listBridgesByAccount: async (root, options, request) => { // eslint-disable-line require-await
      const sql = 'SELECT bridgeId, container1Id, container2Id, accountId, username, namespace, directoryMap FROM bridges WHERE accountId = ?';
      const accountId = getAccountId(request);
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
      const sql = 'INSERT INTO bridges (bridgeId, accountId, username, namespace, sshKey, accessKey, secretKey, directoryMap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      const pool = request.server.app.mysql;
      const barrier = new Barrier();
      const bridgeId = Uuid.v4();
      const accountId = getAccountId(request);

      const args = [bridgeId, accountId, bridge.username, bridge.namespace,
        bridge.sshKey, bridge.accessKey, bridge.secretKey, bridge.directoryMap];
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
                return;
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
        username: bridge.username,
        namespace: bridge.namespace,
        directoryMap: bridge.directoryMap
      };
    },

    deleteBridge: async (root, { bridgeId }, request) => {
      const bridge = await module.exports.Query.bridge(root, { bridgeId }, request);
      const sql = 'DELETE FROM bridges WHERE bridgeId = ? AND accountId = ?';
      const accountId = getAccountId(request);
      const pool = request.server.app.mysql;
      const barrier = new Barrier();

      // Delete the containers associated with the bridge
      setImmediate(async () => {
        try {
          await Docker.deleteBridge(bridge.containerId);
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


function getAccountId (request) {
  const accountId = Reach(request.auth.credentials, 'profile.id');

  if (accountId === undefined) {
    throw Boom.unauthorized();
  }

  return accountId;
}


function createBridgeFromDb (row) {
  return {
    bridgeId: row.bridgeId,
    containerId: [row.container1Id, row.container2Id],
    accountId: row.accountId,
    username: row.username,
    namespace: row.namespace,
    directoryMap: row.directoryMap
  };
}
