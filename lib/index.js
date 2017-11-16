'use strict';

const Fs = require('fs');
const Path = require('path');
const Graphi = require('graphi');
const MySql = require('mysql');
const { makeExecutableSchema } = require('graphql-tools');
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
  await server.register({ plugin: Graphi, options: graphiOptions });
}

module.exports = {
  pkg: require('../package.json'),
  register
};
