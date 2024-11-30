// TODO Сделать рендеринг потоков -- когда несколько групп на одном занятии

const CONFIG = {
  MAXPGG: null,
  DICTS: null
};

export function generateRaspHTML(urokiObj, groupBy, outputOrder, MAXPGG, dicts) {
  if (!dicts) throw new Error('Dictionaries are required');

  CONFIG.MAXPGG = MAXPGG;
  CONFIG.DICTS = dicts;

  const dateHTMLs = [];

  const urokiSortedByDate = Object.entries(urokiObj)
    .sort(([a], [b]) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    })

  for (const [date, urs] of urokiSortedByDate) {
    const urHTML = groupBy.value
      ? generateFilteredDayHTML(urs, groupBy, outputOrder)
      : generateFullDayHTML(urs, groupBy, outputOrder);

    const dateHTML = createDateSectionHTML(date, urHTML);
    dateHTMLs.push(dateHTML);

    // break; // только один день
  }

  return dateHTMLs.join('');
}

function createUrokHTML(urok, [start, center, end]) {
  const createUrokPart = (key) => {
    if (!CONFIG.DICTS[key]) throw Error(`Dictionary for ${key} not found`);
    const value = CONFIG.DICTS[key][urok[key]];
    const subgroupMark = key === 'IDG' && urok.IDGG > 0 ? `[${urok.IDGG}]` : '';
    return escapeHtml(`${value}${subgroupMark}`);
  };

  return `
    <div class="rasp-urok" data-urok-id="${urok.ID}">
      <div class="rasp-urok__start">${createUrokPart(start)}</div>
      <span class="rasp-urok__center">${createUrokPart(center)}</span>
      <div class="rasp-urok__end">${createUrokPart(end)}</div>
    </div>
  `;
}


function getEmojiByDate(date) {
  const emojis = [
    '☕', // Воскресенье
    '🚀', // Понедельник
    '📈', // Вторник
    '🔬', // Среда
    '📊', // Четверг
    '📝', // Пятница
    '📖'  // Суббота
  ];

  const dayOfWeek = date.getDay();
  return emojis[dayOfWeek];
}


function createDateSectionHTML(date, urHTML) {
  const options = {
    weekday: 'long', // длинное название дня недели
    month: 'long',    // длинное название месяца
    day: 'numeric'    // числовое значение дня
  };

  const dateValue = new Date(date);
  const dateText = dateValue.toLocaleDateString(navigator.language, options);
  const dateEmoji = getEmojiByDate(dateValue);

  return `
    <section class="rasp__date-section">
      <h2 class="rasp__date-title">${dateEmoji} ${dateText}</h2>
      ${urHTML}
    </section>
  `;
}

function generateFilteredDayHTML(urs, groupBy, outputOrder) {
  const urokHTMLs = [];

  urs.forEach((ur, index) => {
    const UR = index + 1;
    let urokHTML;
    const urok = ur[groupBy.value];

    if (!urok) {
      urokHTML = `<td colspan="${CONFIG.MAXPGG}" class="rasp__urok rasp__urok--empty"></td>`;
    } else if (Array.isArray(urok)) {
      urokHTML = urok.map((urokPGG) => {
        if (!urokPGG) return `<td class="rasp__urok rasp__urok--empty"></td>`;
        return `<td class="rasp__urok">${createUrokHTML(urokPGG, outputOrder)}</td>`;
      }).join('');
    } else {
      urokHTML = `<td colspan="${CONFIG.MAXPGG}" class="rasp__urok">
        ${createUrokHTML(urok, outputOrder)}
      </td>\n`;
    }

    urokHTMLs.push(`<tr>
      <td>${UR}</td>
      ${urokHTML}
    </tr>`);
  });

  const firstColWidth = '2ch';
  return `
    <table class="rasp__table rasp__table--day-filtered">
      <colgroup>
        <col style="width: ${firstColWidth};">
        ${Array.from({ length: CONFIG.MAXPGG },
    () => `<col style="width: calc((100% - ${firstColWidth})/${CONFIG.MAXPGG});">\n`).join('')}
      </colgroup>
      <thead>
        <tr>
          <th class="rasp__ur-title">Пара</th>
          <th colspan="${CONFIG.MAXPGG}" class="rasp__ur-title">Занятие</th>
        </tr>
      </thead>
      <tbody>${urokHTMLs.join('')}</tbody>
    </table>\n`;
}

