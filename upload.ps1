# Базовые параметры
$mdbPath = "C:\Экспресс-расписание Колледж\raspis.mdb"
$zipPath = "C:\Экспресс-расписание Колледж\raspis.json.zip"

# Параметры выгрузки
$url = "https://example.com/php/upload/upload.php"
$token = "API_TOKEN_HERE"

$mdbPathFixedEncoding = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::Default.GetBytes($mdbPath));
$zipPathFixedEncoding = [System.Text.Encoding]::UTF8.GetString([System.Text.Encoding]::Default.GetBytes($zipPath));

$tables = @('UROKI','SPGRUP','SPKAUD','SPPRED','SPPREP','RASP')

# Настройка кодировки и обработки ошибок
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding("cp866")

Write-Host "Script started"

try {
    # Подключение к базе данных
    $conn = New-Object System.Data.OleDb.OleDbConnection
    $conn.ConnectionString = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$mdbPathFixedEncoding"
    $conn.Open()
    Write-Host "Connected successfully"

    # Создаем словарь для хранения данных всех таблиц
    $allData = @{}

    foreach($tableName in $tables) {
        Write-Host "`nProcessing table: $tableName"

        $cmd = New-Object System.Data.OleDb.OleDbCommand("SELECT COUNT(*) FROM [$tableName]", $conn)
        $count = $cmd.ExecuteScalar()
        Write-Host "Found $count records"

        if($count -gt 0) {
            $data = @()
            $cmd.CommandText = "SELECT * FROM [$tableName]"
            $reader = $cmd.ExecuteReader()

            Write-Host "Reading records..."
            while ($reader.Read()) {
                $row = @{}
                for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                    $fieldName = $reader.GetName($i)

                    # Для таблицы SPPREP пропускаем определенные поля
                    if ($tableName -eq "SPPREP" -and ($fieldName -in @('ADRESS', 'PHONE', 'MEMO'))) {
                        continue
                    }

                    $row[$fieldName] = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) }
                }
                $data += [PSCustomObject]$row

                if($data.Count % 1000 -eq 0) {
                    Write-Host "Read $($data.Count) records..."
                }
            }
            $reader.Close()

            # Добавляем данные таблицы в общий словарь
            $allData[$tableName] = $data
            Write-Host "Added to combined data"
        } else {
            Write-Host "Table is empty, skipping"
            $allData[$tableName] = @()
        }
    }

    # Создаём временный файл JSON
    $json = $allData | ConvertTo-Json -Depth 100
    $tempJsonPath = [System.IO.Path]::GetTempFileName() + ".json"

    # Используем System.IO.StreamWriter для сохранения файла без BOM
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false) # false означает без BOM
    $writer = [System.IO.StreamWriter]::new($tempJsonPath, $false, $utf8WithoutBom)
    $writer.Write($json)
    $writer.Close()

    # Создаём временную директорию для архивирования
    $tempDir = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "TempDir")
    if (-Not (Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
    }

    # Перемещаем файл JSON во временную директорию с фиксированным именем
    $fixedJsonPath = [System.IO.Path]::Combine($tempDir, "rasp.json")
    if (Test-Path $fixedJsonPath) {
        Remove-Item $fixedJsonPath -Force
    }
    Move-Item -Path $tempJsonPath -Destination $fixedJsonPath -Force

    # Создаём ZIP-архив
    if (Test-Path $zipPathFixedEncoding) {
        Remove-Item $zipPathFixedEncoding -Force
    }
    Compress-Archive -Path $tempDir\* -DestinationPath $zipPathFixedEncoding

    # Подготовка к отправке
    Add-Type -AssemblyName System.Net.Http
    $httpClient = New-Object System.Net.Http.HttpClient

    # Добавляем заголовок авторизации
    $httpClient.DefaultRequestHeaders.Authorization =
        New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)

    # Создаем форму данных
    $form = New-Object System.Net.Http.MultipartFormDataContent
    $fileStream = [System.IO.File]::OpenRead($zipPathFixedEncoding)

    # Добавляем файл к форме
    $fileContent = New-Object System.Net.Http.StreamContent($fileStream)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/zip")
    $form.Add($fileContent, "archive", [System.IO.Path]::GetFileName($zipPathFixedEncoding))

    # Отправляем POST-запрос
    $response = $httpClient.PostAsync($url, $form).Result

    # Проверяем статус код
    if ($response.IsSuccessStatusCode) {
        # Получаем и выводим ответ
        $responseString = $response.Content.ReadAsStringAsync().Result
        $jsonObject = $responseString | ConvertFrom-Json
        $formattedJson = $jsonObject | ConvertTo-Json -Depth 10
        Write-Output $formattedJson
    } else {
        # Обработка ошибки
        $statusCode = [int]$response.StatusCode
        Write-Host "POST request failed with status code $statusCode ($($response.StatusCode.ToString()))" -ForegroundColor Red
        Write-Host "Response content: $($response.Content.ReadAsStringAsync().Result)" -ForegroundColor Red
        throw "POST request failed with status code $statusCode ($($response.StatusCode.ToString()))" # Перебрасываем ошибку с кодом статуса
    }

    # Удаляем временную директорию и закрываем ресурсы
    Remove-Item $tempDir -Recurse -Force
    $fileStream.Close()
    $httpClient.Dispose()
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Stack Trace: $($_.Exception.StackTrace)" -ForegroundColor Red
}
finally {
    if ($conn) {
        $conn.Close()
        Write-Host "`nConnection closed"
    }
    Write-Host "Script finished"
}
