'use strict';

const Docker = require('dockerode');

const docker = new Docker();


module.exports = {
  createBridge: async (bridge, keyData) => {
    const [container1, container2] = await Promise.all([createContainer(bridge, keyData), createContainer(bridge, keyData)]);
    await Promise.all([container1.start(), container2.start()]);

    return [container1, container2];
  },

  deleteBridge: async (containerId1, containerId2) => {
    const container1 = docker.getContainer(containerId1);
    const container2 = docker.getContainer(containerId2);

    await Promise.all([container1.stop(), container2.stop()]);
    await Promise.all([container1.remove(), container2.remove()]);
  },

  stopBridge: async (containerId1, containerId2) => {
    const container1 = docker.getContainer(containerId1);
    const container2 = docker.getContainer(containerId2);

    await Promise.all([container1.stop(), container2.stop()]);
  },

  resumeBridge: async (containerId1, containerId2) => {
    const container1 = docker.getContainer(containerId1);
    const container2 = docker.getContainer(containerId2);

    await Promise.all([container1.stop(), container2.stop()]);
    await Promise.all([container1.start(), container2.start()]);
  }
};


function createContainer (bridge, keyData) {
  const containerOptions = {
    Hostname: '',
    User: '',
    Image: 'autopilotpattern/minio-manta:latest',
    Env: [
      `CONSUL=${process.env.CONSUL}`,
      'CONSUL_AGENT=1',
      'LOG_LEVEL=info',
      `MINIO_ACCESS_KEY=${bridge.username}`,
      `MINIO_SECRET_KEY=${keyData.sshKeyId}`,
      `MINIO_KEY_MATERIAL=${keyData.sshKey}`,
      'MANTA_KEY_MATERIAL=/etc/minio/manta_key',
      `MANTA_DIRECTORY_MAP=${bridge.directoryMap}`
    ],
    Cmd: ['/usr/bin/containerpilot'],
    Labels: {
      accountId: bridge.accountId,
      bridgeId: bridge.bridgeId,
      'triton.cns.services': `${bridge.username}-${bridge.name}`,
      service: 'minio',
      role: 'storage'
    },
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    HostConfig: {
      NetworkMode: 'bridge',
      RestartPolicy: { Name: '', MaximumRetryCount: 0 },
      PortBindings: { '9000/tcp': [{ HostPort: '9000' }] }
    }
  };

  return docker.createContainer(containerOptions);
}
