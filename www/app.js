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
    : isOnLine ? '🟢' : `🔴 ${metadata?.lastCheckedDate?.toLocaleString()}`;
  onlineElement.textContent = onLineStatusText;
});

const form = document.forms.form;

const prepSelectElement = form.elements.prep;
const audSelectElement = form.elements.aud;
const grupSelectElement = form.elements.grup;
const dateInputElement = form.elements.date;
const urokiDebugElement = document.querySelector('.debug__uroki');


form.addEventListener('change', async (event) => {
  console.time('onchange');
  const dateFrom = dateInputElement.value;
  const dateTo = addDays(dateFrom, 1);
  console.log({ dateFrom, dateTo });
  const uroki = await getUroki(dateFrom, dateTo).catch(err => []);

  const groupByKey = form.elements.dayBy.value;
  if (['IDA', 'IDG', 'IDP'].includes(groupByKey)) {
    const raspElement = document.querySelector('.rasp');
    const saveOpenStatus = [...raspElement.querySelectorAll('details')].map(element => element.open);
    const raspHTML = createRaspOneDayHTML(uroki, groupByKey);
    raspElement.innerHTML = raspHTML;

    [...raspElement.querySelectorAll('details')].forEach(element => element.open = saveOpenStatus.shift())
  } else {
    raspElement.innerHTML = '';
  }
  console.timeEnd('onchange');
});

