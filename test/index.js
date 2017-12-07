'use strict';

const Path = require('path');
const Barrier = require('cb-barrier');
const Hapi = require('hapi');
const Lab = require('lab');
const Sso = require('minio-proto-auth');
const Reach = require('reach');
const Uuid = require('uuid');
const Api = require('../');


// test shortcuts
const lab = exports.lab = Lab.script();
const { describe, it, before, after } = lab;
const { expect } = require('code');


const authAccount = {
  id: Uuid.v4(),
  login: 'barbar',
  email: 'barbar@example.com',
  companyName: 'Example Inc',
  firstName: 'BarBar',
  lastName: 'Jinks',
  phone: '123-456-7890',
  updated: '2015-12-21T11:48:54.884Z',
  created: '2015-12-21T11:48:54.884Z'
};
const fingerprint = 'bb:0d:44:47:7c:01:95:89:6e:a4:6c:29:68:b4:4b:d0';
let cloudapiServer = null;


async function createServer (options) {
  const server = Hapi.server();
  const cloudapiUrl = `http://localhost:${cloudapiServer.info.port}`;

  // Make sure that each server is using a different account ID.
  // The fact that operations continue after the server responds means
  // that data can be added to the database between tests. For example,
  // one test can complete, but container related operations may
  // continue to update the database. The next test could then have
  // unexpected usage data associated with the same account.
  authAccount.id = Uuid.v4();

  options = Object.assign({
    accounts: authAccount.id,
    db: {
      user: 'test-user',
      password: 'test-pass',
      database: 'test-db'
    },
    cloudflare: {
      zoneId: process.env.CF_ZONEID,
      email: process.env.CF_EMAIL,
      key: process.env.CF_KEY,
      arecordParent: process.env.ARECORD_PARENT
    },
    cloudapiUrl
  }, options);

  await server.register([
    {
      plugin: Sso,
      options: {
        cookie: {
          password: 'cookiepasscookiepasscookiepass12',
          isSecure: false,
          isHttpOnly: true,
          ttl: 1000 * 60 * 60 // 1 hour
        },
        sso: {
          isDev: true,
          keyPath: Path.join(__dirname, 'key-fixture'),
          keyId: '/peterpluck/keys/3f:45:ac:88:92:cc:dd:ee:ff:de:ad:be:ef:12:34:56',
          apiBaseUrl: cloudapiUrl
        }
      }
    },
    { plugin: Api, options }
  ]);

  server.auth.default('sso');

  const barrier = new Barrier();
  server.app.mysql.query('CALL delete_all_accounts_from_table()', (err) => {
    if (err) {
      return barrier.pass(err);
    }

    server.app.mysql.query('CALL delete_all_bridges_from_table()', (err) => {
      if (err) {
        return barrier.pass(err);
      }

      server.app.mysql.query('CALL delete_all_bridge_usage_from_table()', (err) => {
        if (err) {
          return barrier.pass(err);
        }

        barrier.pass(server);
      });
    });
  });

  return barrier;
}


function createCloudapiServer () {
  const server = Hapi.server();

  server.route({
    method: 'GET',
    path: '/my',
    handler: function (request, h) {
      return authAccount;
    }
  });

  server.route({
    method: 'POST',
    path: '/my/keys',
    handler: function (request, h) {
      return {
        name: request.payload.name,
        fingerprint,
        key: request.payload.key
      };
    }
  });

  server.route({
    method: 'DELETE',
    path: '/my/keys/{name}',
    handler: function (request, h) {
      return h.continue;
    }
  });

  return server;
}


async function getUsageByAccount (accountId, server) { // eslint-disable-line require-await
  const barrier = new Barrier();

  server.app.mysql.query('CALL get_usage_by_account(?)', [accountId], (err, results) => {
    if (err) {
      return barrier.pass(err);
    }

    barrier.pass(results);
  });

  return barrier;
}


