import { updater } from './updater.js';
import { getPreps, getAuds, getGrups, getUroki, getPreds, getMinMaxUR, getParam, onReloaded } from './db.js';
import { generateRaspHTML } from './render.js';

let MAXPGG;
let URMAX;
const DICTS = {};

const loadDictionaries = async () => {
  const [preps, auds, grups, preds] = await Promise.all([
    getPreps(), getAuds(), getGrups(), getPreds()
  ]);

  DICTS.IDP = preps;
  DICTS.IDA = auds;
  DICTS.IDG = grups;
  DICTS.IDD = preds;

  MAXPGG = 2;
  URMAX = 8;

  return;
}
await loadDictionaries();

const onlineElement = document.querySelector('.online');

let lastIsOnline;
updater.onUpdate((err, status) => {
  if (err) throw err;

  const { isOnLine, isWaiting, metadata } = status;
  if (!isWaiting) lastIsOnline = isOnLine;

  const onLineStatusText = isWaiting && lastIsOnline
    ? '⚪'
    : isOnLine ? '🟢' : `🔴`;
  onlineElement.textContent =
    `${metadata?.lastCheckedDate?.toLocaleString() ?? ''} ${onLineStatusText}`;
});

const filterForm = document.forms['filter-form'];

const prepSelectElement = filterForm.elements.prep;
const audSelectElement = filterForm.elements.aud;
const grupSelectElement = filterForm.elements.grup;
const oneDayByKeySelectElement = filterForm.elements['one-day-by'];
const dateInputElement = filterForm.elements.date;

const filterElementNames = ['grup', 'prep', 'aud', 'one-day-by'];
const raspElement = document.querySelector('.rasp');

const filterChangeHandler = async (form) => {
  const formData = new FormData(form);

  const grup = formData.get('grup');
  const prep = formData.get('prep');
  const aud = formData.get('aud');
  const oneDayByKey = formData.get('one-day-by');
  const dateFrom = formData.get('date');

  if ([grup, prep, aud, oneDayByKey]
    .filter(value => value ?? '' !== '')
    .length > 1
  ) throw Error(`Only one must remain: ;${[grup, prep, aud, oneDayByKey]}.`);

  localStorage.setItem('filters', JSON.stringify({ grup, prep, aud, oneDayByKey }));
  sessionStorage.setItem('workDate', JSON.stringify(dateFrom));

  if (oneDayByKey) {
    if (!['IDA', 'IDG', 'IDP'].includes(oneDayByKey)) throw Error();

    const dateTo = addDays(dateFrom, 1);
    const uroki = await getUroki(dateFrom, dateTo).catch(err => []);

    const saveOpenStatus = [...raspElement.querySelectorAll('details')].map(element => element.open);

    const raspHTML = createRaspHTML(uroki, { key: oneDayByKey }, MAXPGG, URMAX, DICTS);
    raspElement.innerHTML = raspHTML;

    [...raspElement.querySelectorAll('details')]
      .forEach(detailElement => detailElement.open = saveOpenStatus.shift());
  } else {
    const dateTo = addDays(dateFrom, 14);
    const uroki = await getUroki(dateFrom, dateTo).catch(err => []);

    const filters = Object.entries({ IDA: aud, IDG: grup, IDP: prep })
      .filter(([key, value]) => value ?? '' !== '');

    if (filters.length !== 1) {
      raspElement.innerHTML = '';
      return;
    };
    const [key, value] = filters.map(([key, value]) => ([key, parseInt(value, 10)]))[0];

    const raspHTML = createRaspHTML(uroki, { key, value }, MAXPGG, URMAX, DICTS);
    raspElement.innerHTML = raspHTML;
  }
};

filterForm.addEventListener('change', async (event) => {
  console.time('onchange');
  const { currentTarget, target } = event;

  if (filterElementNames.includes(target.name)) {
    filterElementNames.forEach(name => {
      if (name === target.name) return;
      currentTarget.elements[name].value = '';
    });
  };

  await filterChangeHandler(event.currentTarget);
  console.timeEnd('onchange');
});

const fillSelect = (obj, selectElement) => {
  selectElement.length = 0;

  const optionElement = new Option('', '');
  optionElement.selected = true;
  optionElement.hidden = true;
  optionElement.disabled = true;

  selectElement.add(optionElement);
  Object.entries(obj)
    .sort(([, a], [, b]) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    })
    .forEach(([id, name]) => selectElement.add(new Option(name, id)));
};

const fillSelects = (dicts) => {
  const { IDP: preps, IDA: auds, IDG: grups, IDP: preds } = dicts;
  fillSelect(preps, prepSelectElement);
  fillSelect(auds, audSelectElement);
  fillSelect(grups, grupSelectElement);

  const filtersJson = localStorage.getItem('filters');
  if (!filtersJson) return;

  const filters = JSON.parse(filtersJson);

  oneDayByKeySelectElement.value = filters.oneDayByKey;
  prepSelectElement.value = filters.prep;
  audSelectElement.value = filters.aud;
  grupSelectElement.value = filters.grup;

  const workDateJson = sessionStorage.getItem('workDate');
  if (!workDateJson) return;

  const workDate = JSON.parse(workDateJson);
  dateInputElement.value = workDate;
};

const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0'); // Месяцы начинаются с 0
const day = String(now.getDate()).padStart(2, '0');

const today = `${year}-${month}-${day}`;
dateInputElement.value = today;

fillSelects(DICTS);
filterChangeHandler(filterForm);

onReloaded(async (err) => {
  if (err) throw err;
  await loadDictionaries();
  fillSelects(DICTS);

  console.time('getParam');
  const collegeName = await getParam('NAIM');
  console.timeEnd('getParam');
  console.log({ collegeName });

  console.log('reloaded');
});

function addDays(dateString, days) {
  if (!dateString) return dateString;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error('Invalid date format');
  };
  date.setDate(date.getDate() + days);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
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

    if (!urokSlot[key]) {
      urokSlot[key] = IDGG === 0
        ? urok
        : Array.from({ length: MAXPGG }, () => null);
    }

    if (IDGG > 0) {
      urokSlot[key][IDGG - 1] = urok;
    }

    return result;
  }, {});
}


function createRaspHTML(
  uroki,
  groupBy = { key: 'IDG', value: null },
  MAXPGG = 2,
  URMAX = 8,
  dicts
) {
  if (!dicts) throw new Error('Dictionaries are required');

  validateInputs(groupBy, uroki);

  const urokiObj = prepareFilteredUroki(uroki, groupBy, MAXPGG, URMAX);
  const outputOrder = getOutputOrder(groupBy.key);

  return generateRaspHTML(
    urokiObj,
    groupBy,
    outputOrder,
    MAXPGG,
    dicts
  );
}

function validateInputs(groupBy) {
  if (!groupBy.key) throw new Error('Group key is required');

  if (!['IDA', 'IDG', 'IDP'].includes(groupBy.key)) {
    throw new Error(`Invalid group key: ${groupBy.key}`);
  }
}

function prepareFilteredUroki(uroki, groupBy, MAXPGG, URMAX) {
  const needFilter = groupBy.value !== undefined;
  const urokiFiltered = needFilter
    ? uroki.filter(urok => urok[groupBy.key] === groupBy.value)
    : uroki;

  return prepareUroki(urokiFiltered, groupBy.key, MAXPGG, URMAX);
}

function getOutputOrder(groupKey) {
  return {
    IDA: ['IDG', 'IDD', 'IDP'],
    IDG: ['IDA', 'IDD', 'IDP'],
    IDP: ['IDG', 'IDD', 'IDA']
  }[groupKey];
}
