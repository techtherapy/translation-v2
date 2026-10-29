// Local interaction preview: the actual sidebar, with an in-memory document adapter.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../backend/app/services/docs_review/fixtures/book-300-chapter-009.json",
    ),
    "utf8",
  ),
);
const associations = {
  R1: ["target-0005"],
  R2: ["target-0019"],
  R3: ["target-0045"],
  R4: ["target-0060", "target-0062"],
  F1: ["target-0032"],
  F2: ["target-0021", "target-0022"],
};
const data = {
  blocks: fixture.target_blocks,
  items: fixture.analyst_cards
    .map((c) => ({
      id: c.id,
      kind: c.kind === "false_alarm_check" ? "audit" : "finding",
      title: c.title,
      source: c.source,
      sourceContext: fixture.raw_chinese_section,
      summary: c.concern,
      suggestion: c.proposed_correction || null,
      blockIds: associations[c.id],
      order: fixture.target_blocks.findIndex(
        (b) => b.block_id === associations[c.id][0],
      ),
      target: associations[c.id]
        .map((id) => fixture.target_blocks.find((b) => b.block_id === id).text)
        .join("\n\n"),
      state: "pending",
    }))
    .sort((a, b) => a.order - b.order),
};
const bridge = `<script>
let sequence=0;const pending=new Map();
window.addEventListener('message',e=>{if(e.source!==parent || !pending.has(e.data.id))return;const h=pending.get(e.data.id);pending.delete(e.data.id);e.data.error?h.fail({message:e.data.error}):h.ok(e.data.result);});
function runner(handlers={}){return new Proxy({}, {get(_,name){if(name==='withSuccessHandler')return fn=>runner({...handlers,ok:fn});if(name==='withFailureHandler')return fn=>runner({...handlers,fail:fn});return (...args)=>{const id=++sequence;pending.set(id,handlers);parent.postMessage({id,name,args},location.origin);};}});}window.google={script:{run:runner()}};
</script>`;
const sidebar = fs
  .readFileSync(path.join(__dirname, "Sidebar.html"), "utf8")
  .replace("<script>", bridge + "<script>");
const page = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>BITS review · interaction preview</title><style>
*{box-sizing:border-box}body{margin:0;color:#243b32;background:#eef0e9;font:14px 'Trebuchet MS',sans-serif}header{height:78px;padding:18px 26px;background:#fff;border-bottom:1px solid #dce3d7}header strong{font:23px Georgia,serif}header small{display:block;color:#68776d;margin-top:5px}main{display:grid;grid-template-columns:minmax(400px,1fr) 300px;max-width:1200px;margin:auto;height:calc(100vh - 78px)}#document{overflow:auto;padding:28px 40px}.paper{background:#fff;max-width:720px;margin:0 auto;padding:45px 50px;box-shadow:0 3px 18px #243b3212}h1{font:26px/1.4 Georgia,serif;margin:0 0 30px}textarea{display:block;width:100%;border:1px solid transparent;resize:vertical;min-height:30px;background:transparent;font:17px/1.65 Georgia,serif;color:#28372c;margin:0 0 9px;padding:3px}textarea:focus{outline:2px solid #b3c7ac;background:#f8faf3}.selected{background:#fff4c8;border-color:#d8c57a}iframe{width:300px;height:100%;border:0;border-left:1px solid #dce3d7;background:white}@media(max-width:760px){#document{padding:14px}.paper{padding:22px}main{grid-template-columns:minmax(300px,1fr) 300px}}
</style></head><body><header><strong>The chapter stays at the centre.</strong><small>Interaction preview · edit the text and try the sidebar. Nothing is saved to Google Docs.</small></header><main><div id="document"><div class="paper"><h1>The Benefits of Yidam Samadhi</h1><div id="passages"></div></div></div><iframe title="BITS review sidebar" src="/sidebar"></iframe></main><script>
const data=${JSON.stringify(data).replace(/</g, "\\u003c")};let opened=null,pendingAction=null;const undo={};
const fields=new Map();for(const block of data.blocks){const input=document.createElement('textarea');input.value=block.text;input.setAttribute('aria-label','Chapter paragraph '+block.block_id);input.rows=Math.max(1,Math.ceil(block.text.length/65));input.addEventListener('input',()=>{block.text=input.value;for(const item of data.items)if(item.blockIds.includes(block.block_id)&&item.state==='reviewed'){item.state='pending';item.reviewedChanged=true;item.canUndo=false;}});fields.set(block.block_id,input);document.getElementById('passages').append(input);}
const review=()=>({status:'completed',example:true,message:'Practice review · Book 300, Chapter 9',items:data.items,pendingAction});
function item(id){return data.items.find(i=>i.id===id)}function text(i){return i.blockIds.map(id=>fields.get(id).value).join('\n\n')}function setText(i,value){fields.get(i.blockIds[0]).value=value;data.blocks.find(b=>b.block_id===i.blockIds[0]).text=value;}
function rpc(name,args){let i=item(args[0]);
 if(name==='resumeReview')return {signedIn:true,review:review()};
 if(name==='refreshReview')return review();
 if(name==='openReviewItem'){for(const f of fields.values())f.classList.remove('selected');for(const id of i.blockIds)fields.get(id).classList.add('selected');fields.get(i.blockIds[0]).scrollIntoView({block:'center',behavior:'smooth'});opened={id:i.id,before:text(i)};return {id:i.id,contextId:'demo',currentTarget:text(i),suggestion:text(i)===i.target?i.suggestion:null,changed:text(i)!==i.target};}
 if(name==='applyReviewSuggestion'){if(text(i)!==opened.before)throw Error('The text changed. Open the point again.');undo[i.id]=text(i);setText(i,i.suggestion);pendingAction={itemId:i.id};return {pending:true,itemId:i.id};}
 if(name==='finishReviewSuggestion'){i=item(pendingAction.itemId);i.state='reviewed';i.canUndo=true;pendingAction=null;return {itemId:i.id,decision:{disposition:'corrected'},review:review()};}
 if(name==='completeReviewItem'){if(args[2]==='done'&&text(i)===opened.before)throw Error('Edit this passage in the document first, or choose Keep wording.');i.state=args[2]==='later'?'later':'reviewed';return {itemId:i.id,decision:{disposition:args[2]},review:review()};}
 if(name==='undoReviewAction'){if(text(i)!==i.suggestion)throw Error('This passage has changed. Reopen it to keep your edits.');setText(i,undo[i.id]);}
 if(name==='undoReviewAction'||name==='reopenReviewItem'){i.state='pending';i.canUndo=false;return {itemId:i.id,decision:{disposition:'reopened'},review:review()};}
 if(name==='dismissPendingReviewAction'){pendingAction=null;return review();}
 throw Error('This control is not connected in the local preview.');
}
window.addEventListener('message',e=>{if(e.source!==document.querySelector('iframe').contentWindow||e.origin!==location.origin)return;let reply={id:e.data.id};try{reply.result=rpc(e.data.name,e.data.args)}catch(error){reply.error=error.message}e.source.postMessage(reply,location.origin)});
</script></body></html>`;
http
  .createServer((req, res) => {
    if (!["/", "/sidebar"].includes(req.url)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(req.url === "/sidebar" ? sidebar : page);
  })
  .listen(8776, "127.0.0.1", () =>
    console.log("BITS interaction preview: http://127.0.0.1:8776"),
  );
