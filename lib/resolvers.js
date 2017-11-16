'use strict';


module.exports = {
  Query: {
    bridge: async (root, args = {}, request) => {}
  },
  Mutation: {
    createBridge: async (root, { bridge }, request) => {
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
