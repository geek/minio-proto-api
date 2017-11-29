'use strict';

const Boom = require('boom');
const Reach = require('reach');


exports.getAccountId = function (request) {
  const accountId = Reach(request.auth.credentials, 'profile.id');

  if (accountId === undefined) {
    throw Boom.unauthorized();
  }

  return accountId;
};
