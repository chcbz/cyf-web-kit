#!/usr/bin/env node
/** Deterministically decode WebP sprite frames through the installed Chromium headless shell. */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CHROMIUM = process.env.CHROMIUM_HEADLESS || '/usr/local/bin/chromium-headless-smoke'

export function scanWebpFrames(requests) {
  if (!Array.isArray(requests) || requests.length === 0) throw new Error('scanWebpFrames requires requests')
  const inputs = requests.map((r, index) => {
    const bytes = readFileSync(r.path)
    return {
      key: String(r.key ?? index),
      dataUri: `data:image/webp;base64,${bytes.toString('base64')}`,
      assetSha256: createHash('sha256').update(bytes).digest('hex'),
      frame: {
        x: number(r.frame?.x, 'frame.x'), y: number(r.frame?.y, 'frame.y'),
        width: positive(r.frame?.width, 'frame.width'), height: positive(r.frame?.height, 'frame.height')
      }
    }
  })
  const nonce = createHash('sha256').update(JSON.stringify(inputs.map(({ key, assetSha256, frame }) => ({ key, assetSha256, frame })))).digest('hex').slice(0, 16)
  const htmlPath = join(tmpdir(), `e8a-webp-frame-${nonce}.html`)
  const html = `<!doctype html><meta charset="utf-8"><body id="out">waiting<script>
const inputs=${JSON.stringify(inputs)};
function scan(input) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const f = input.frame;
        const c = document.createElement('canvas');
        c.width = f.width; c.height = f.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.clearRect(0, 0, c.width, c.height);
        x.drawImage(img, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
        const d = x.getImageData(0, 0, f.width, f.height).data;
        let minX=f.width,minY=f.height,maxX=-1,maxY=-1,count=0;
        for (let y=0;y<f.height;y++) for (let q=0;q<f.width;q++) {
          if (d[(y*f.width+q)*4+3] > 0) {
            count++; if(q<minX)minX=q; if(q>maxX)maxX=q; if(y<minY)minY=y; if(y>maxY)maxY=y;
          }
        }
        if (count===0) throw new Error('empty alpha frame '+input.key);
        resolve({key:input.key,assetSha256:input.assetSha256,frame:f,alphaAabb:{minX,minY,maxX:maxX+1,maxY:maxY+1,width:maxX-minX+1,height:maxY-minY+1,opaquePixels:count},pngDataUri:c.toDataURL('image/png')});
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('image load '+input.key));
    img.src = input.dataUri;
  });
}
Promise.all(inputs.map(scan)).then(v => document.body.textContent=JSON.stringify(v)).catch(e => document.body.textContent='ERROR:'+e.message);
</script>`
  writeFileSync(htmlPath, html)
  try {
    const dom = execFileSync(CHROMIUM, ['--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=3000', '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 50 * 1024 * 1024 })
    const match = dom.match(/<body id="out">([\s\S]*?)<\/body>/)
    if (!match) throw new Error('Chromium output missing result body')
    const text = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    if (text.startsWith('ERROR:')) throw new Error(text)
    const parsed = JSON.parse(text)
    if (parsed.length !== requests.length) throw new Error(`frame result count ${parsed.length} != ${requests.length}`)
    return parsed
  } finally {
    if (process.env.KEEP_WEBP_SCAN_HTML) console.error('KEEP '+htmlPath); else try { unlinkSync(htmlPath) } catch { /* best-effort temp cleanup */ }
  }
}
function number(v, label) { const n=Number(v); if(!Number.isFinite(n)||n<0) throw new Error(`${label} invalid`); return n }
function positive(v, label) { const n=number(v,label); if(n<=0||!Number.isSafeInteger(n)) throw new Error(`${label} invalid`); return n }
