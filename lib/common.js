'use strict';

const Barrier = require('cb-barrier');
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


exports.doQuery = function (sql, args, db) {
  const barrier = new Barrier();
  db.query(sql, args, (err, results) => {
    if (err) {
      return barrier.pass(err);
    }
    barrier.pass(results);
  });

  return barrier;
};