const fillSelect = (obj, selectElement) => {
  selectElement.length = 0;
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

fillSelects(dictionaries);

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

  // Преобразуем строку в объект Date
  const date = new Date(dateString);

  // Добавляем дни
  date.setDate(date.getDate() + days);

  // Форматируем дату обратно в YYYY-MM-DD
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Месяцы начинаются с 0
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function fillRasp(urokiRaw, ur) {
  console.log({ urokiRaw, ur });
  const uroki = urokiRaw.filter(({ UR }) => UR === ur);
  console.log({ uroki, ur });

  const urokiElement = document.querySelector('.rasp__uroki');

  const { preps, auds, grups, preds } = dictionaries;

  const html = uroki.map((urok) => {
    const { IDA, IDG, IDGG, IDD, IDP } = urok;
    return `<tr data-raw='${JSON.stringify(urok)}'>
      <td>${IDA === 0 ? '⬜' : auds[IDA]}</td>
      <td colspan="2">${grups[IDG]}[${IDGG}] ${preds[IDD]} ${preps[IDP]}</td>
    </tr>`;
  }).join('');

  urokiElement.innerHTML = html;
};

function prepareUroki(uroki, groupByKey, MAXPGG = 2, URMAX = 8) {
  if (!['IDA', 'IDG', 'IDP'].includes(groupByKey)) throw Error();

  const urokiResult = {};
  for (const urok of uroki) {
    const { ID, DAT, UR, IDG, IDGG, IDA, IDP, IDD } = urok;
    if (!urokiResult[DAT]) {
      urokiResult[DAT] = Array.from({ length: URMAX }, () => (new Object()));
    };
    const key = urok[groupByKey];
    if (!urokiResult[DAT][UR - 1][key]) {
      if (IDGG === 0) {
        urokiResult[DAT][UR - 1][key] = urok;
      } else {
        urokiResult[DAT][UR - 1][key] = Array.from({ length: MAXPGG }, () => (null));
      }
    }

    if (IDGG > 0) {
      urokiResult[DAT][UR - 1][key][IDGG - 1] = urok;
    } else {
      urokiResult[DAT][UR - 1][key] = urok;
    }

  }

  return urokiResult;
};

function prepareUrokiByAud(uroki) { return prepareUroki(uroki, 'IDA'); };
function prepareUrokiByGrup(uroki) { return prepareUroki(uroki, 'IDG'); };
function prepareUrokiByPrep(uroki) { return prepareUroki(uroki, 'IDP'); };

function createRaspElementHTML(urok, [start, center, end]) {
  const { preps, auds, grups, preds } = dictionaries;
  const dicts = { IDA: auds, IDG: grups, IDP: preps, IDD: preds };
  const validKeys = Object.keys(dicts);

  for (const id of [start, center, end]) {
    if (!validKeys.includes(id)) throw Error();
  };

  const { IDGG } = urok;
  return `<div class="rasp-elem">
    <span class="rasp-elem__start">${dicts[start][urok[start]]}${start === 'IDG' && IDGG > 0 ? `[${IDGG}]` : ''}</span>
    <span class="rasp-elem__center">${dicts[center][urok[center]]}${center === 'IDG' && IDGG > 0 ? `[${IDGG}]` : ''}</span>
    <span class="rasp-elem__end">${dicts[end][urok[end]]}${end === 'IDG' && IDGG > 0 ? `[${IDGG}]` : ''}</span>
  </div>`;
};

function createRaspOneDayHTML(uroki, groupByKey, MAXPGG = 2) {
  const { preps, auds, grups, preds } = dictionaries;
  const dicts = { IDA: auds, IDG: grups, IDP: preps, IDD: preds };
  const validKeys = ['IDA', 'IDG', 'IDP'];

  const urokiObj = prepareUroki(uroki, groupByKey, MAXPGG);

  const outputOrder = {
    IDA: ['IDG', 'IDD', 'IDP'],
    IDG: ['IDA', 'IDD', 'IDP'],
    IDP: ['IDG', 'IDD', 'IDA']
  };

  if (!validKeys.includes(groupByKey)) throw Error();

  const dateHTMLs = [];
  for (const [date, urs] of (Object.entries(urokiObj))) { // Для каждой даты
    const urHTMLs = [];
    let UR = 0;
    for (const ur of urs) { // Для каждой пары
      UR++;
      const groupHTMLs = [];
      for (const [id, urok] of Object.entries(ur)) { // Для каждой группировки
        const ID = parseInt(id, 10);
        const value = `${ID === 0 ? '' : dicts[groupByKey][ID]}`;
        const dataRaw = JSON.stringify(urok);
        let valueHTML;
        if (Array.isArray(urok)) {
          valueHTML = `<tr data-raw="${dataRaw}"><td>${value}</td>${urok.map((urokPGG) => {
            if (!urokPGG) return `<td></td>`;

            return `<td>${createRaspElementHTML(urokPGG, outputOrder[groupByKey])}</td>`;
          }).join('')}</tr>\n`;
        } else {
          valueHTML = `<tr data-raw="${dataRaw}"><td>${value}</td>
            <td colspan="${MAXPGG}">${createRaspElementHTML(urok, outputOrder[groupByKey])}</td>
          </tr>\n`;
        }

        groupHTMLs.push({ sortValue: value, valueHTML }); // Добавить урок
      };

      const groupByValue = {
        IDA: 'Ауд.',
        IDG: 'Группа',
        IDP: 'Препод.'
      }[groupByKey];

      const groupsHTML = groupHTMLs
        .sort(({ sortValue: a }, { sortValue: b }) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .map(({ valueHTML }) => valueHTML)
        .join('');

      const urHTML = groupHTMLs.length > 0
        ? `<details class="rasp__ur">
            <summary style="cursor: pointer;">Пара #${UR}. Количество занятий: ${Object.keys(ur).length}</summary>
            <table class="rasp-table">
              <thead>
                <tr>
                  <th>${groupByValue}</th>
                  <th colspan="${MAXPGG}">Занятие</th>
                </tr>
              </thead>
              <tbody>${groupsHTML}</tbody>
            </table>
          </details>`
        : `<details class="rasp__ur" onclick="return false;">
            <summary>Пара #${UR}. Количество занятий: ${Object.keys(ur).length}</summary>
          </details>`;

      urHTMLs.push(urHTML); // Добавить все уроки для пары
    }

    const dateHTML = `<section class="rasp__date-section">
      <h2>${date}</h2>
      ${urHTMLs.join('')}
    </section>`;
    dateHTMLs.push(dateHTML);

    break; // Только один день
  };

  const raspHTML = dateHTMLs.join('');

  return raspHTML;
}
