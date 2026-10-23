/** Small real PDF with xref, two text pages (including ToUnicode Chinese), and an empty page. */
export function pdfFixture({ encrypted = false } = {}) {
  const stream = body => `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <4E2D> <0002> <6587> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F2 8 0 R >> >> /Contents 11 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 12 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('BT /F1 12 Tf 20 200 Td (First PDF page) Tj ET'),
    '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H /DescendantFonts [9 0 R] /ToUnicode 10 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>',
    stream(cmap), stream('BT /F2 12 Tf 20 200 Td <00010002> Tj ET'), stream('')
  ]
  if (encrypted) objects.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> /P -4 >>')
  let body = '%PDF-1.4\n', offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R ${encrypted ? '/Encrypt 13 0 R /ID [<0123456789ABCDEF> <0123456789ABCDEF>]' : ''} >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}
