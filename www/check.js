import { updater } from './updater.js';

const onlineElement = document.querySelector('.online');
const lastModifiedElement = document.querySelector('.last-modified');

updater.onUpdate((err, status) => {
  const { isOnLine, isWaiting, metadata } = status;

  if (isWaiting) return;

  let statusText = isOnLine ? '🟢' : '🔴';

  onlineElement.textContent = statusText;

  const lastModifiedDate = new Date(metadata.lastModified);
  lastModifiedElement.setAttribute('datetime', lastModifiedDate.toISOString());
  lastModifiedElement.textContent =
    `${humanizeTime(Date.now() - lastModifiedDate.getTime())} назад (${lastModifiedDate.toLocaleString()})`;
});

updater.onUpdate((err, status) => console.log(status));

function humanizeTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} сек`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;

  const days = Math.floor(hours / 24);
  return `${days} дн`;
}
