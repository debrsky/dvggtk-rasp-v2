<?php
/**
 * Deploy Script
 *
 * This script handles deployment of files via ZIP archive upload.
 *
 * @author Claude from Anthropic
 */

// Фиксируем время начала выполнения скрипта
$startTime = microtime(true);

header('Content-Type: application/json');

// Загрузка конфигурации
$config = require_once __DIR__ . '/config.php';

// Проверка токена авторизации
$headers = getallheaders();
foreach ($headers as $key => $value) {
    if (strtolower($key) === 'authorization') {
        $token = str_replace('Bearer ', '', $value);
        break; // Exit the loop once the header is found
    }
}

if (!$token || $token !== $config['auth_token']) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// Единая функция для получения списка файлов
// Может возвращать как массив путей, так и массив с хешами файлов
function getFilesList($dir, $prefix = '', $includeHash = false) {
  $files = [];
  $items = array_diff(scandir($dir), array('.', '..'));

  foreach ($items as $item) {
      $path = $dir . '/' . $item;
      if (is_dir($path)) {
          $files = array_merge($files, getFilesList($path, $prefix . $item . '/', $includeHash));
      } else {
          if ($includeHash) {
              $files[$prefix . $item] = md5_file($path);
          } else {
              $files[] = $prefix . $item;
          }
      }
  }
  return $files;
}

// Если GET запрос - возвращаем список файлов с хешами
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $targetDir = $config['target_directory'];
  $files = getFilesList($targetDir, '', true); // Передаем true для включения хешей
  ksort($files);

  $executionTime = round(microtime(true) - $startTime, 3);

  echo json_encode([
      'ok' => true,
      'files' => $files,
      'execution_time' => $executionTime . ' sec'
  ]);
  exit;
}

// Для POST запроса продолжаем стандартный флоу
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'Method not allowed']);
  exit;
}

// Проверяем наличие загруженного файла
if (!isset($_FILES['archive']) || $_FILES['archive']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['error' => 'No file uploaded or upload error']);
    exit;
}

$uploadedFile = $_FILES['archive']['tmp_name'];
$targetDir = $config['target_directory'];

try {
    // Создаем временную директорию для распаковки
    $tempDir = $config['temp_directory'] . '/' . uniqid('deploy_');
    if (!mkdir($tempDir)) {
        throw new Exception('Failed to create temp directory');
    }

    // Распаковываем архив
    $zip = new ZipArchive();
    if ($zip->open($uploadedFile) !== true) {
        throw new Exception('Failed to open archive');
    }

    $zip->extractTo($tempDir);
    $zip->close();

    // Перемещаем файлы в целевую директорию
    if (!is_dir($targetDir)) {
      mkdir($targetDir, 0755, true);
    }

    $newFiles = [];
    $modifiedFiles = [];
    $missingFiles = []; // Массив для хранения файлов, отсутствующих в архиве


    // Получаем список всех файлов в целевой директории до копирования
    $existingFiles = getFilesList($targetDir, '', false); // Передаем false для получения только путей
    $tempFiles = getFilesList($tempDir, '', false);

    // Находим файлы, которые есть в целевой директории, но отсутствуют во временной
    $missingFiles = array_values(array_diff($existingFiles, $tempFiles));
    sort($missingFiles);


    // Рекурсивно копируем те файлы из временной директории, содержимое которых изменилось
    function recursiveCopy($src, $dst, &$newFiles, &$modifiedFiles, $baseDir) {
      $dir = opendir($src);
      if (!is_dir($dst)) {
          mkdir($dst);
      }
      while (($file = readdir($dir))) {
          if ($file != '.' && $file != '..') {
              $srcFile = $src . '/' . $file;
              $dstFile = $dst . '/' . $file;
              $relativePath = str_replace($baseDir . '/', '', $dstFile);

              if (is_dir($srcFile)) {
                  recursiveCopy($srcFile, $dstFile, $newFiles, $modifiedFiles, $baseDir);
              } else {
                  // Проверяем существует ли файл в целевой директории
                  if (!file_exists($dstFile)) {
                      // Новый файл - копируем
                      copy($srcFile, $dstFile);
                      $newFiles[] = $relativePath;
                  } else {
                      // Сравниваем содержимое файлов
                      $srcHash = md5_file($srcFile);
                      $dstHash = md5_file($dstFile);

                      if ($srcHash !== $dstHash) {
                          // Содержимое изменилось - копируем
                          copy($srcFile, $dstFile);
                          $modifiedFiles[] = $relativePath;
                      }
                  }
              }
          }
      }
      closedir($dir);
  }

  recursiveCopy($tempDir, $targetDir, $newFiles, $modifiedFiles, $targetDir);

  // Очищаем временные файлы
  function recursiveDelete($dir) {
      if (is_dir($dir)) {
          $files = array_diff(scandir($dir), array('.', '..'));
          foreach ($files as $file) {
              $path = $dir . '/' . $file;
              is_dir($path) ? recursiveDelete($path) : unlink($path);
          }
          return rmdir($dir);
      }
    }

    recursiveDelete($tempDir);

    // Вычисляем время выполнения скрипта в секундах
    $executionTime = round(microtime(true) - $startTime, 3);

    echo json_encode([
        'ok' => true,
        'message' => 'Archive successfully deployed',
        'missing_files' => $missingFiles,
        'new_files' => $newFiles,
        'modified_files' => $modifiedFiles,
        'execution_time' => $executionTime . ' sec'
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Deployment failed',
        'message' => $e->getMessage(),
        'execution_time' => $executionTime . ' sec'
    ]);

    // Очистка в случае ошибки
    if (isset($tempDir) && is_dir($tempDir)) {
        recursiveDelete($tempDir);
    }
}
