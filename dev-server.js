'use strict';

const { hapi: Playground } = require('graphql-playground/middleware');
const { hapi: Voyager } = require('graphql-voyager/middleware');
const Hapi = require('hapi');
const HapiPino = require('hapi-pino');
const Inert = require('inert');
const Api = require('./');


const server = new Hapi.Server();

const handlerError = (err) => {
  if (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }
};

server.connection({ port: process.env.PORT || 80 });

server.register(
  [
    {
      register: HapiPino,
      options: {
        logEvents: ['request-error', 'error', 'graqhql-error']
      }
    },
    Inert,
    {
      register: Playground,
      options: {
        path: '/playground',
        endpointUrl: '/graphql'
      }
    },
    {
      register: Voyager,
      options: {
        path: '/voyager',
        endpointUrl: '/graphql'
      }
    },
    Api
  ],
  (err) => {
    handlerError(err);

    server.route([
      {
        method: 'GET',
        path: '/doc/{param*}',
        config: {
          handler: {
            directory: {
              path: './doc',
              redirectToSlash: true,
              index: true
            }
          }
        }
      }
    ]);

    server.start((err) => {
      handlerError(err);
      // eslint-disable-next-line no-console
      console.log(`server started at http://localhost:${server.info.port}`);
    });
  }
);
