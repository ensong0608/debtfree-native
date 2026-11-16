$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$gradleFiles = @(rg --files --hidden --no-ignore -g '**/android/build.gradle' -g '!**/android/build/**' (Join-Path $projectPath 'node_modules'))
$buildRoots = @(@(Join-Path $projectPath 'android\build'; Join-Path $projectPath 'android\app\build') + @(
  foreach ($gradleFile in $gradleFiles) { Join-Path ([IO.Path]::GetDirectoryName($gradleFile)) 'build' }
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Sort-Object -Unique)
foreach ($buildRoot in $buildRoots) {
  if (-not $buildRoot.StartsWith($projectPath + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $buildRoot.EndsWith('\build')) {
    throw 'Refusing a target outside this project generated build tree.'
  }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
@(foreach ($buildRoot in $buildRoots) {
  [pscustomobject]@{ Path = $buildRoot; Sddl = (Get-Acl -LiteralPath $buildRoot).Sddl; Attributes = (Get-Item -LiteralPath $buildRoot -Force).Attributes.ToString() }
}) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot "all-native-before-$stamp.json") -Encoding UTF8
$results = foreach ($buildRoot in $buildRoots) {
  $existing = Get-Acl -LiteralPath $buildRoot
  # Write only the DACL. Do not change ownership or request audit/SACL privileges.
  $access = New-Object System.Security.AccessControl.DirectorySecurity
  $access.SetSecurityDescriptorSddlForm($existing.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access), [System.Security.AccessControl.AccessControlSections]::Access)
  $access.SetAccessRuleProtection($true, $true)
  foreach ($rule in @($access.Access | Where-Object {
    $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq 'S-1-1-0' -and
    $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny -and
    $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
  })) { $access.RemoveAccessRuleSpecific($rule) }
  [IO.Directory]::SetAccessControl($buildRoot, $access)
  $stack = New-Object 'System.Collections.Generic.Stack[string]'
  $stack.Push('\\?\' + $buildRoot)
  $cleared = 0
  while ($stack.Count -gt 0) {
    $directory = $stack.Pop()
    foreach ($entry in (@($directory) + [IO.Directory]::GetFileSystemEntries($directory))) {
      $attrs = [IO.File]::GetAttributes($entry)
      if (($attrs -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      if (($attrs -band [IO.FileAttributes]::ReadOnly) -ne 0) {
        [IO.File]::SetAttributes($entry, $attrs -band (-bnot [IO.FileAttributes]::ReadOnly))
        $cleared++
      }
      if ($entry -ne $directory -and ($attrs -band [IO.FileAttributes]::Directory) -ne 0) { $stack.Push($entry) }
    }
  }
  $probe = Join-Path $buildRoot ('.dfn-access-probe-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $probe | Out-Null
  [IO.File]::WriteAllText((Join-Path $probe 'write.txt'), 'Temporary generated-build access check')
  Rename-Item -LiteralPath (Join-Path $probe 'write.txt') -NewName 'renamed.txt'
  Remove-Item -LiteralPath (Join-Path $probe 'renamed.txt')
  Remove-Item -LiteralPath $probe
  [pscustomobject]@{ Path = $buildRoot; AttributesCleared = $cleared; CreateRenameDelete = 'PASS' }
}
$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot "all-native-results-$stamp.json") -Encoding UTF8
[pscustomobject]@{ GeneratedBuildRoots = $buildRoots.Count; AttributesCleared = ($results | Measure-Object AttributesCleared -Sum).Sum; AllProbesPassed = $true } | ConvertTo-Json
