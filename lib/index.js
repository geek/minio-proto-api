'use strict';

const Fs = require('fs');
const Path = require('path');
const Barrier = require('cb-barrier');
const Boom = require('boom');
const Graphi = require('graphi');
const MySql = require('mysql');
const { makeExecutableSchema } = require('graphql-tools');
const Common = require('./common');
const Resolvers = require('./resolvers');

const Schema = Fs.readFileSync(Path.join(__dirname, 'schema.graphql'));


async function register (server, options) {
  server.dependency('minio-proto-auth');

  const schema = makeExecutableSchema({ typeDefs: Schema.toString(), resolvers: Resolvers });
  const graphiOptions = {
    graphiqlPath: (process.env.NODE_ENV === 'development') ? '/graphiql' : false,
    schema,
    resolvers: Resolvers
  };

  server.app.mysql = MySql.createPool(options.db);

  await server.register({ plugin: Graphi, options: graphiOptions });

  server.ext('onPostAuth', isAllowedAccount);
}

module.exports = {
  pkg: require('../package.json'),
  register
};

function isAllowedAccount (request, h) {
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
