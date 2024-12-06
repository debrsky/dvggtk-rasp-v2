(function (global) {
  console.log('[db.js] starting');

  const DATABASE_NAME = 'rasp';
  const DATABASE_VERSION = 5;

  const TABLES = [
    ['UROKI', 'ID', null],
    ['SPGRUP', 'IDG', 'NAIM'],
    ['SPPREP', 'IDP', 'FAMIO'],
    ['SPPRED', 'IDD', 'NAIM'],
    ['SPKAUD', 'IDA', 'KAUDI']
  ];

  const DICT_TABLES = TABLES
    .filter(([name, key, value]) => value !== null);

  const PARAMS_TABLE_NAME = 'RASP';
  const PARAMS_STORE_NAME = 'params';
  const METADATA_STORE_NAME = 'metadata';

  let db;

  const deleteDB = async () => {
    if (!(await indexedDB.databases()).some(db => db.name === DATABASE_NAME)) return;

    await new Promise((resolve, reject) => {
      if (db) db.close();
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
      request.onblocked = () => reject(Error(`Удаление базы данных ${DATABASE_NAME} заблокировано`));
    });
  };

  const reloadedListeners = [];
  const onReloaded = (cb) => reloadedListeners.push(cb);

  const openDB = () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

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

  const loadRasp = async (rasp) => {
    const existIds = {};
    const sprIds = TABLES
      .filter(([tableName]) => tableName !== 'UROKI')
      .map(([tableName, ID]) => ID);

    sprIds.forEach((ID) => {
      if (!existIds[ID]) existIds[ID] = new Set();
    });

    for (const urok of rasp.UROKI) {
      sprIds.forEach((ID) => existIds[ID].add(urok[ID]));
    };

    const storeNames = TABLES.map(([tableName]) => tableName);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([PARAMS_STORE_NAME, ...storeNames], 'readwrite');
      transaction.onerror = (event) => reject(event.target.error);
      transaction.oncomplete = () => resolve();

      TABLES.forEach(([storeName, ID]) => {
        const store = transaction.objectStore(storeName);
        const records = rasp[storeName];
        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
          for (const record of records) {
            if (storeName === 'UROKI' && record.IDR !== 0) continue;

            if (storeName !== 'UROKI') {
              if (!existIds[ID].has(record[ID])) continue;
            }

            store.add(record);
          }
        };
      })

      const store = transaction.objectStore(PARAMS_STORE_NAME);
      const params = rasp[PARAMS_TABLE_NAME][0];
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => {
        for (const [name, value] of Object.entries(params)) {
          store.add(value, name)
        }
      };
    });
    reloadedListeners.forEach(listener => listener(null));
  };

  const saveHelper = async (storeName, name, value) => {
    return await performTransaction(storeName, 'readwrite', (err, store) => {
      store.put(value, name);
    });
  }

  const saveMetadata = (name, value) => saveHelper(METADATA_STORE_NAME, name, value);
  const saveParam = (name, value) => saveHelper(PARAMS_STORE_NAME, name, value);

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

  const getMetadata = (name) => getHelper(METADATA_STORE_NAME, name);
  const getParam = (name) => getHelper(PARAMS_STORE_NAME, name);

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

  const getPreps = () => getRecordsHelper('SPPREP', 'IDP', 'FAMIO');
  const getGrups = () => getRecordsHelper('SPGRUP', 'IDG', 'NAIM');
  const getPreds = () => getRecordsHelper('SPPRED', 'IDD', 'NAIM');

  const getAuds = () => getRecordsHelper('SPKAUD', 'IDA', 'KAUDI')
    .then((dict) => { dict[0] = '⬜'; return dict });


  const getUroki = async (fromDAT, toDAT) => {
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

  /**
   * Подготавливает уроки для отображения с группировкой по заданному ключу
   *
   * @param {Object[]} uroki - Массив объектов уроков для обработки
   * @param {string} groupByKey - Ключ группировки ('IDA', 'IDG' или 'IDP')
   * @param {number} MAXPGG - Максимальное количество подгрупп в уроке
   * @param {number} URMAX - Максимальное количество уроков в день
   *
   * @returns {Object} Структурированный объект уроков, сгруппированных по дате и номеру урока
   *
   * @throws {Error} Если указан некорректный ключ группировки или не заданы MAXPGG и URMAX
   *
   * @example
   * const urokiObj = prepareUroki(uroki, 'IDA', 3, 6);
   */
  function prepareUroki(uroki, groupByKey, MAXPGG, URMAX) {
    if (!['IDA', 'IDG', 'IDP'].includes(groupByKey)) {
      throw Error(`Некорректный ключ группировки: ${groupByKey}`);
    };
    if (!MAXPGG || !URMAX) {
      throw Error(`MAXPGG и URMAX должы быть заданы`);
    };

    return uroki.reduce((result, urok) => {
      const { DAT, UR, IDGG } = urok;

      result[DAT] ??= Array.from({ length: URMAX }, () => ({}));

      const key = urok[groupByKey];
      const urokSlot = result[DAT][UR - 1];

      urokSlot[key] ??= IDGG === 0
        ? urok
        : Array.from({ length: MAXPGG }, () => null);

      if (IDGG > 0) {
        urokSlot[key][IDGG - 1] = urok;
      }

      return result;
    }, {});
  }

  const getUrokiObj = async (fromDAT, toDAT, groupBy = { key: 'IDG', value: null }) => {
    await enshureDBReady();

    const [MAXPGG, URMAX] = await Promise.all([
      getParam('MAXPGG'),
      getParam('URMAX')
    ]);

    if (!MAXPGG || !URMAX) {
      return [{}, null];
    };

    const uroki = await new Promise((resolve, reject) => {
      const storeName = "UROKI";
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const idx = store.index('DAT_idx');

      const range = IDBKeyRange.bound(fromDAT, toDAT, false, true);
      const request = idx.getAll(range);

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });

    const needFilter = groupBy.value !== undefined;
    const urokiFiltered = needFilter
      ? uroki.filter(urok => urok[groupBy.key] === groupBy.value)
      : uroki;

    const urokiObj = prepareUroki(urokiFiltered, groupBy.key, MAXPGG, URMAX);

    let toDate = new Date(toDAT);

    let iDate = new Date(fromDAT);
    while (iDate < toDate) {
      const year = String(iDate.getFullYear()).padStart(4, '0');
      const month = String(iDate.getMonth() + 1).padStart(2, '0'); // Месяцы начинаются с 0
      const day = String(iDate.getDate()).padStart(2, '0');
      const iDAT = `${year}-${month}-${day}`;

      urokiObj[iDAT] ??= Array.from({ length: URMAX }, () => ({}));

      iDate.setDate(iDate.getDate() + 1);
    };

    return [urokiObj, MAXPGG];
  }

  const getDicts = async () => {
    await enshureDBReady();

    const storeNames = DICT_TABLES.map(([tableName]) => tableName);
    const transaction = db.transaction(storeNames, 'readonly');

    const dicts = Object.fromEntries(await Promise.all(DICT_TABLES
      .map(async ([storeName, keyField, valueField]) => {
        const records = (await new Promise((resolve, reject) => {
          const store = transaction.objectStore(storeName);

          const request = store.getAll();

          request.onsuccess = (event) => resolve(event.target.result);
          request.onerror = (event) => reject(event.target.error);
        }));

        const entries = records
          .map(({ [keyField]: key, [valueField]: value }) => ([key, value]));

        if (storeName === 'SPKAUD') entries.push([0, '⬜']);

        return [keyField, Object.fromEntries(entries)];
      })));
    return dicts;
  }

  const getMinMaxUR = async () => {

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

  const logDatabaseParameters = async () => {
    await enshureDBReady();

    console.log({ "Имя базы данных": DATABASE_NAME });
    const storeNames = db.objectStoreNames;
    const storeRecords = [];

    // Проходимся по каждому объектному хранилищу
    for (let storeName of storeNames) {
      const records = await getAllRecords(storeName);
      storeRecords.push({ "Хранилище": storeName, "Количество записей": records.length });
    }

    console.table(storeRecords);
  };

  const DB_CONNECTION = {
    onReloaded,
    openDB,
    loadRasp,
    saveMetadata,
    saveParam,
    getMetadata,
    getParam,
    getPreps,
    getGrups,
    getPreds,
    getAuds,
    getUroki,
    prepareUroki,
    getUrokiObj,
    getDicts,
    getMinMaxUR,
    deleteDB,

    logDatabaseParameters
  };

  if (global.DB_CONNECTION) throw Error();

  global.DB_CONNECTION = DB_CONNECTION;

})(this);
