"""The hub's own page: what it is doing, and the pairing code."""

PAGE = """<!doctype html><html lang=en><meta charset=utf-8>
<meta name=viewport content='width=device-width,initial-scale=1'>
<title>Lookabout hub</title>
<style>
body{margin:0;background:#0b1220;color:#d2d8e0;font:15px/1.5 system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 20px;display:flex;flex-direction:column;gap:16px}
h1{margin:0;color:#f4f1ea;font-size:26px;letter-spacing:-.025em}
h2{margin:0;color:#f4f1ea;font-size:17px}
.m{color:#9aa3b2;font-size:13px}
.card{border:1px solid #243349;border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px;background:#141f33}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 16px}
dt{color:#9aa3b2}dd{margin:0;color:#f4f1ea;text-align:right}
button{font:600 15px system-ui,sans-serif;min-height:48px;border-radius:12px;border:0;background:#f4f1ea;color:#0b1220;cursor:pointer}
.code{font:600 30px ui-monospace,monospace;letter-spacing:.12em;color:#f4f1ea;text-align:center}
.qr{align-self:center;background:#fff;border-radius:12px;padding:10px;line-height:0}
.qr svg{width:180px;height:180px}
[hidden]{display:none}
@media (prefers-color-scheme: light){body{background:#f7f4ee;color:#3a4453}h1,h2,dd,.code{color:#0e1726}
.m,dt{color:#5b6573}.card{background:#fff;border-color:#ddd6c8}button{background:#0e1726;color:#f7f4ee}}
</style>
<main>
<h1>Lookabout hub</h1>
<div class=m id=sub>Loading…</div>
<div class=card><dl>
<dt>Cameras</dt><dd id=cams>–</dd>
<dt>Paired viewers</dt><dd id=viewers>–</dd>
<dt>Video bridge</dt><dd id=bridge>–</dd>
<dt>Free space</dt><dd id=free>–</dd>
</dl></div>
<div class=card>
<h2>Pair a viewer</h2>
<div class=m>In Lookabout, open Cameras → + → Home hub, enter this hub's address and the code shown here.</div>
<div class=m>Address: <b id=addr></b></div>
<button id=show>Show a pairing code</button>
<div id=pair hidden>
<div class=code id=code aria-live=polite></div>
<div class=m id=left style='text-align:center'></div>
</div>
<div class=qr id=qr hidden></div>
</div>
<div class=m>Anyone who can open this page can pair a viewer, so keep the hub on your home network only.</div>
</main>
<script>
const $=id=>document.getElementById(id);
function size(b){return b>=1e12?(b/1e12).toFixed(1)+' TB':b>=1e9?Math.round(b/1e9)+' GB':Math.round(b/1e6)+' MB'}
function load(){fetch('api/hub').then(r=>r.json()).then(j=>{
$('sub').textContent=j.name+' · version '+j.version;
$('cams').textContent=j.cameras;$('viewers').textContent=j.viewers;
$('bridge').textContent=j.bridge?'Running':'Not running';
$('free').textContent=size(j.free_bytes)}).catch(()=>{$('sub').textContent='The hub is not answering.'})}
$('addr').textContent=location.origin;
let timer;
$('show').onclick=()=>fetch('api/pairing/code',{method:'POST'}).then(r=>r.json()).then(j=>{
$('pair').hidden=false;$('code').textContent=j.code;$('qr').innerHTML=j.qr||'';$('qr').hidden=!j.qr;
$('show').textContent='Show a new code';
const end=Date.now()+j.expires_in*1000;clearInterval(timer);
const tick=()=>{const s=Math.max(0,Math.round((end-Date.now())/1000));
$('left').textContent=s?'Works once, for '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0'):'This code has run out.';
if(!s){clearInterval(timer);$('code').textContent='';$('qr').hidden=true;load()}};
tick();timer=setInterval(tick,1000)});
load();setInterval(load,10000);
</script>"""
