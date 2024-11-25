<?php

header('Content-Type: application/json');

// Загрузка конфигурации
$config = require_once __DIR__ . '/config.php';

// Проверка токена авторизации
$headers = getallheaders();
$token = isset($headers['Authorization']) ? str_replace('Bearer ', '', $headers['Authorization']) : null;

if (!$token || $token !== $config['auth_token']) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// Обработка POST запроса
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

try {
    $zip = new ZipArchive();
    if ($zip->open($uploadedFile) !== true) {
        throw new Exception('Failed to open archive');
    }

    // Извлекаем rasp.json в память
    $json_raw = $zip->getFromName('rasp.json');
    if ($json_raw === false) {
        throw new Exception('rasp.json not found in archive');
    }
    $zip->close();

    // Парсим JSON
    $jsonData = json_decode($json_raw, true);
    if ($jsonData === null && json_last_error() !== JSON_ERROR_NONE) {
        throw new Exception('Ошибка парсинга JSON: ' . json_last_error_msg());
    }

    // Проверка на наличие не UTF-8 символов (для большей уверенности)
    if (!mb_check_encoding($json_raw, 'UTF-8')) {
        throw new \Exception('JSON не в UTF-8 кодировке!');
    }

    // Удаление полей SPPREP.PHONE и SPPREP.ADRES
    if (isset($jsonData['SPPREP']) && is_array($jsonData['SPPREP'])) {
        foreach ($jsonData['SPPREP'] as &$item) {
            unset($item['PHONE']);
            unset($item['ADRESS']);
            unset($item['MEMO']);
        }
    }

    function convertDate($value, $timezone = '+10') {
        if (is_array($value)) {
            return array_map(function ($v) use ($timezone) { return convertDate($v, $timezone); }, $value);
        } elseif (preg_match('/^\/Date\((\d+)\)\/$/', $value, $matches)) {
            $timestamp = (int)($matches[1] / 1000);
            $dateTime = new DateTime('@' . $timestamp); // Создаем объект DateTime
            $dateTime->setTimezone(new DateTimeZone($timezone)); // Устанавливаем часовой пояс

            // Получаем компоненты даты и времени
            $date = $dateTime->format('Y-m-d');
            $time = $dateTime->format('H:i:s');

            // Проверяем, если время равно нулю
            if ($time === '00:00:00') {
                return $date; // Возвращаем только дату
            } else {
                return $dateTime->format('Y-m-d H:i:s'); // Возвращаем дату и время
            }
        } else {
            return $value;
        }
    }

    // Рекурсивно обрабатываем весь JSON
    $jsonData = convertDate($jsonData, '+10');

    // Сохраняем изменённый JSON
    $targetFile = $config['target_directory'] . '/rasp.json';
    if (!file_put_contents($targetFile, json_encode($jsonData, JSON_UNESCAPED_UNICODE))) {
        throw new Exception("Не удалось сохранить rasp.json");
    }

    echo json_encode(['ok' => true, 'message' => 'File processed successfully']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Processing failed', 'message' => $e->getMessage()]);
}
