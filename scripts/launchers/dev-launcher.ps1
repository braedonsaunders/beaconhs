$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "../..")).Path
Set-Location $RepoRoot

$AppUrl = if ($env:BEACONHS_APP_URL) { $env:BEACONHS_APP_URL } else { "http://localhost:3000" }
$OpenBrowser = if ($env:BEACONHS_OPEN_BROWSER) { $env:BEACONHS_OPEN_BROWSER } else { "1" }
$SkipInstall = if ($env:BEACONHS_SKIP_INSTALL) { $env:BEACONHS_SKIP_INSTALL } else { "0" }
$ForceInstall = if ($env:BEACONHS_FORCE_INSTALL) { $env:BEACONHS_FORCE_INSTALL } else { "0" }
$SkipDocker = if ($env:BEACONHS_SKIP_DOCKER) { $env:BEACONHS_SKIP_DOCKER } else { "0" }
$SkipDockerPull = if ($env:BEACONHS_SKIP_DOCKER_PULL) { $env:BEACONHS_SKIP_DOCKER_PULL } else { "0" }
$KeepDocker = if ($env:BEACONHS_KEEP_DOCKER) { $env:BEACONHS_KEEP_DOCKER } else { "0" }
$DockerDownOnExit = if ($env:BEACONHS_DOCKER_DOWN_ON_EXIT) { $env:BEACONHS_DOCKER_DOWN_ON_EXIT } else { "0" }
$DbMode = if ($env:BEACONHS_DB_MODE) { $env:BEACONHS_DB_MODE } else { "auto" }
$DbSetup = if ($env:BEACONHS_DB_SETUP) { $env:BEACONHS_DB_SETUP } else { "auto" }
$DbGenerate = if ($env:BEACONHS_DB_GENERATE) { $env:BEACONHS_DB_GENERATE } else { "0" }

$script:DevProcess = $null
$script:BrowserJob = $null
$script:PreExistingDockerIds = @()
$script:CleanedUp = $false
$script:EnvWasCreated = $false
$script:DockerComposeArgs = @("compose")

function Write-LauncherLog {
  param([string] $Message)
  Write-Host "[beaconhs] $Message" -ForegroundColor Cyan
}

function Write-LauncherWarn {
  param([string] $Message)
  Write-Warning "[beaconhs] $Message"
}

function Stop-WithMessage {
  param([string] $Message)
  Write-Host "[beaconhs] $Message" -ForegroundColor Red
  exit 1
}

function Test-Command {
  param([string] $Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Pnpm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)

  if (Test-Command "pnpm") {
    & pnpm @Arguments
  } elseif (Test-Command "corepack") {
    & corepack pnpm @Arguments
  } else {
    Stop-WithMessage "pnpm was not found and Corepack is unavailable. Install pnpm or Node 20+."
  }

  if ($LASTEXITCODE -ne 0) {
    throw "pnpm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Invoke-DockerCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]] $Arguments)

  $allArguments = @($script:DockerComposeArgs) + @($Arguments)
  & docker @allArguments
}

function Stop-ProcessTree {
  param([int] $ProcessId)

  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int] $child.ProcessId)
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-LauncherDocker {
  if ($SkipDocker -eq "1" -or $KeepDocker -eq "1") {
    return
  }

  if (-not (Test-Command "docker")) {
    return
  }

  try {
    Invoke-DockerCompose version *> $null
    if ($LASTEXITCODE -ne 0) {
      return
    }
  } catch {
    return
  }

  if ($DockerDownOnExit -eq "1") {
    Write-LauncherLog "Stopping Docker Compose services with docker compose down..."
    Invoke-DockerCompose down --remove-orphans *> $null
    return
  }

  $runningIds = @(Invoke-DockerCompose ps -q --status running 2>$null)
  $idsToStop = @($runningIds | Where-Object { $script:PreExistingDockerIds -notcontains $_ })

  if ($idsToStop.Count -gt 0) {
    Write-LauncherLog "Stopping Docker containers started by this launcher..."
    & docker stop @idsToStop *> $null
  }
}

function Invoke-Cleanup {
  if ($script:CleanedUp) {
    return
  }
  $script:CleanedUp = $true

  if ($script:BrowserJob) {
    Stop-Job $script:BrowserJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job $script:BrowserJob -Force -ErrorAction SilentlyContinue | Out-Null
  }

  if ($script:DevProcess -and -not $script:DevProcess.HasExited) {
    Write-LauncherLog "Stopping BeaconHS dev processes..."
    Stop-ProcessTree -ProcessId $script:DevProcess.Id
  }

  Stop-LauncherDocker
}

function Ensure-EnvFile {
  if (Test-Path ".env") {
    Write-LauncherLog "Using existing .env"
    return
  }

  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    $script:EnvWasCreated = $true
    Write-LauncherWarn "Created .env from .env.example. Review DATABASE_URL if this machine uses the shared dev cluster."
    return
  }

  Write-LauncherWarn "No .env or .env.example found. Continuing with process environment only."
}

