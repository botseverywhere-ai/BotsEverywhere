/** PowerShell 5 `Set-Content -Encoding utf8` writes a BOM. Add-Content uses CRLF. */
export function normalizeText(source: string): string {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}
