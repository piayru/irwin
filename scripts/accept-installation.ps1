param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Workspace,[Parameter(Mandatory=$true)][string]$NodeExecutable,[string]$PreviousInstaller,[string]$PreviousVersion,[string]$ExpectedVersion)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($Workspace)
$taskInstaller=[IO.Path]::GetFullPath($Installer)
if(-not(Test-Path -LiteralPath $taskInstaller -PathType Leaf)){throw 'Installer artifact is missing'}
$taskPrevious=$null
if($PreviousInstaller){$taskPrevious=[IO.Path]::GetFullPath($PreviousInstaller);if(-not(Test-Path -LiteralPath $taskPrevious -PathType Leaf)){throw 'Previous installer artifact is missing'}}
$taskDirectory=Join-Path $taskRoot ('.runtime\installation-'+[Guid]::NewGuid().ToString())
$taskInstall=Join-Path $taskDirectory 'app'
$taskData=Join-Path $taskDirectory 'user-data'
if(-not([IO.Path]::GetFullPath($taskInstall).StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))){throw 'Installation must remain inside the workspace'}
$taskRegistry=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
# NSIS records "Irwin <version>" and stores InstallLocation in a separate key.
$taskAppGuid='0dc08cb8-7017-57bd-a783-7d8bc68d83b1'
$taskExisting=@(Get-ItemProperty $taskRegistry -ErrorAction SilentlyContinue | Where-Object {$_.PSChildName -eq $taskAppGuid -or $_.DisplayName -match '^Irwin(?:\s|$)'})
$taskLocations=@(Get-ItemProperty ('HKCU:\Software\'+$taskAppGuid),('HKLM:\Software\'+$taskAppGuid) -ErrorAction SilentlyContinue | Where-Object {$_.InstallLocation})
if($taskExisting.Count -gt 0 -or $taskLocations.Count -gt 0){throw 'An existing Irwin installation was found. Run acceptance on a clean Windows profile; no installed application has been changed.'}
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskChecks=New-Object System.Collections.Generic.List[object]
$taskFailure=$null
$taskInstalled=$false
$taskExecutable=Join-Path $taskInstall 'Irwin.exe'
function Invoke-TaskInstaller([string]$Artifact) {
  if(@(Get-Process -Name Irwin -ErrorAction SilentlyContinue).Count -gt 0){throw 'Close running Irwin processes before isolated installation acceptance'}
  $taskProcess=Start-Process -FilePath $Artifact -ArgumentList ('/S /currentuser /D='+$taskInstall) -WindowStyle Hidden -Wait -PassThru
  if($taskProcess.ExitCode -ne 0){throw 'Installer returned a failure code'}
  if(-not(Test-Path -LiteralPath $taskExecutable -PathType Leaf)){throw 'Installed executable missing at the task-owned target'}
}
function Invoke-TaskSmoke([string]$Phase) {
  $env:WORKBENCH_EXECUTABLE=$taskExecutable
  $env:WORKBENCH_USER_DATA=$taskData
  $env:IRWIN_INSTALLATION_PHASE=$Phase
  $taskSmoke=Join-Path $taskRoot 'tests\e2e\installation-smoke.mjs'
  $taskProcess=Start-Process -FilePath $NodeExecutable -ArgumentList ('"'+$taskSmoke+'"') -WorkingDirectory $taskRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $taskDirectory ($Phase+'.log')) -RedirectStandardError (Join-Path $taskDirectory ($Phase+'.error.log'))
  if($taskProcess.ExitCode -ne 0){throw ('Installed application smoke check failed: '+$Phase)}
}
try {
  $taskFirst=if($taskPrevious){$taskPrevious}else{$taskInstaller}
  $env:IRWIN_EXPECTED_VERSION=if($taskPrevious){$PreviousVersion}else{$ExpectedVersion}
  Invoke-TaskInstaller $taskFirst
  $taskInstalled=$true
  $taskChecks.Add(@{name='silent install into isolated workspace target';status='passed'})
  Invoke-TaskSmoke 'install'
  $taskChecks.Add(@{name='installed launch and bundled Database Tools';status='passed'})
  $env:IRWIN_EXPECTED_VERSION=$ExpectedVersion
  Invoke-TaskInstaller $taskInstaller
  Invoke-TaskSmoke 'upgrade'
  $taskChecks.Add(@{name=$(if($taskPrevious){'older-release upgrade preserves local settings and saved queries'}else{'same-version reinstall preserves local settings and saved queries'});status='passed'})
} catch {
  $taskFailure=$_.Exception.Message
  $taskChecks.Add(@{name='installation acceptance';status='failed';reason=$taskFailure})
} finally {
  # Verify the exact registered target before invoking its uninstaller.
  if($taskInstalled){
    try {
      $taskRegistered=Get-ItemProperty ('HKCU:\Software\'+$taskAppGuid) -ErrorAction Stop
      if([IO.Path]::GetFullPath($taskRegistered.InstallLocation).TrimEnd('\') -ne $taskInstall.TrimEnd('\')){throw 'Registered installer target differs from the task-owned target'}
      $taskUninstaller=Join-Path $taskInstall 'Uninstall Irwin.exe'
      if(-not(Test-Path -LiteralPath $taskUninstaller -PathType Leaf)){throw 'Task-owned uninstaller missing'}
      if(@(Get-Process -Name Irwin -ErrorAction SilentlyContinue).Count -gt 0){throw 'Close running Irwin processes before uninstalling the task-owned installation'}
      $taskProcess=Start-Process -FilePath $taskUninstaller -ArgumentList '/S /currentuser' -WindowStyle Hidden -Wait -PassThru
      if($taskProcess.ExitCode -ne 0){throw 'Uninstaller returned a failure code'}
      $taskDeadline=[DateTime]::UtcNow.AddSeconds(45)
      while((Test-Path -LiteralPath $taskExecutable) -and [DateTime]::UtcNow -lt $taskDeadline){Start-Sleep -Milliseconds 500}
      if(Test-Path -LiteralPath $taskExecutable){throw 'Installed executable remains after uninstall'}
      $taskChecks.Add(@{name='uninstall removes task-owned executable';status='passed'})
    } catch {$taskChecks.Add(@{name='uninstall isolated installation';status='failed';reason=$_.Exception.Message});$taskFailure=$_.Exception.Message}
  }
  $taskSignatureStatus='unavailable'
  try {$taskSignatureStatus=[string](Get-AuthenticodeSignature -FilePath $taskInstaller).Status} catch {$taskChecks.Add(@{name='artifact signing status';status='failed';reason='Signature verification unavailable'});$taskFailure='Signature verification unavailable'}
  $taskPending=@('clean downloaded artifact / SmartScreen policy','native macOS installation','native Ubuntu installation')
  if(-not $taskPrevious){$taskPending+=@('upgrade from an older release')}
  $taskPreviousHash=if($taskPrevious){(Get-FileHash -LiteralPath $taskPrevious -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}
  $taskReport=@{format='irwin-installation-acceptance';version=1;capturedAt=[DateTime]::UtcNow.ToString('o');platform='Windows';osVersion=[Environment]::OSVersion.VersionString;artifactName=[IO.Path]::GetFileName($taskInstaller);sha256=(Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant();signature=$taskSignatureStatus;checks=$taskChecks.ToArray();previousVersion=$PreviousVersion;previousSha256=$taskPreviousHash;pending=$taskPending}
  $taskReportPath=Join-Path $taskDirectory 'acceptance.json'
  [IO.File]::WriteAllText($taskReportPath,($taskReport | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  Write-Output ('Evidence: '+$taskReportPath)
  $taskChecks | ForEach-Object {Write-Output ($_.status+' '+$_.name)}
}
if($taskFailure){Write-Error $taskFailure;exit 1}