function Get-EnvFileValue {
  param([string] $Key)

  if (-not (Test-Path ".env")) {
    return ""
  }

  $match = Select-String -Path ".env" -Pattern "^$([regex]::Escape($Key))=(.*)$" | Select-Object -First 1
  if (-not $match) {
    return ""
  }

  return $match.Matches[0].Groups[1].Value.Trim("'`"")
}

function Test-DatabaseUrlIsLocal {
  param([string] $DatabaseUrl)

  return $DatabaseUrl -match "localhost|127\.0\.0\.1|::1"
}

function Resolve-DatabaseMode {
  $databaseUrl = Get-EnvFileValue "DATABASE_URL"

  switch ($DbMode) {
    "auto" {
      if (Test-DatabaseUrlIsLocal $databaseUrl) {
        $script:ResolvedDbMode = "local"
      } else {
        $script:ResolvedDbMode = "remote"
      }
    }
    "local" {
      $script:ResolvedDbMode = "local"
    }
    "remote" {
      $script:ResolvedDbMode = "remote"
    }
    default {
      Stop-WithMessage "BEACONHS_DB_MODE must be auto, local, or remote."
    }
  }

  if ($script:ResolvedDbMode -eq "local") {
    $script:DockerComposeArgs = @("compose", "--profile", "local-db")
    Write-LauncherLog "Database mode: local Docker Postgres profile."
    if ($databaseUrl -and -not (Test-DatabaseUrlIsLocal $databaseUrl)) {
      Write-LauncherWarn "BEACONHS_DB_MODE=local, but DATABASE_URL does not look local. Update .env or set BEACONHS_DB_MODE=remote."
    }
  } else {
    $script:DockerComposeArgs = @("compose")
    Write-LauncherLog "Database mode: remote/existing DATABASE_URL. Local Postgres will not be started."
    if (Test-DatabaseUrlIsLocal $databaseUrl) {
      Write-LauncherWarn "DATABASE_URL looks local, but BEACONHS_DB_MODE=remote. Set BEACONHS_DB_MODE=local to start local Postgres."
    }
  }
}

function Ensure-NodeAndPnpm {
  if (-not (Test-Command "node")) {
    Stop-WithMessage "Node.js is required. Install Node 20+ and run this launcher again."
  }

  $major = [int](& node -p "Number(process.versions.node.split('.')[0])")
  if ($major -lt 20) {
    Stop-WithMessage "Node.js 20+ is required. Current version: $(& node -v)"
  }

  $packageManager = & node -p "require('./package.json').packageManager || 'pnpm@latest'"
  if (Test-Command "corepack") {
    Write-LauncherLog "Preparing $packageManager with Corepack..."
    & corepack enable *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-LauncherWarn "Corepack enable failed; continuing with existing pnpm if available."
    }
    & corepack prepare $packageManager --activate *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-LauncherWarn "Corepack prepare failed; continuing with existing pnpm if available."
    }
  }

  if (-not (Test-Command "pnpm") -and -not (Test-Command "corepack")) {
    Stop-WithMessage "pnpm was not found and Corepack is unavailable. Install pnpm or Node 20+."
  }
}

function Test-DependenciesNeedInstall {
  if ($ForceInstall -eq "1") {
    return $true
  }

  $stamp = Join-Path $RepoRoot "node_modules/.modules.yaml"
  if (-not (Test-Path $stamp)) {
    return $true
  }

  $stampTime = (Get-Item $stamp).LastWriteTimeUtc
  $paths = @("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml")
  $paths += @(Get-ChildItem "apps" -Filter "package.json" -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  $paths += @(Get-ChildItem "packages" -Filter "package.json" -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })

  foreach ($path in $paths) {
    if ((Test-Path $path) -and (Get-Item $path).LastWriteTimeUtc -gt $stampTime) {
      return $true
    }
  }

  return $false
}

function Install-DependenciesIfNeeded {
  if ($SkipInstall -eq "1") {
    Write-LauncherLog "Skipping dependency install because BEACONHS_SKIP_INSTALL=1"
    return
  }

  if (Test-DependenciesNeedInstall) {
    Write-LauncherLog "Installing dependencies with pnpm..."
    Invoke-Pnpm install --frozen-lockfile
  } else {
    Write-LauncherLog "Dependencies look current."
  }
}

function Ensure-Docker {
  if ($SkipDocker -eq "1") {
    Write-LauncherLog "Skipping Docker because BEACONHS_SKIP_DOCKER=1"
    return
  }

  if (-not (Test-Command "docker")) {
    Stop-WithMessage "Docker is required for Redis, MinIO, and Mailpit."
  }

  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Docker is not running. Start Docker Desktop or the Docker daemon, then run this launcher again."
  }

  Invoke-DockerCompose version *> $null
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage "Docker Compose v2 is required."
  }
}