function generateFullDayHTML(urs, groupBy, outputOrder) {
  const urHTMLs = urs.map((ur, index) => {
    const UR = index + 1;
    if (Object.keys(ur).length === 0) {
      return createEmptyUrHTML(UR);
    }

    const groupHTMLs = Object.entries(ur)
      .map(([id, urok]) => createGroupHTML(id, urok, groupBy, outputOrder))
      .sort((a, b) => a.sortValue.localeCompare(b.sortValue, undefined, { sensitivity: 'base' }));

    return createUrDetailsHTML(UR, groupHTMLs, groupBy.key);
  });

  return urHTMLs.join('');
}

function createEmptyUrHTML(urNumber) {
  return `
    <details class="details rasp__ur" onclick="return false;">
      <summary>Пара #${urNumber}. Количество занятий: 0</summary>
    </details>
  `;
}

function createGroupHTML(id, urok, groupBy, outputOrder) {
  const ID = parseInt(id, 10);
  const groupFieldValue = `${CONFIG.DICTS[groupBy.key][ID]}`;

  let html;
  if (Array.isArray(urok)) {
    html = createSubgroupsHTML(urok, groupFieldValue, outputOrder);
  } else {
    html = createSingleGroupHTML(urok, groupFieldValue, outputOrder);
  }

  return {
    sortValue: groupFieldValue,
    html
  };
}

function createSubgroupsHTML(urok, groupFieldValue, outputOrder) {
  const subgroupCells = urok.map(urokPGG => {
    if (!urokPGG) {
      return `<td class="rasp__urok rasp__urok--empty"></td>`;
    }
    return `
      <td class="rasp__urok">
        ${createUrokHTML(urokPGG, outputOrder)}
      </td>
    `;
  }).join('');

  return `
    <tr>
      <td class="rasp__group-field-value">${escapeHtml(groupFieldValue)}</td>
      ${subgroupCells}
    </tr>
  `;
}

function createSingleGroupHTML(urok, groupFieldValue, outputOrder) {
  return `
    <tr>
      <td class="rasp__group-field-value">${escapeHtml(groupFieldValue)}</td>
      <td colspan="${CONFIG.MAXPGG}" class="rasp__urok">
        ${createUrokHTML(urok, outputOrder)}
      </td>
    </tr>
  `;
}

function createUrDetailsHTML(urNumber, groupHTMLs, groupByKey) {
  const groupByLabel = {
    IDA: 'Ауд.',
    IDG: 'Группа',
    IDP: 'Препод.'
  }[groupByKey];

  const lessonCount = groupHTMLs.length;
  if (lessonCount === 0) {
    return createEmptyUrHTML(urNumber);
  }

  const firstColWidth = '12ch';
  const tableHTML = `
    <table class="rasp__table rasp__table--one-day">
      <colgroup>
        <col style="width: ${firstColWidth};">
        ${Array.from({ length: CONFIG.MAXPGG },
    () => `<col
              style="width: calc((100% - ${firstColWidth})/${CONFIG.MAXPGG});"
          >\n`).join('')}
      </colgroup>
      <thead>
        <tr>
          <th>${groupByLabel}</th>
          <th colspan="${CONFIG.MAXPGG}">Занятие</th>
        </tr>
      </thead>
      <tbody>
        ${groupHTMLs.map(({ html }) => html).join('')}
      </tbody>
    </table>
  `;

  return `
    <details class="details rasp_ur">
      <summary style="cursor: pointer;">
        Пара #${urNumber}. Всего занятий: ${lessonCount}
      </summary>
      ${tableHTML}
    </details>
  `;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
