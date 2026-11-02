# Servidor local mínimo para probar la página (solo desarrollo): powershell -File serve.ps1 [puerto]
param([int]$Port = 8080)
if ($env:PORT) { $Port = [int]$env:PORT }  # la vista previa del editor asigna el puerto por variable de entorno
$root = $PSScriptRoot
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json; charset=utf-8' }
$l = [Net.HttpListener]::new()
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Sirviendo $root en http://localhost:$Port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  $rel = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if (-not $rel) { $rel = 'index.html' }
  $p = [IO.Path]::GetFullPath((Join-Path $root $rel))
  if ($p.StartsWith($root) -and (Test-Path $p -PathType Leaf)) {
    $b = [IO.File]::ReadAllBytes($p)
    $ct = $types[[IO.Path]::GetExtension($p)]
    if (-not $ct) { $ct = 'text/plain; charset=utf-8' }
    $c.Response.ContentType = $ct
    $c.Response.AddHeader('Access-Control-Allow-Origin', '*')  # solo desarrollo local
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
