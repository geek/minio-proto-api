'use strict';

const Boom = require('boom');
const Barrier = require('cb-barrier');
const Fs = require('fs');
const Graphi = require('graphi');
const MySql = require('mysql');
const Path = require('path');
const { makeExecutableSchema } = require('graphql-tools');
const Cloudapi = require('./cloudapi');
const Common = require('./common');
const Package = require('../package.json');
const Resolvers = require('./resolvers');

const Schema = Fs.readFileSync(Path.join(__dirname, 'schema.graphql'));


async function register (server, options) {
  const schema = makeExecutableSchema({ typeDefs: Schema.toString(), resolvers: Resolvers });
  const graphiOptions = {
    graphiqlPath: (process.env.NODE_ENV === 'development') ? '/graphiql' : false,
    schema,
    resolvers: Resolvers
  };

  server.app.mysql = MySql.createPool(options.db);
  server.app.cloudapiUrl = options.cloudapiUrl || process.env.SDC_URL;

  await server.register({ plugin: Graphi, options: graphiOptions });

  server.ext('onPostAuth', isAllowedAccount);
  server.ext('onPreHandler', setupCloudApi);
}

module.exports = {
  name: 'api',
  version: Package.version,
  dependencies: 'minio-proto-auth',
  register
};

function isAllowedAccount (request, h) {
  if (!request.route.settings.auth) {
    return h.continue;
  }

  const accountId = Common.getAccountId(request);
  const pool = request.server.app.mysql;
  const barrier = new Barrier();

  const sql = 'SELECT accountId FROM accounts WHERE accountId = ?';
  pool.query(sql, [accountId], (err, results) => {
    if (err) {
      return barrier.pass(err);
    }

    if (!results || !results.length) {
      return barrier.pass(Boom.unauthorized());
    }

    barrier.pass(h.continue);
  });

  return barrier;
}

function setupCloudApi (request, h) {
  const token = Common.getToken(request);
  request.plugins.cloudapi = new Cloudapi({ token, url: request.server.app.cloudapiUrl });

  return h.continue;
}
