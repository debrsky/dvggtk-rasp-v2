(async function (global) {
  console.log('[updater.js] starting, global.DB_CONNECTION:', global.DB_CONNECTION ? 'OK' : 'NOT OK');
  if (!global.DB_CONNECTION) throw Error();

  const { openDB, saveMetadata, getMetadata, loadRasp } = global.DB_CONNECTION;

  const RASP_URL = './db/rasp.json';

  const WAITING_TIMEOUT = 3_000;

  console.time('openDB');
  console.log(await openDB());
  console.timeEnd('openDB');

  console.log('[updater.js] defining updater');
  const updater = {
    _updateListeners: [],
    _updateHandler(err, status) {
      this._updateListeners.forEach(listener => listener(err, status))
    },
    addUpdateListener(cb) {
      if (this._updateListeners.includes(cb)) return;

      this._updateListeners.push(cb);
    },

    async _fetchRasp(method) {
      const headers = {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Expires': '0',
      }; // чтобы браузер не использовал кэш;

      const response = await fetch(RASP_URL, { method, headers });
      if (!response.ok) throw new Error('Not OK');

      return {
        eTag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        data: method === 'GET' ? await response.json() : null,
      };
    },

    async syncWithServer() {
      // console.log('[updater.js] syncWithServer starting');
      const [previousETag, previousLastModified, preiousLastCheckedDate] = await Promise.all([
        getMetadata('eTag'),
        getMetadata('lastModified'),
        getMetadata('lastCheckedDate')
      ]);

      const timerId = setTimeout(() => {
        this._updateHandler(null, { isWaiting: true });
      }, WAITING_TIMEOUT);
      try {
        {
          const { eTag, lastModified } = await this._fetchRasp('HEAD');
          const lastCheckedDate = new Date();

          if (eTag === previousETag && lastModified === previousLastModified) {
            await saveMetadata('lastCheckedDate', lastCheckedDate);
            const metadata = { eTag, lastModified, lastCheckedDate };
            this._updateHandler(null, { isOnLine: true, isUpdated: false, metadata });

            clearTimeout(timerId);
            return;
          }
        }

        {
          console.time('fetchRasp');
          const { eTag, lastModified, data: rasp } = await this._fetchRasp('GET');
          console.timeEnd('fetchRasp');
          const lastCheckedDate = new Date();
          console.time('loadRasp');
          await loadRasp(rasp);
          console.timeEnd('loadRasp');

          await Promise.all([
            saveMetadata('eTag', eTag),
            saveMetadata('lastModified', lastModified),
            saveMetadata('lastCheckedDate', lastCheckedDate)
          ]);

          const metadata = { eTag, lastModified, lastCheckedDate };
          this._updateHandler(null, { isOnLine: true, isUpdated: true, metadata });
        }

      } catch (error) {
        console.error('[updater.js] fetching error', error);
        const metadata = {
          eTag: previousETag,
          lastModified: previousLastModified,
          lastCheckedDate: preiousLastCheckedDate
        };
        this._updateHandler(null, { isOnLine: false, isUpdated: false, metadata, error });
      } finally {
        clearTimeout(timerId);
        // console.log('[updater.js] syncWithServer finished');
      };
    },

    syncStarted: false,
    startSyncWithServer(syncInterval) {
      console.log('[updater.js] startSyncWithServer');
      (async () => {
        await updater.syncWithServer()
          .catch(error => console.error('[updater.js] startSyncWithServer error:', error));
        console.log('[updater.js] 1st syncWithServer done');

        if (this.syncStarted) return;
        this.syncStarted = true;

        setInterval(async () => {
          await updater.syncWithServer()
            .catch(error => console.error('[updater.js] startSyncWithServer error:', error));
        }, syncInterval);
      })();
    }
  };
  global.DB_UPDATER = updater;
  console.log('[updater.js] defined updater');
})(this);
