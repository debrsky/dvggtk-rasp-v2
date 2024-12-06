console.log('[shared-worker.js] starting');
let isUpdaterInitialized = false;

const SYNC_INTERVAL = 15_000;

const clientPorts = [];

const sendUpdateMessage = async (err, status) => {
  if (err) console.error(err);

  clientPorts.forEach((clientPort) => clientPort.postMessage({
    type: 'UPDATER',
    payload: { status }
  }));
};

self.onconnect = (connect) => {
  const port = connect.ports[0] // В ports всегда один элемент
  clientPorts.push(port);

  if (!isUpdaterInitialized) {
    importScripts('./db.js', './updater.js');

    if (!self.DB_UPDATER) {
      let timerId;
      let counter = 0;
      timerId = setInterval(() => {
        counter++;
        if (self.DB_UPDATER) {
          initializeUpdater();
          clearInterval(timerId);
          console.log('[share-worker.js] updater initialized');
        } else {
          console.log(`[share-worker.js] try #${counter}: updater still not loaded`);
        }
      }, 10);
    };
  };
};

function initializeUpdater() {
  self.DB_UPDATER.addUpdateListener(sendUpdateMessage);
  self.DB_UPDATER.startSyncWithServer(SYNC_INTERVAL);
  isUpdaterInitialized = true;
}
