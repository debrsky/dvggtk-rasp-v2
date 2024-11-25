# This file is in Win1251 encoding; otherwise, Russian file names won't work.

# ������� ���������
$mdbPath = "C:\��������-���������� �������\raspis.mdb"
$zipPath = "C:\��������-���������� �������\raspis.json.zip"

# ��������� ��������
$url = "https://example.com/php/upload/upload.php"
$token = "API_TOKEN_HERE"

$tables = @('UROKI','SPGRUP','SPKAUD','SPPRED','SPPREP','RASP')

# ��������� ��������� � ��������� ������
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding("cp866")

Write-Host "Script started"

try {
    # ����������� � ���� ������
    $conn = New-Object System.Data.OleDb.OleDbConnection
    $conn.ConnectionString = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$mdbPath"
    $conn.Open()
    Write-Host "Connected successfully"
    
    # ������� ������� ��� �������� ������ ���� ������
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
                    
                    # ��� ������� SPPREP ���������� ������������ ����
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
            
            # ��������� ������ ������� � ����� �������
            $allData[$tableName] = $data
            Write-Host "Added to combined data"
        } else {
            Write-Host "Table is empty, skipping"
            $allData[$tableName] = @()
        }
    }

    # ������ ��������� ���� JSON
    $json = $allData | ConvertTo-Json -Depth 100
    $tempJsonPath = [System.IO.Path]::GetTempFileName() + ".json"

    # ���������� System.IO.StreamWriter ��� ���������� ����� ��� BOM
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false) # false �������� ��� BOM
    $writer = [System.IO.StreamWriter]::new($tempJsonPath, $false, $utf8WithoutBom)
    $writer.Write($json)
    $writer.Close()

    # ������ ��������� ���������� ��� �������������
    $tempDir = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "TempDir")
    if (-Not (Test-Path $tempDir)) {
        New-Item -ItemType Directory -Path $tempDir | Out-Null
    }

    # ���������� ���� JSON �� ��������� ���������� � ������������� ������
    $fixedJsonPath = [System.IO.Path]::Combine($tempDir, "rasp.json")
    if (Test-Path $fixedJsonPath) {
        Remove-Item $fixedJsonPath -Force
    }
    Move-Item -Path $tempJsonPath -Destination $fixedJsonPath -Force

    # ������ ZIP-�����
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }
    Compress-Archive -Path $tempDir\* -DestinationPath $zipPath

    # ���������� � ��������
    Add-Type -AssemblyName System.Net.Http
    $httpClient = New-Object System.Net.Http.HttpClient

    # ��������� ��������� �����������
    $httpClient.DefaultRequestHeaders.Authorization = 
        New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)

    # ������� ����� ������
    $form = New-Object System.Net.Http.MultipartFormDataContent
    $fileStream = [System.IO.File]::OpenRead($zipPath)

    # ��������� ���� � �����
    $fileContent = New-Object System.Net.Http.StreamContent($fileStream)
    $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/zip")
    $form.Add($fileContent, "archive", [System.IO.Path]::GetFileName($zipPath))

    # ���������� POST-������
    $response = $httpClient.PostAsync($url, $form).Result

    # �������� � ������� �����
    $responseString = $response.Content.ReadAsStringAsync().Result
    $jsonObject = $responseString | ConvertFrom-Json
    $formattedJson = $jsonObject | ConvertTo-Json -Depth 10
    Write-Output $formattedJson

    # ������� ��������� ���������� � ��������� �������
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