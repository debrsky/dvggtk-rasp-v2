importScripts('./db.js', './updater.js');

console.log('[worker.js] starting');

const SYNC_INTERVAL = 15_000;

const clientPorts = [];
if (self.onconnect !== undefined) {
  self.onconnect = function (event) {
    console.log('[worker.js] self.onconnect starting');
    const port = event.ports[0] // В ports всегда один элемент
    clientPorts.push(port);

    port.onclose = function () {
      const idx = clientPorts.indexOf(port);
      if (idx === -1) return;
      clientPorts.splice(idx, 1);
    };
  };
}

if (!self.DB_UPDATER) {
  let counter = 0;
  const timerId = setInterval(() => {
    counter++;
    if (self.DB_UPDATER) {
      clearInterval(timerId);

      if (self.onconnect !== undefined) {
        // Shared Worker
        console.log('[worker.js] working as shared worker');
        const sendUpdateMessageFromSharedWorker = async (err, status) => {
          console.log('[worker.js] sendUpdateMessageFromSharedWorker starting');
          if (err) console.error(err);

          console.log('[worker.js] clientPorts', clientPorts);

          clientPorts.forEach((clientPort) => clientPort.postMessage({
            type: 'UPDATER',
            payload: { status }
          }));
        };

        self.DB_UPDATER.addUpdateListener(sendUpdateMessageFromSharedWorker);
        self.DB_UPDATER.startSyncWithServer(SYNC_INTERVAL);
      } else {
        // Web Worker
        console.log('[worker.js] working as web worker');
        const sendUpdateMessageFromWebWorker = async (err, status) => {
          if (err) console.error(err);

          self.postMessage({
            type: 'UPDATER',
            payload: { status }
          });
        };

        self.DB_UPDATER.addUpdateListener(sendUpdateMessageFromWebWorker);
        self.DB_UPDATER.startSyncWithServer(SYNC_INTERVAL);
      }
      console.log(`[worker.js] try #${counter}: updater loaded`);
    } else {
      console.log(`[worker.js] try #${counter}: updater still not loaded`);
    }
  }, 10);
};
