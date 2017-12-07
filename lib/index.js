'use strict';

const Boom = require('boom');
const Barrier = require('cb-barrier');
const Cloudflare = require('cloudflare');
const Fs = require('fs');
const Graphi = require('graphi');
const MySql = require('mysql');
const Path = require('path');
const { makeExecutableSchema } = require('graphql-tools');
const Cloudapi = require('./cloudapi');
const Common = require('./common');
const Package = require('../package.json');
const Resolvers = require('./resolvers');

const GraphqlSchema = Fs.readFileSync(Path.join(__dirname, 'schema.graphql'));
const DbSchema = Fs.readFileSync(Path.resolve(__dirname, '..', 'sql', '1.sql'));


async function register (server, options) {
  const schema = makeExecutableSchema({ typeDefs: GraphqlSchema.toString(), resolvers: Resolvers });
  const graphiOptions = {
    graphiqlPath: (process.env.NODE_ENV === 'development') ? '/graphiql' : false,
    schema,
    resolvers: Resolvers
  };

  await initDatabase(server, options.db, DbSchema.toString(), options.accounts);
  server.app.mysql = MySql.createPool(options.db);

  server.app.cloudflare = Cloudflare(options.cloudflare);
  server.app.zoneId = options.cloudflare.zoneId;
  server.app.arecordParent = options.cloudflare.arecordParent;

  server.app.cloudapiUrl = options.cloudapiUrl || process.env.SDC_URL;

  await server.register({ plugin: Graphi, options: graphiOptions });

  server.ext('onPostAuth', isAllowedAccount);
  server.ext('onPostAuth', setupCloudApi);
}


module.exports = {
  name: 'api',
  version: Package.version,
  dependencies: 'minio-proto-auth',
  register
};


function isAllowedAccount (request, h) {
  if (request.route.settings.auth === false) {
    return h.continue;
  }

  const accountId = Common.getAccountId(request);
  const pool = request.server.app.mysql;
  const barrier = new Barrier();
  const sql = 'CALL does_account_exist(?)';

  pool.query(sql, [accountId], (err, results) => {
    if (err) {
      return barrier.pass(err);
    }

    results = results[0];

    if (results.length < 1) {
      return barrier.pass(Boom.unauthorized());
    }

    barrier.pass(h.continue);
  });

  return barrier;
}


function setupCloudApi (request, h) {
  if (request.route.settings.auth === false) {
    return h.continue;
  }

  const token = Common.getToken(request);
  request.plugins.cloudapi = new Cloudapi({ token, url: request.server.app.cloudapiUrl });

  return h.continue;
}


async function initDatabase (server, dbOptions, schema, accounts) {
  const options = Object.assign({}, dbOptions, { multipleStatements: true });
  const connection = await createConnection(server, options, new Barrier());
  server.log(['info', 'db-connect'], 'connection established to mysql');

  // Hack to remove DELIMITERs from the schema file. Delimiters aren't supported
  // by drivers. We could remove them from the .sql file, but that would make it
  // incompatible with the MySQL CLI.
  schema = schema.replace(/\$\$/g, ';').replace(/DELIMITER\s+;/gi, '');
  await Common.doQuery(schema, null, connection);

  const accountList = (accounts || '').split(',').map((account) => {
    return account.trim();
  }).filter((account) => { return !!account; });

  if (accountList.length > 0) {
    const values = new Array(accountList.length).fill('(?)').join(',');
    const sql = `REPLACE INTO accounts VALUES ${values};`;
    await Common.doQuery(sql, accountList, connection);
  }

  connection.end();
}

async function createConnection (server, options, barrier) {  // eslint-disable-line require-await
  const connection = MySql.createConnection(options);

  connection.connect((err) => {
    if (!err) {
      return barrier.pass(connection);
    }

    setTimeout(() => {
      server.log(['info', 'db-connect'], 'retrying connection to mysql');
      createConnection(options, barrier);
    }, 1000);
  });

  return barrier;
}
