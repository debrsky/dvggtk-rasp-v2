import { updater } from './updater.js';
import { getPreps, getAuds, getGrups, getUroki, getPreds, getMinMaxUR, getParam, onReloaded } from './db.js';

const dictionaries = {};
const loadDictionaries = async () => {
  const [preps, auds, grups, preds] = await Promise.all([
    getPreps(), getAuds(), getGrups(), getPreds()
  ]);
  Object.assign(dictionaries, { preps, auds, grups, preds });
}

await loadDictionaries();

// document.getElementById('notify-btn').addEventListener('click', () => {
//   Notification.requestPermission().then(permission => {
//     if (permission === 'granted') {
//       new Notification('Уведомление!', {
//         body: 'Спасибо, что используете наше PWA приложение!',
//         icon: 'icon.png'
//       });
//     }
//   });
// });

const onlineElement = document.querySelector('.online');

let lastIsOnline;
let lastCheckedDate;
updater.onUpdate((err, status) => {
  // console.log(status);
  const { isOnLine, isWaiting, metadata } = status;
  if (!isWaiting) lastIsOnline = isOnLine;

  const onLineStatusText = isWaiting && lastIsOnline
    ? '⚪'
    : isOnLine ? '🟢' : `🔴`;
  onlineElement.textContent = `${metadata?.lastCheckedDate?.toLocaleString()} ${onLineStatusText}`;
});

const filterForm = document.forms['filter-form'];

const prepSelectElement = filterForm.elements.prep;
const audSelectElement = filterForm.elements.aud;
const grupSelectElement = filterForm.elements.grup;
const dateInputElement = filterForm.elements.date;

const filterChangeHandler = async (form) => {
  const dateFrom = form.elements.date.value;
  const dateTo = addDays(dateFrom, 1);
  const uroki = await getUroki(dateFrom, dateTo).catch(err => []);

  const grup = form.elements.grup.value;
  const prep = form.elements.prep.value;
  const aud = form.elements.aud.value;
  const oneDayByKey = form.elements['one-day-by'].value;

  console.log({ grup, prep, aud, oneDayByKey });

  if ([grup, prep, aud, oneDayByKey]
    .filter(value => value !== '')
    .length > 1
  ) throw Error(`Only one must remain: ;${[grup, prep, aud, oneDayByKey]}.`);

  const raspElement = document.querySelector('.rasp');

  if (oneDayByKey) {
    if (!['IDA', 'IDG', 'IDP'].includes(oneDayByKey)) throw Error();

    const saveOpenStatus = [...raspElement.querySelectorAll('details')].map(element => element.open);

    const raspHTML = createRaspHTML(uroki, { key: oneDayByKey });
    raspElement.innerHTML = raspHTML;

    // restore open status
    [...raspElement.querySelectorAll('details')]
      .forEach(detailElement => detailElement.open = saveOpenStatus.shift());
  } else {
    const filters = Object.entries({ IDA: aud, IDG: grup, IDP: prep })
      .filter(([key, value]) => value !== '');
    if (filters.length !== 1) throw Error();
    const [key, value] = filters.map(([key, value]) => ([key, parseInt(value, 10)]))[0];

    const raspHTML = createRaspHTML(uroki, { key, value });
    raspElement.innerHTML = raspHTML;
  }
};

const filterElementNames = ['grup', 'prep', 'aud', 'one-day-by'];

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
  selectElement.add(new Option(selectElement.dataset.title, ''));
  Object.entries(obj)
    .sort(([, a], [, b]) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    })
    .forEach(([id, name]) => selectElement.add(new Option(name, id)));
};

const fillSelects = (dictionaries) => {
  const { preps, auds, grups, preds } = dictionaries;
  fillSelect(preps, prepSelectElement);
  fillSelect(auds, audSelectElement);
  fillSelect(grups, grupSelectElement);
};

fillSelects(dictionaries); // no await
filterChangeHandler(filterForm); // no await

onReloaded(async (err) => {
  if (err) throw err;
  await loadDictionaries();
  fillSelects(dictionaries);

  console.time('getMinMaxUR');
  const { min, max } = await getMinMaxUR();
  console.timeEnd('getMinMaxUR');
  console.log({ min, max });

  console.time('getParam');
  const collegeName = await getParam('NAIM');
  console.timeEnd('getParam');
  console.log({ collegeName });


  console.log('reloaded');
});