function Wait-ForComposeHealth {
  $ids = @(Invoke-DockerCompose ps -q 2>$null)
  foreach ($id in $ids) {
    $name = & docker inspect -f '{{.Name}}' $id 2>$null
    if ($name) {
      $name = $name.TrimStart("/")
    } else {
      $name = $id
    }

    $status = & docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $id 2>$null
    if ($status -eq "none") {
      continue
    }

    Write-LauncherLog "Waiting for $name to become healthy..."
    for ($attempt = 1; $attempt -le 60; $attempt++) {
      $status = & docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $id 2>$null
      if ($status -eq "healthy") {
        Write-LauncherLog "$name is healthy."
        break
      }
      Start-Sleep -Seconds 2
    }

    if ($status -ne "healthy") {
      Write-LauncherWarn "$name did not report healthy yet. Continuing; check Docker logs if the app cannot connect."
    }
  }
}

function Start-DockerServices {
  if ($SkipDocker -eq "1") {
    return
  }

  $script:PreExistingDockerIds = @(Invoke-DockerCompose ps -q --status running 2>$null)

  if ($SkipDockerPull -ne "1") {
    Write-LauncherLog "Pulling Docker images..."
    Invoke-DockerCompose pull --ignore-pull-failures
    if ($LASTEXITCODE -ne 0) {
      Write-LauncherWarn "Docker image pull had warnings; using local images where available."
    }
  } else {
    Write-LauncherLog "Skipping Docker image pull because BEACONHS_SKIP_DOCKER_PULL=1"
  }

  Write-LauncherLog "Starting Docker Compose services..."
  Invoke-DockerCompose up -d
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed with exit code $LASTEXITCODE"
  }

  Wait-ForComposeHealth
}

function Warn-AboutEnvPorts {
  if ($SkipDocker -eq "1" -or -not (Test-Path ".env")) {
    return
  }

  $redisPortLine = Invoke-DockerCompose port redis 6379 2>$null
  if (-not $redisPortLine) {
    return
  }

  $redisPort = ($redisPortLine -split ":")[-1]
  $envText = Get-Content ".env" -Raw
  if ($redisPort -and $redisPort -ne "6379" -and $envText -match "(?m)^REDIS_URL=redis://(localhost|127\.0\.0\.1):6379") {
    Write-LauncherWarn ".env points REDIS_URL at port 6379, but Docker Compose publishes Redis on $redisPort."
  }
}

function Invoke-OptionalDbSetup {
  switch ($DbSetup) {
    "1" {}
    "0" {
      Write-LauncherLog "Skipping database setup because BEACONHS_DB_SETUP=0."
      return
    }
    "auto" {
      if ($script:ResolvedDbMode -eq "local" -and $script:EnvWasCreated) {
        Write-LauncherLog "Fresh local .env detected; database setup will run once for this launch."
      } else {
        Write-LauncherLog "Skipping database setup. Set BEACONHS_DB_SETUP=1 to run migrate and seed before dev."
        return
      }
    }
    default {
      Stop-WithMessage "BEACONHS_DB_SETUP must be auto, 1, or 0."
    }
  }

  switch ($DbGenerate) {
    "1" {
      Write-LauncherLog "Generating database migrations before setup..."
      Invoke-Pnpm db:generate
    }
    "0" {}
    default {
      Stop-WithMessage "BEACONHS_DB_GENERATE must be 1 or 0."
    }
  }

  Write-LauncherLog "Running database migrations and seed..."
  Invoke-Pnpm db:migrate
  Invoke-Pnpm db:seed
}

function Start-BrowserWhenReady {
  if ($OpenBrowser -ne "1") {
    return
  }

  $script:BrowserJob = Start-Job -ScriptBlock {
    param([string] $Url)

    for ($attempt = 1; $attempt -le 90; $attempt++) {
      try {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
        Start-Process $Url
        return
      } catch {
        Start-Sleep -Seconds 2
      }
    }
  } -ArgumentList $AppUrl
}

function Start-DevServer {
  Write-LauncherLog "App: $AppUrl"
  Write-LauncherLog "Mailpit: http://localhost:8025"
  Write-LauncherLog "MinIO console: http://localhost:9001"

  Start-BrowserWhenReady

  $pnpmCommand = if (Test-Command "pnpm") { "pnpm" } else { "corepack pnpm" }
  Write-LauncherLog "Starting pnpm dev. Press Ctrl+C or close this window to stop everything this launcher started."
  $script:DevProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/c", "$pnpmCommand dev" -WorkingDirectory $RepoRoot -NoNewWindow -PassThru
  Wait-Process -Id $script:DevProcess.Id
  return $script:DevProcess.ExitCode
}

try {
  Write-LauncherLog "BeaconHS development launcher"
  Ensure-EnvFile
  Resolve-DatabaseMode
  Ensure-NodeAndPnpm
  Install-DependenciesIfNeeded
  Ensure-Docker
  Start-DockerServices
  Warn-AboutEnvPorts
  Invoke-OptionalDbSetup
  $exitCode = Start-DevServer
} catch {
  Write-Host "[beaconhs] $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
} finally {
  Invoke-Cleanup
}

exit $exitCode
