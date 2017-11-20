'use strict';

const Docker = require('dockerode');

const docker = new Docker();


exports.createBridge = async (options) => {
  const container1 = await createContainer(options);
  const container2 = await createContainer(options);

  await container1.start();
  await container2.start();

  return [container1, container2];
};


function createContainer ({ accountId, namespace }) {
  const containerOptions = {
    Hostname: '',
    User: '',
    Image: 'node',
    Env: ['foo=bar'],
    Cmd: ['/bin/bash', '-c', 'node -e "console.log(1)"'],
    Labels: {
      accountId,
      'triton.cns.services': `${accountId}-${namespace}-bridge`
    },
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    HostConfig: {}
  };

  return docker.createContainer(containerOptions);
}
