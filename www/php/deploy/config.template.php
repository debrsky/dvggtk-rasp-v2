<?php
/**
 * Deploy Configuration
 *
 * Configuration file for deployment script.
 * Contains settings for authentication and directories.
 *
 * @author Claude from Anthropic
 */

return [
    'auth_token' => 'YOUR_TOKEN_HERE', // Токен авторизации
    'target_directory' => realpath(__DIR__ . '/../../'), // Целевая директория для развертывания
    'temp_directory' => sys_get_temp_dir(), // Временная директория для распаковки
];
