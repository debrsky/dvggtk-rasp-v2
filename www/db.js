const TABLES = [
  ['UROKI', 'ID',],
  ['SPGRUP', 'IDG'],
  ['SPPREP', 'IDP'],
  ['SPPRED', 'IDD'],
  ['SPKAUD', 'IDA']
];

const METADATA_STORE_NAME = 'metadata';
const PARAMS_STORE_NAME = 'params';

let db;

const reloadedListeners = [];
export const onReloaded = (cb) => reloadedListeners.push(cb);

export const openDB = () => {
  const dbName = 'rasp'
  const version = 1;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);

    request.onerror = (event) => reject(event.target.error);

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      db = event.target.result;

      if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
        db.createObjectStore(METADATA_STORE_NAME);
      }

      if (!db.objectStoreNames.contains(PARAMS_STORE_NAME)) {
        db.createObjectStore(PARAMS_STORE_NAME);
      }

      for (const [storeName, keyPath] of TABLES) {
        let store;
        if (!db.objectStoreNames.contains(storeName)) {
          store = db.createObjectStore(storeName, { keyPath });

          const idxName = 'DAT_idx';
          if (storeName === 'UROKI' && !store.indexNames.contains(idxName)) {
            store.createIndex(idxName, 'DAT', { unique: false });
          }
        }
      }

    };
  });
};

const enshureDBReady = async () => {
  const ready = await new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE_NAME, 'readonly');
    const store = transaction.objectStore(METADATA_STORE_NAME);
    const request = store.get(0);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject();
  }).catch(err => false);

  if (!ready) await openDB();
};

const performTransaction = async (storeName, mode, operationCallback) => {
  await enshureDBReady();

  return await new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);

      transaction.onerror = (event) => reject(event.target.error);
      transaction.oncomplete = () => resolve();

      operationCallback(null, store);
    } catch (error) {
      reject(error);
    }
  });
};

const loadRecords = (storeName, records) => {
  return performTransaction(storeName, 'readwrite', (err, store) => {
    if (err) throw Error(err);

    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      for (const record of records) {
        if (storeName === 'UROKI' && record.IDR !== 0) continue;

        store.add(record)
      }
    };
  });
};

const loadParams = async (storeName, params) => {
  return await performTransaction(storeName, 'readwrite', (err, store) => {
    if (err) throw Error(err);

    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      for (const [name, value] of Object.entries(params)) {
        store.add(value, name)
      }
    };
  });
};

export const loadRasp = async (rasp) => {
  await Promise.all([
    loadParams(PARAMS_STORE_NAME, rasp.RASP[0]),
    ...TABLES.map(([tableName, _]) => loadRecords(tableName, rasp[tableName]))
  ]);

  reloadedListeners.forEach(listener => listener(null));
};

const saveHelper = async (storeName, name, value) => {
  return await performTransaction(storeName, 'readwrite', (err, store) => {
    store.put(value, name);
  });
}

export const saveMetadata = (name, value) => saveHelper(METADATA_STORE_NAME, name, value);
export const saveParam = (name, value) => saveHelper(PARAMS_STORE_NAME, name, value);

const getHelper = async (storeName, name) => {
  await enshureDBReady();

  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);

    const request = store.get(name);

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
};

export const getMetadata = (name) => getHelper(METADATA_STORE_NAME, name);
export const getParam = (name) => getHelper(PARAMS_STORE_NAME, name);

const getAllRecords = async (storeName) => {
  await enshureDBReady();

  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);

    const request = store.getAll();

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
};

const getRecordsHelper = async (storeName, keyField, valueField) => Object.fromEntries(
  (await getAllRecords(storeName))
    .map(({ [keyField]: key, [valueField]: value }) => ([key, value]))
);

export const getPreps = () => getRecordsHelper('SPPREP', 'IDP', 'FAMIO');
export const getGrups = () => getRecordsHelper('SPGRUP', 'IDG', 'NAIM');
export const getPreds = () => getRecordsHelper('SPPRED', 'IDD', 'NAIM');

export const getAuds = () => getRecordsHelper('SPKAUD', 'IDA', 'KAUDI')
  .then((dict) => { dict[0] = '⬜'; return dict });


export const getUroki = async (fromDAT, toDAT) => {
  await enshureDBReady();

  return await new Promise((resolve, reject) => {
    const storeName = "UROKI";
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const idx = store.index('DAT_idx');

    const range = IDBKeyRange.bound(fromDAT, toDAT, false, true);
    const request = idx.getAll(range);

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

export const getMinMaxUR = async () => {
  await enshureDBReady();

  return await new Promise((resolve, reject) => {
    const storeName = "UROKI";
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);

    let min = Infinity;
    let max = -Infinity;
    let foundRecords = false;

    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result;

      if (cursor) {
        foundRecords = true;

        const currentValue = cursor.value.UR;
        if (currentValue < min) {
          min = currentValue;
        }
        if (currentValue > max) {
          max = currentValue;
        }

        cursor.continue();
      } else {
        if (!foundRecords) {
          resolve({ min: null, max: null }); // Если нет записей
        } else {
          resolve({ min, max }); // Возвращаем минимальное и максимальное значения
        }
      }
    };

    cursorRequest.onerror = (event) => reject(event.target.error);
  });
};