function waitForUsageData (accountId, server) {
  const barrier = new Barrier();
  const interval = setInterval(async () => {
    const usageResults = await getUsageByAccount(accountId, server);
    const usage = Reach(usageResults, '0.0');

    if (usage !== undefined) {
      clearInterval(interval);
      barrier.pass(usage);
    }
  }, 500);

  return barrier;
}


describe('Minio API', () => {
  before(async () => {
    cloudapiServer = createCloudapiServer();
    await cloudapiServer.start();
  });

  after(async () => {
    await cloudapiServer.stop();
    cloudapiServer = null;
  });

  it('registers the API plugin', { timeout: 20000 }, async () => {
    const server = await createServer();
    const plugin = server.registrations.api;

    expect(plugin).to.be.an.object();
  });

  it('creates a new bridge', { timeout: 20000 }, async () => {
    const server = await createServer();
    const payload = { query: `
      mutation {
        createBridge(
          name: "foo",
          directoryMap: "*:/stor/*"
        ) {
          bridgeId, accountId, username, sshKeyId, namespace, name, directoryMap, status
        }
      }`
    };

    const res = await server.inject({ method: 'POST', url: '/graphql', payload });
    const data = JSON.parse(res.payload).data.createBridge;

    expect(data.bridgeId).to.be.a.string();
    expect(data.bridgeId.length).to.equal(36);
    expect(data.accountId).to.equal(authAccount.id);
    expect(data.username).to.equal(authAccount.login);
    expect(data.namespace).to.equal(`foo.${process.env.ARECORD_PARENT}`);
    expect(data.sshKeyId).to.contain(fingerprint);
    expect(data.name).to.equal('foo');
    expect(data.directoryMap).to.equal('*:/stor/*');
    expect(data.status).to.equal('STARTING');
  });

  it('retrieves an existing bridge', { timeout: 20000 }, async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(
          name: "foo",
          directoryMap: "*:/stor/*"
        ) {
          bridgeId
        }
      }`
    };

    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId = JSON.parse(create.payload).data.createBridge.bridgeId;
    const query = { query: `
      query {
        bridge(bridgeId: "${bridgeId}") {
          bridgeId, accountId, username, namespace, sshKeyId, name, directoryMap
        }
      }`
    };
    const res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    const data = JSON.parse(res.payload).data.bridge;

    expect(data.bridgeId).to.equal(bridgeId);
    expect(data.accountId).to.equal(authAccount.id);
    expect(data.username).to.equal(authAccount.login);
    expect(data.sshKeyId).to.contain(fingerprint);
    expect(data.namespace).to.equal(`foo.${process.env.ARECORD_PARENT}`);
    expect(data.name).to.equal('foo');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });

  it('retrieves an existing bridge by name', { timeout: 20000 }, async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(
          name: "foo",
          directoryMap: "*:/stor/*"
        ) {
          bridgeId
        }
      }`
    };

    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId = JSON.parse(create.payload).data.createBridge.bridgeId;
    const query = { query: `
      query {
        getBridgeByName(name: "foo") {
          bridgeId, accountId, username, namespace, sshKeyId, name, directoryMap
        }
      }`
    };
    const res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    const data = JSON.parse(res.payload).data.getBridgeByName;

    expect(data.bridgeId).to.equal(bridgeId);
    expect(data.accountId).to.equal(authAccount.id);
    expect(data.username).to.equal(authAccount.login);
    expect(data.sshKeyId).to.contain(fingerprint);
    expect(data.namespace).to.equal(`foo.${process.env.ARECORD_PARENT}`);
    expect(data.name).to.equal('foo');
    expect(data.directoryMap).to.equal('*:/stor/*');
  });

  it('lists all bridges for user', { timeout: 20000 }, async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(
          name: "foo",
          directoryMap: "*:/stor/*"
        ) {
          bridgeId
        }
      }`
    };

    let create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId1 = JSON.parse(create.payload).data.createBridge.bridgeId;
    create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: { query: mutation.query.replace('foo', 'bar') } // names cannot be duplicated.
    });
    const bridgeId2 = JSON.parse(create.payload).data.createBridge.bridgeId;
    const query = { query: `
      query {
        listBridgesByAccount {
          bridgeId
        }
      }`
    };
    const res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    const data = JSON.parse(res.payload).data.listBridgesByAccount;

    expect(data).to.be.an.array();
    expect(data.length).to.equal(2);
    expect(data.some((bridge) => { return bridge.bridgeId === bridgeId1; })).to.equal(true);
    expect(data.some((bridge) => { return bridge.bridgeId === bridgeId2; })).to.equal(true);
  });

  it('deletes bridges', { timeout: 20000 }, async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(
          name: "foo"
        ) {
          bridgeId
        }
      }`
    };

    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });
    const bridgeId = JSON.parse(create.payload).data.createBridge.bridgeId;
    const query = { query: `
      mutation {
        deleteBridge(bridgeId: "${bridgeId}")
      }`
    };
    let res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    expect(JSON.parse(res.payload).data.deleteBridge).to.equal(true);
    res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });
    expect(JSON.parse(res.payload).data.deleteBridge).to.equal(false);
  });

  it('tracks bridge usage', { timeout: 20000 }, async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(
          name: "foo",
          directoryMap: "*:/stor/*"
        ) {
          bridgeId, accountId
        }
      }`
    };

    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });

    const { bridgeId, accountId } = JSON.parse(create.payload).data.createBridge;
    const createUsage = await waitForUsageData(accountId, server);

    expect(createUsage.accountId).to.equal(accountId);
    expect(createUsage.bridgeId).to.equal(bridgeId);
    expect(createUsage.started).to.be.a.date();
    expect(createUsage.stopped).to.equal(null);

    const getQuery = { query: `
      query {
        bridge(bridgeId: "${bridgeId}") {
          bridgeId, status
        }
      }`
    };
    const getRes = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: getQuery
    });
    const getData = JSON.parse(getRes.payload).data.bridge;

    expect(getData.bridgeId).to.equal(bridgeId);
    expect(getData.status).to.equal('RUNNING');

    const query = { query: `
      mutation {
        deleteBridge(bridgeId: "${bridgeId}")
      }`
    };
    const res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: query
    });

    expect(JSON.parse(res.payload).data.deleteBridge).to.equal(true);
    const deleteUsage = await waitForUsageData(accountId, server);

    expect(deleteUsage.accountId).to.equal(accountId);
    expect(deleteUsage.bridgeId).to.equal(bridgeId);
    expect(deleteUsage.started).to.equal(createUsage.started);
    expect(deleteUsage.stopped).to.be.a.date();
  });

  it('bridges can be stopped', { timeout: 20000 }, async () => {
    const server = await createServer();
    const mutation = { query: `
      mutation {
        createBridge(
          name: "foo",
          directoryMap: "*:/stor/*"
        ) {
          bridgeId, accountId, status
        }
      }`
    };

    const create = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: mutation
    });

    const createBridge = JSON.parse(create.payload).data.createBridge;
    const bridgeId = createBridge.bridgeId;
    expect(createBridge.status).to.equal('STARTING');
    const createUsage = await waitForUsageData(createBridge.accountId, server);
    expect(createUsage.bridgeId).to.equal(bridgeId);

    const getQuery = { query: `
      query {
        bridge(bridgeId: "${bridgeId}") {
          bridgeId, status
        }
      }`
    };
    const getRes = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: getQuery
    });
    const getData = JSON.parse(getRes.payload).data.bridge;

    expect(getData.bridgeId).to.equal(bridgeId);
    expect(getData.status).to.equal('RUNNING');

    const stopQuery = { query: `
      mutation {
        stopBridge(bridgeId: "${bridgeId}")
      }`
    };
    const stopRes = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: stopQuery
    });

    expect(JSON.parse(stopRes.payload).data.stopBridge).to.equal(true);

    const res = await server.inject({
      method: 'POST',
      url: '/graphql',
      payload: getQuery
    });
    const data = JSON.parse(res.payload).data.bridge;

    expect(data.bridgeId).to.equal(bridgeId);
    expect(data.status === 'STOPPING' || data.status === 'STOPPED').to.equal(true);
  });
});
