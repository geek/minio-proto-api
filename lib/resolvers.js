'use strict';

const Barrier = require('cb-barrier');
const Boom = require('boom');
const Uuid = require('uuid');
// const Docker = require('./docker');


module.exports = {
  Query: {
    bridge: async (root, { bridgeId }, request) => { // eslint-disable-line require-await
      const sql = 'SELECT bridgeId, instance1Id, instance2Id, accountId, username, namespace, directoryMap FROM bridges WHERE bridgeId = ?';
      const pool = request.server.app.mysql;
      const barrier = new Barrier();

      pool.query(sql, [bridgeId], (err, results, fields) => {
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

        const bridge = results[0];

        barrier.pass({
          bridgeId,
          instanceId: [bridge.instance1Id, bridge.instance2Id],
          accountId: bridge.accountId,
          username: bridge.username,
          namespace: bridge.namespace,
          directoryMap: bridge.directoryMap
        });
      });

      return barrier;
    }
  },
  Mutation: {
    createBridge: async (root, { bridge }, request) => {
      if (bridge.instanceId.length !== 2) {
        throw Boom.badRequest('two instance IDs are required');
      }

      const sql = 'INSERT INTO bridges (bridgeId, instance1Id, instance2Id, accountId, username, namespace, sshKey, accessKey, secretKey, directoryMap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
      const pool = request.server.app.mysql;
      const barrier = new Barrier();
      const bridgeId = Uuid.v4();
      const args = [bridgeId, bridge.instanceId[0], bridge.instanceId[1],
        bridge.accountId, bridge.username, bridge.namespace,
        bridge.sshKey, bridge.accessKey, bridge.secretKey,
        bridge.directoryMap];

      pool.query(sql, args, (err, results, fields) => {
        if (err) {
          return barrier.pass(err);
        }

        // Sanity check. This should always be one.
        if (results.affectedRows !== 1) {
          return barrier.pass(new Error(`Insertion affected ${results.affectedRows} bridges`));
        }

        barrier.pass();
      });

      await barrier;

      return {
        bridgeId,
        instanceId: bridge.instanceId,
        accountId: bridge.accountId,
        username: bridge.username,
        namespace: bridge.namespace,
        directoryMap: bridge.directoryMap
      };
    }
  }
};
