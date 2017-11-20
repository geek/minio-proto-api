'use strict';

const Barrier = require('cb-barrier');
// const Docker = require('./docker');


module.exports = {
  Query: {
    bridge: async (root, args = {}, request) => {}
  },
  Mutation: {
    createBridge: async (root, { bridge }, request) => {
      const pool = request.server.app.mysql;
      const barrier = new Barrier();
      const sql = 'INSERT INTO bridges (instanceId, accountId, username, namespace, sshKey, accessKey, secretKey, directoryMap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
      const args = [bridge.instanceId, bridge.accountId, bridge.username, bridge.namespace, bridge.sshKey, bridge.accessKey, bridge.secretKey, bridge.directoryMap];

      pool.query(sql, args, (err, results, fields) => {
        if (err) {
          return barrier.pass(err);
        }

        // Sanity check. This should always be one.
        if (results.affectedRows !== 1) {
          return barrier.pass(new Error(`Insertion affected ${results.affectedRows} rows`));
        }

        barrier.pass();
      });

      await barrier;

      return {
        instanceId: bridge.instanceId,
        accountId: bridge.accountId,
        username: bridge.username,
        namespace: bridge.namespace,
        directoryMap: bridge.directoryMap
      };
    }
  }
};
