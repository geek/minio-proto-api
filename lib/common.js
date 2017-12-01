'use strict';

const Boom = require('boom');
const Reach = require('reach');


exports.getAccountId = function (request) {
  const accountId = Reach(request.auth, 'credentials.profile.id');

  if (accountId === undefined) {
    throw Boom.unauthorized();
  }

  return accountId;
};

exports.getEmail = function (request) {
  return Reach(request.auth, 'credentials.profile.email');
};

exports.getUsername = function (request) {
  return Reach(request.auth, 'credentials.profile.login');
};

exports.getToken = function (request) {
  return Reach(request.auth, 'credentials.token');
};
