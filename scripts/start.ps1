param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$rootFull = [System.IO.Path]::GetFullPath($projectRoot)
$separator = [System.IO.Path]::DirectorySeparatorChar
$rootWithSeparator = if ($rootFull.EndsWith($separator)) { $rootFull } else { "$rootFull$separator" }

function Get-MimeType {
  param([string]$Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".js" { return "application/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".txt" { return "text/plain; charset=utf-8" }
    ".svg" { return "image/svg+xml" }
    ".png" { return "image/png" }
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".webp" { return "image/webp" }
    default { return "application/octet-stream" }
  }
}

function Write-Response {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body,
    [bool]$HeadersOnly = $false
  )

  if ($null -eq $Body) {
    $Body = [byte[]]::new(0)
  }

  $headerText = "HTTP/1.1 $StatusCode $StatusText`r`n" +
    "Content-Type: $ContentType`r`n" +
    "Content-Length: $($Body.Length)`r`n" +
    "Cache-Control: no-cache`r`n" +
    "Connection: close`r`n" +
    "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)

  if (-not $HeadersOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

function Write-TextResponse {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [string]$Text,
    [bool]$HeadersOnly = $false
  )

  $body = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Write-Response -Stream $Stream -StatusCode $StatusCode -StatusText $StatusText -ContentType "text/plain; charset=utf-8" -Body $body -HeadersOnly $HeadersOnly
}

function Test-PortAvailable {
  param([int]$Port)

  $probe = $null

  try {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $probe.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($null -ne $probe) {
      $probe.Stop()
    }
  }
}

$port = 5173
while (-not (Test-PortAvailable -Port $port)) {
  $port++

  if ($port -gt 5273) {
    throw "No available local port found from 5173 to 5273."
  }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()

$url = "http://127.0.0.1:$port/index.html"

Write-Host "AiTypeMoon local server is running."
Write-Host "Project root: $rootFull"
Write-Host "URL: $url"
Write-Host "Press Ctrl+C to stop."

if (-not $NoBrowser) {
  Start-Process $url
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $null

    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        continue
      }

      while ($true) {
        $headerLine = $reader.ReadLine()

        if ($null -eq $headerLine -or $headerLine.Length -eq 0) {
          break
        }
      }

      $parts = $requestLine -split " "

      if ($parts.Count -lt 2) {
        Write-TextResponse -Stream $stream -StatusCode 400 -StatusText "Bad Request" -Text "Bad request."
        continue
      }

      $method = $parts[0].ToUpperInvariant()
      $rawPath = ($parts[1] -split "\?")[0]
      $headersOnly = $method -eq "HEAD"

      if ($method -ne "GET" -and $method -ne "HEAD") {
        Write-TextResponse -Stream $stream -StatusCode 405 -StatusText "Method Not Allowed" -Text "Method not allowed." -HeadersOnly $headersOnly
        continue
      }

      $decodedPath = [System.Uri]::UnescapeDataString($rawPath)

      if ($decodedPath -eq "/") {
        $decodedPath = "/index.html"
      }

      $relativePath = $decodedPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
      $fullPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($rootFull, $relativePath))
      $isInsideRoot = $fullPath.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)

      if (-not $isInsideRoot) {
        Write-TextResponse -Stream $stream -StatusCode 403 -StatusText "Forbidden" -Text "Forbidden." -HeadersOnly $headersOnly
        continue
      }

      if ([System.IO.Directory]::Exists($fullPath)) {
        $fullPath = [System.IO.Path]::Combine($fullPath, "index.html")
      }

      if (-not [System.IO.File]::Exists($fullPath)) {
        Write-TextResponse -Stream $stream -StatusCode 404 -StatusText "Not Found" -Text "Not found." -HeadersOnly $headersOnly
        continue
      }

      $body = [System.IO.File]::ReadAllBytes($fullPath)
      Write-Response -Stream $stream -StatusCode 200 -StatusText "OK" -ContentType (Get-MimeType -Path $fullPath) -Body $body -HeadersOnly $headersOnly
    } catch {
      if ($null -ne $stream) {
        Write-TextResponse -Stream $stream -StatusCode 500 -StatusText "Internal Server Error" -Text "Internal server error."
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
