importScripts('./db.js', './updater.js');

console.log('[worker.js] starting');

const SYNC_INTERVAL = 15_000;
const clientPorts = new Set();

if (self.onconnect !== undefined) {
  console.log('[worker.js] working as Shared Worker');
  self.onconnect = function (event) {
    console.log('[worker.js] self.onconnect starting');
    const port = event.ports[0];
    clientPorts.add(port);

    port.onclose = function () {
      clientPorts.delete(port);
      console.log('[worker.js] clientPort closed and removed from Set');
    };

    if (self.DB_UPDATER) self.DB_UPDATER.syncWithServer();
  };
} else {
  console.log('[worker.js] working as Web Worker');
}

const startUpdater = () => {
  const sendUpdateMessage = (err, status) => {
    if (err) console.error(err);
    const message = {
      type: 'UPDATER',
      payload: { status }
    };

    if (clientPorts.size > 0) {
      clientPorts.forEach(clientPort => clientPort.postMessage(message));
    } else {
      self.postMessage(message);
    }
  };

  self.DB_UPDATER.addUpdateListener(sendUpdateMessage);
  self.DB_UPDATER.startSyncWithServer(SYNC_INTERVAL);
};

const checkUpdaterAvailability = async () => {
  let counter = 0;
  while (!self.DB_UPDATER) {
    console.log(`[worker.js] try #${counter + 1}: updater still not loaded`);
    counter++;
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log(`[worker.js] try #${counter + 1}: updater loaded`);
  startUpdater();
};

checkUpdaterAvailability();
