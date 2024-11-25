import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { FormData } from 'formdata-node';
import { fileFromPath } from "formdata-node/file-from-path";
import archiver from 'archiver';

const DEPLOYMENT_SOURCE_DIR = 'www/';
const IGNORED_FILES = [
  'db/rasp.json'
];

async function deployZ() {
  // Проверяем обязательные переменные окружения
  const requiredEnvVars = ['DEPLOY_URL', 'DEPLOY_TOKEN'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('Ошибка: не установлены следующие переменные:');
    missingVars.forEach(varName => console.error(`- ${varName}`));
    process.exit(1);
  }

  const outputFile = path.join(os.tmpdir(), `temp-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);

  const serverFileList = {};

  // get file list
  try {
    const url = process.env.DEPLOY_URL;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.DEPLOY_TOKEN}`,
      }
    });

    console.log('Запрос списка файлов:', response.status, response.statusText);
    if (!response.ok) {
      const text = await response.text();
      console.log(text);
      throw new Error('Deploy failed');
    }

    const result = await response.json();
    Object.assign(serverFileList, result.files);
    Object.entries(serverFileList).forEach(([key, value]) => {
      serverFileList[key] = value.replace(/\\/g, '/');
    })

    console.log('Получен список файлов, всего файлов:', Object.keys(serverFileList).length);
  } catch (error) {
    console.error('Ошибка получения списка файлов:', error);
    process.exit(1);
  }

  // Create archive
  const output = fs.createWriteStream(outputFile);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });

  const filesToDeploy = [];

  return new Promise((resolve, reject) => {
    output.on('close', async () => {
      // Если нет файлов для деплоя, завершаем процесс
      if (filesToDeploy.length === 0) {
        console.log("Нет измененных файлов, нечего деплоить");
        await fsPromises.unlink(outputFile).catch(() => { });
        process.exit(0);
      }

      console.log('Архив создан');

      let fileStat;
      try {
        fileStat = await fsPromises.stat(outputFile);
        console.log('Archive created:', outputFile, fileStat.size);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        console.log("Ошибка при создании архива");
        process.exit(1);
      }

      // Send archive to server
      try {
        const formData = new FormData();
        formData.append('archive', await fileFromPath(outputFile));

        const url = process.env.DEPLOY_URL;
        const response = await fetch(url, {
          method: 'POST',
          body: formData,
          headers: {
            'Authorization': `Bearer ${process.env.DEPLOY_TOKEN}`,
          }
        });

        console.log('Отправка архива:', response.status, response.statusText);
        if (!response.ok) {
          const text = await response.text();
          console.log(text);
          throw new Error('Deploy failed');
        }

        const result = await response.json();
        delete result.missing_files;

        console.log(result);
        console.log('Deploy successful:', result.message);

        // Clean up archive file
        await fsPromises.unlink(outputFile);
        resolve(result);
        process.exit(0);
      } catch (error) {
        console.error('Deploy error:', error.message);
        await fsPromises.unlink(outputFile).catch(() => { });
        process.exit(1);
      }
    });

    archive.on('error', (err) => {
      console.error('Ошибка создания архива:', err);
      process.exit(1);
    });

    archive.pipe(output);

    // Add files from 'public' directory to archive
    async function addFiles(dir) {
      const files = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        const filePath = path.join(dir, file.name);
        const relativePath = path.relative(DEPLOYMENT_SOURCE_DIR, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/');

        // Проверка на игнорируемые файлы и директории
        if (IGNORED_FILES.some(ignored => normalizedPath.startsWith(ignored))) {
          console.log('Пропускаю файл:', [normalizedPath]);
          continue;
        }

        if (file.isDirectory()) {
          await addFiles(filePath);
        } else {
          const fileContents = await fsPromises.readFile(filePath);
          const hash = crypto.createHash('md5');
          hash.update(fileContents);
          const md5 = hash.digest('hex');
          const isFileModified = md5 !== serverFileList[normalizedPath];
          delete serverFileList[normalizedPath];

          if (isFileModified) {
            console.log('to deploy:', normalizedPath, fileContents.length);
            archive.append(fileContents, { name: relativePath });
            filesToDeploy.push(normalizedPath);
          }
        }
      }
    }

    addFiles(DEPLOYMENT_SOURCE_DIR).then(() => {
      // После добавления локальных файлов выводим оставшиеся файлы с сервера
      console.log('\nФайлы на сервере, отсутствующие в списке на деплой:');
      console.log(Object.keys(serverFileList));

      archive.finalize();
    }).catch(err => {
      console.error('Ошибка при добавлении файлов:', err);
      process.exit(1);
    });
  });
}

// Запуск деплоя
deployZ();
