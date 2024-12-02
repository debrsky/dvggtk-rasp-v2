// TODO Перенести функционал модуля в service worker
import { openDB, deleteDB, saveMetadata, getMetadata, loadRasp } from './db.js';

const savedVERSION = localStorage.getItem('VERSION');
const VERSION = '1.0.1';
if (VERSION !== savedVERSION) {
  await deleteDB().catch((err) => {
    console.error(err);
  })
};
localStorage.setItem('VERSION', VERSION);

const RASP_URL = './db/rasp.json';

const CHECK_INTERVAL = 10_000;
const WAITING_TIMEOUT = 3_000;

console.time('openDB');
console.log(await openDB());
console.timeEnd('openDB');

export const updater = {
  _updateListeners: [],
  _updateHandler(err, status) {
    this._updateListeners.forEach(listener => listener(err, status))
  },
  onUpdate(cb) { this._updateListeners.push(cb); },

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

  async check() {
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
        // console.log({ eTag, lastModified });

        // console.log({ eTag, previousETag, compare: eTag === previousETag });
        // console.log({ lastModified, previousLastModified, compare: lastModified === previousLastModified });

        if (eTag === previousETag && lastModified === previousLastModified) {
          saveMetadata('lastCheckedDate', lastCheckedDate);
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

        saveMetadata('eTag', eTag);
        saveMetadata('lastModified', lastModified);
        saveMetadata('lastCheckedDate', lastCheckedDate);

        const metadata = { eTag, lastModified, lastCheckedDate };
        this._updateHandler(null, { isOnLine: true, isUpdated: true, metadata });
      }

    } catch (error) {
      console.error(error);
      const metadata = {
        eTag: previousETag,
        lastModified: previousLastModified,
        lastCheckedDate: preiousLastCheckedDate
      };
      this._updateHandler(null, { isOnLine: false, isUpdated: false, metadata, error });
    } finally {
      clearTimeout(timerId);
    };
  }
};

async function update() {
  while (true) {
    await updater.check().catch(error => console.error('Unhandled update error:', error));
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL));
  }
}

update();
