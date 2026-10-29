# 临时脚本：以管理员身份安装 WSL2，并记录结果
$log = "$env:TEMP\wsl_install_result.txt"
try {
  $out = & wsl.exe --install 2>&1
  $out | Out-File -FilePath $log -Encoding utf8
  "EXIT=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
} catch {
  "ERROR: $($_.Exception.Message)" | Out-File -FilePath $log -Append -Encoding utf8
}