// Offline presentation prototype, not a production Markdown parser.
function prototypeDocumentPreview(a){
 const markdown=/\.(md|markdown)$/i.test(a.name||'');
 const text=String(a.text||'');
 let html=markdown?esc(text).replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>'):text;
 const doc=new DOMParser().parseFromString(html,'text/html');
 for(const node of doc.querySelectorAll('script,iframe,object,embed,link,base,meta,form,input,button,svg,math'))node.remove();
 for(const node of doc.querySelectorAll('*'))for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['href','src','srcset','action','formaction','target'].includes(attr.name))node.removeAttribute(attr.name);
 const csp="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'";
 const source=`<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8"><style>body{margin:16px;font:15px/1.65 system-ui;overflow-wrap:anywhere}pre{white-space:pre-wrap}table{max-width:100%}</style>${doc.head.innerHTML}${doc.body.innerHTML}`;
 return `<section class="document-preview"><p>静态文档预览 · 脚本和外部资源不运行，下载可查看原文件。</p><iframe title="${esc(a.name)}预览" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(source)}" style="display:block;width:100%;height:360px;border:1px solid #deddd6;background:white"></iframe>${!text?'<p role="status">文件内容为空。</p>':''}</section>`;
}
