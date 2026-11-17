Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]

function Await($asyncOp, $type) {
    if ($type) {
        $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | 
            Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } | 
            Select-Object -First 1
        $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($asyncOp))
    } else {
        $task = [System.WindowsRuntimeSystemExtensions]::AsTask($asyncOp)
    }
    $task.Wait()
    return $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$files = Get-ChildItem -Path "scratch\visual-audit-2026-11-12\*.png"
$sb = [System.Text.StringBuilder]::new()

foreach ($f in $files) {
    [void]$sb.AppendLine("==================================================")
    [void]$sb.AppendLine("FILE: $($f.Name)")
    [void]$sb.AppendLine("==================================================")
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($f.FullName)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $ocrResult = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    foreach ($line in $ocrResult.Lines) {
        $firstWord = $line.Words | Select-Object -First 1
        $top = [math]::Round($firstWord.BoundingRect.Top)
        $left = [math]::Round($firstWord.BoundingRect.Left)
        [void]$sb.AppendLine("[$top, $left] $($line.Text)")
    }
}
[System.IO.File]::WriteAllText("scratch\ocr_all_utf8.txt", $sb.ToString(), [System.Text.Encoding]::UTF8)
Write-Output "Done. Wrote $($sb.Length) chars to scratch\ocr_all_utf8.txt"