// Функция для прибавления дней к дате
function addDays(dateString, days) {
  if (!dateString) return dateString;

  const date = new Date(dateString);
  date.setDate(date.getDate() + days);

  // Форматируем дату обратно в YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Месяцы начинаются с 0
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
 * const lessons = prepareUroki(rawLessons, 'IDA', 3, 6);
 */
function prepareUroki(uroki, groupByKey, MAXPGG, URMAX) {
  // Валидация входных параметров
  if (!['IDA', 'IDG', 'IDP'].includes(groupByKey)) {
    throw Error(`Некорректный ключ группировки: ${groupByKey}`);
  };
  if (!MAXPGG || !URMAX) {
    throw Error(`MAXPGG и URMAX должы быть заданы`);
  };

  // Использование reduce для более функционального подхода
  return uroki.reduce((result, urok) => {
    const { DAT, UR, IDGG } = urok;

    // Инициализация структуры данных
    result[DAT] ??= Array.from({ length: URMAX }, () => ({}));

    // Логика группировки
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


function createUrokHTML(urok, [start, center, end], dictionaries) {
  const dicts = {
    IDA: dictionaries.auds,
    IDG: dictionaries.grups,
    IDP: dictionaries.preps,
    IDD: dictionaries.preds
  };

  const createUrokPart = (key) => {
    const value = dicts[key][urok[key]];
    const subgroupMark = key === 'IDG' && urok.IDGG > 0 ? `[${urok.IDGG}]` : '';
    return `${value}${subgroupMark}`;
  };

  return `
    <div class="rasp-urok" data-urok-id="${urok.ID}">
      <div class="rasp-urok__start">${createUrokPart(start)}</div>
      <span class="rasp-urok__center">${createUrokPart(center)}</span>
      <div class="rasp-urok__end">${createUrokPart(end)}</div>
    </div>
  `;
}

function createRaspHTML(
  uroki,
  groupBy = { key: 'IDG', value: null },
  MAXPGG = 2, URMAX = 8
) {
  // Валидация входных данных
  validateInputs(groupBy, uroki);

  const urokiObj = prepareFilteredUroki(uroki, groupBy, MAXPGG, URMAX);
  const outputOrder = getOutputOrder(groupBy.key);

  return generateRaspHTML(
    urokiObj,
    groupBy,
    outputOrder,
    MAXPGG
  );
}

function validateInputs(groupBy, uroki) {
  if (!groupBy.key) throw new Error('Group key is required');

  const validKeys = ['IDA', 'IDG', 'IDP'];
  if (!validKeys.includes(groupBy.key)) {
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

function generateRaspHTML(urokiObj, groupBy, outputOrder, MAXPGG) {
  const dateHTMLs = [];

  for (const [date, urs] of Object.entries(urokiObj)) {
    const urHTML = groupBy.value
      ? generateFilteredDayHTML(urs, groupBy, outputOrder, MAXPGG)
      : generateFullDayHTML(urs, groupBy, outputOrder, MAXPGG);

    const dateHTML = createDateSectionHTML(date, urHTML);
    dateHTMLs.push(dateHTML);

    break; // Только один день
  }

  return dateHTMLs.join('');
}

function createDateSectionHTML(date, urHTML) {
  return `
    <section class="rasp__date-section">
      <h2>${date}</h2>
      ${urHTML}
    </section>
  `;
}

function generateFilteredDayHTML(urs, groupBy, outputOrder, MAXPGG) {
  const urokHTMLs = [];

  urs.forEach((ur, index) => {
    const UR = index + 1;
    let urokHTML;
    const urok = ur[groupBy.value];

    if (!urok) {
      urokHTML = `<td colspan="${MAXPGG}" class="rasp__urok rasp__urok--empty"></td>`;
    } else if (Array.isArray(urok)) {
      urokHTML = urok.map((urokPGG) => {
        if (!urokPGG) return `<td class="rasp__urok rasp__urok--empty"></td>`;
        return `<td class="rasp__urok">${createUrokHTML(urokPGG, outputOrder, dictionaries)}</td>`;
      }).join('');
    } else {
      urokHTML = `<td colspan="${MAXPGG}" class="rasp__urok">
        ${createUrokHTML(urok, outputOrder, dictionaries)}
      </td>\n`;
    }

    urokHTMLs.push(`<tr>
      <td>${UR}</td>
      ${urokHTML}
    </tr>`);
  });

  return `
    <table class="rasp__table">
      <thead>
        <tr>
          <th>Пара</th>
          <th colspan="${MAXPGG}">Занятие</th>
        </tr>
      </thead>
      <tbody>${urokHTMLs.join('')}</tbody>
    </table>\n`;
}

function generateFullDayHTML(urs, groupBy, outputOrder, MAXPGG) {
  const dicts = {
    IDA: dictionaries.auds,
    IDG: dictionaries.grups,
    IDP: dictionaries.preps,
    IDD: dictionaries.preds
  };
  const urHTMLs = [];

  urs.forEach((ur, index) => {
    const UR = index + 1;
    const groupHTMLs = [];

    // Для каждой группировки
    Object.entries(ur).forEach(([id, urok]) => {
      const ID = parseInt(id, 10);
      const groupFieldValue = `${ID === 0 ? '' : dicts[groupBy.key][ID]}`;

      let valueHTML;
      if (Array.isArray(urok)) {
        valueHTML = `<tr>
          <td>${groupFieldValue}</td>
          ${urok.map((urokPGG) => {
          if (!urokPGG) return `<td class="rasp__urok rasp__urok--empty"></td>`;
          return `<td class="rasp__urok">${createUrokHTML(urokPGG, outputOrder, dictionaries)}</td>`;
        }).join('')}
        </tr>\n`;
      } else {
        valueHTML = `<tr><td>${groupFieldValue}</td>
          <td colspan="${MAXPGG}" class="rasp__urok">${createUrokHTML(urok, outputOrder, dictionaries)}</td>
        </tr>\n`;
      }

      groupHTMLs.push({ sortValue: groupFieldValue, valueHTML });
    });

    const groupByValue = {
      IDA: 'Ауд.',
      IDG: 'Группа',
      IDP: 'Препод.'
    }[groupBy.key];

    const groupsHTML = groupHTMLs
      .sort(({ sortValue: a }, { sortValue: b }) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(({ valueHTML }) => valueHTML)
      .join('');

    let urHTML;
    if (groupHTMLs.length > 0) {
      urHTML = `<details class="rasp__ur">
          <summary style="cursor: pointer;">Пара #${UR}. Количество занятий: ${Object.keys(ur).length}</summary>
          <table class="rasp__table">
            <thead>
              <tr>
                <th>${groupByValue}</th>
                <th colspan="${MAXPGG}">Занятие</th>
              </tr>
            </thead>
            <tbody>${groupsHTML}</tbody>
          </table>
        </details>`;
    } else {
      urHTML = `<details class="rasp__ur" onclick="return false;">
          <summary>Пара #${UR}. Количество занятий: ${Object.keys(ur).length}</summary>
        </details>`;
    }

    urHTMLs.push(urHTML);
  });

  return urHTMLs.join('');
}
