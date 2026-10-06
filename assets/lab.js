"use strict";
(async function(){
const $=id=>document.getElementById(id);
const state={catalog:null,grid:null,values:null,rgb:null,map:null,a:[.25,.5],b:[.75,.5],active:"a",manual:false,revealed:false,token:0};
const cache=new Map();
async function getJSON(url){if(!cache.has(url))cache.set(url,fetch(url).then(r=>{if(!r.ok)throw new Error("Could not load "+url);return r.json();}).catch(e=>{cache.delete(url);throw e;}));return cache.get(url);}
function fill(id,items){const s=$(id);s.replaceChildren();for(const [value,label] of items){const o=document.createElement("option");o.value=value;o.textContent=label;s.append(o);}}
function loadImage(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error("Could not load image "+src));im.src=src;});}
function scene(){return state.catalog.scenes.find(s=>s.id===$("scene").value);}
function pair(){return state.grid.record.pairs[Number($("pair").value)];}
function message(text){$("load-status").textContent=text;}
function fail(e){message(e.message+" Reload the page or check that it is served over HTTP.");console.error(e);}
function decode(g){const bytes=Uint8Array.from(atob(g.values),c=>c.charCodeAt(0));const view=new DataView(bytes.buffer);const q=new Float32Array(g.width*g.height);for(let i=0;i<q.length;i++)q[i]=g.low+(g.high-g.low)*view.getUint16(i*2,true)/65535;return q;}
function sample(p){const g=state.grid;const x=Math.min(g.width-1,Math.max(0,Math.floor(p[0]*g.width)));const y=Math.min(g.height-1,Math.max(0,Math.floor(p[1]*g.height)));return state.values[y*g.width+x];}
function viewport(){const z=Number($("zoom").value);const width=1/z,height=1/z;return{x:Math.min(1-width,Math.max(0,state.a[0]-width/2)),y:Math.min(1-height,Math.max(0,state.a[1]-height/2)),width,height};}
function draw(){
if(!state.grid||!state.rgb||!state.map)return;
const c=$("depth-canvas"),ctx=c.getContext("2d");const g=state.grid;
c.width=768;c.height=Math.round(768*g.nativeHeight/g.nativeWidth);
const v=viewport();ctx.clearRect(0,0,c.width,c.height);
ctx.drawImage(state.rgb,v.x*state.rgb.width,v.y*state.rgb.height,v.width*state.rgb.width,v.height*state.rgb.height,0,0,c.width,c.height);
if(state.revealed){ctx.globalAlpha=Number($("opacity").value)/100;ctx.drawImage(state.map,v.x*state.map.width,v.y*state.map.height,v.width*state.map.width,v.height*state.map.height,0,0,c.width,c.height);ctx.globalAlpha=1;}
const position=p=>[(p[0]-v.x)/v.width*c.width,(p[1]-v.y)/v.height*c.height];
const a=position(state.a),b=position(state.b);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle="white";ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.stroke();ctx.setLineDash([]);
for(const [name,p,color] of [["A",a,"#146fdb"],["B",b,"#d14443"]]){
ctx.beginPath();ctx.arc(p[0],p[1],12,0,2*Math.PI);ctx.fillStyle=color;ctx.fill();ctx.lineWidth=3;ctx.strokeStyle="white";ctx.stroke();ctx.font="bold 15px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="white";ctx.fillText(name,p[0],p[1]);}
drawProfile();updateProbes();
}
function drawProfile(){const c=$("profile"),x=c.getContext("2d"),w=c.width,h=c.height;const vals=[];for(let i=0;i<128;i++){const t=i/127;vals.push(sample([state.a[0]*(1-t)+state.b[0]*t,state.a[1]*(1-t)+state.b[1]*t]));}
const min=Math.min(...vals),max=Math.max(...vals),range=Math.max(1e-9,max-min);
x.clearRect(0,0,w,h);x.fillStyle="#fff";x.fillRect(0,0,w,h);x.strokeStyle="#dce6e0";x.beginPath();x.moveTo(50,15);x.lineTo(50,h-30);x.lineTo(w-10,h-30);x.stroke();x.strokeStyle="#0a7469";x.lineWidth=2;x.beginPath();vals.forEach((v,i)=>{const px=50+i/127*(w-65),py=h-30-(v-min)/range*(h-50);if(i===0)x.moveTo(px,py);else x.lineTo(px,py);});x.stroke();x.fillStyle="#62776f";x.font="11px system-ui";x.textAlign="right";x.fillText(max.toFixed(3),44,21);x.fillText(min.toFixed(3),44,h-29);x.textAlign="left";x.fillText("A",50,h-10);x.textAlign="right";x.fillText("B",w-10,h-10);}
function updateProbes(){const g=state.grid,p=pair();const va=state.manual?sample(state.a):p.values.point1;const vb=state.manual?sample(state.b):p.values.point2;const winner=va>vb?"A":vb>va?"B":"Tie";
const coord=p=>[Math.min(g.nativeWidth-1,Math.floor(p[0]*g.nativeWidth)),Math.min(g.nativeHeight-1,Math.floor(p[1]*g.nativeHeight))];
$("probe-values").innerHTML='<div class="evidence"><strong>'+(state.manual?'Free probes (approximate)':'Annotated-point values (exact)')+'</strong><br>A (x,y): '+coord(state.a).join(", ")+' · q = '+va.toFixed(5)+'<br>B (x,y): '+coord(state.b).join(", ")+' · q = '+vb.toFixed(5)+'<br>Model answer: '+winner+(winner==="Tie"?'':' closer')+'<br><small>'+(state.manual?'These positions have no reference annotation.':'A = source point1; B = source point2.')+'</small></div>';
}
function resetPair(){if(!state.grid)return;const p=pair(),g=state.grid;state.a=[(p.point1[1]+.5)/g.nativeWidth,(p.point1[0]+.5)/g.nativeHeight];state.b=[(p.point2[1]+.5)/g.nativeWidth,(p.point2[0]+.5)/g.nativeHeight];state.manual=false;updatePair();draw();}
function updatePair(){const p=pair();const expected=p.closer_point==="point1"?"A":"B";const winner=p.predicted_closer==="point1"?"A":p.predicted_closer==="point2"?"B":"Tie";
$("pair-result").innerHTML='<div class="evidence"><strong>Source annotation: '+expected+' closer</strong><br>Model answer: '+winner+(winner==="Tie"?'':' closer')+'<br><strong class="'+(p.correct?'correct':'incorrect')+'">'+(p.correct?'Correct on this pair':'Incorrect on this pair')+'</strong><br>This input: '+state.grid.record.correct+' / '+state.grid.record.total+' pairs correct.</div>';
}
async function updateComparison(token){const s=scene(),condition=$("condition").value,index=Number($("pair").value);const rows=await Promise.all(Object.entries(state.catalog.models).map(async([key,label])=>{const g=await getJSON(s.conditions[condition].models[key]);const p=g.record.pairs[index];return [label,g.record.correct+" / "+g.record.total,p.correct?"Correct":"Incorrect",g.record.tensor_shape.join(" × ")];}));
if(token!==state.token)return;
$("scene-comparison").replaceChildren();for(const row of rows){const tr=document.createElement("tr");row.forEach((text,i)=>{const cell=document.createElement(i===0?"th":"td");cell.textContent=text;if(i===0)cell.scope="row";if(i===2)cell.className=text==="Correct"?"correct":"incorrect";tr.append(cell);});$("scene-comparison").append(tr);}}
async function selectCase(reset=false){
const token=++state.token;state.grid=null;state.values=null;state.rgb=null;state.map=null;
$("pair-result").replaceChildren();$("probe-values").replaceChildren();$("scene-comparison").replaceChildren();const c=$("depth-canvas");c.getContext("2d").clearRect(0,0,c.width,c.height);
message("Loading saved prediction…");
const s=scene(),condition=$("condition").value,key=$("model").value;
$("scene-prompt").textContent=s.prompt;$("case-title").textContent=state.catalog.models[key];
if(reset){fill("pair",s.pairs.map((p,i)=>[String(i),"Pair "+(i+1)]));if(s.id==="da2k_transparent_reflective_03")$("pair").value="1";$("zoom").value="1";}
const path=s.conditions[condition].models[key];
try{
const [g,rgb,map]=await Promise.all([getJSON(path),loadImage(s.conditions[condition].rgb),loadImage(path.replace("data/","media/").replace(".json",".png"))]);
if(token!==state.token)return;
state.grid=g;state.values=decode(g);state.rgb=rgb;state.map=map;
$("case-meta").innerHTML='<p>Input tensor: '+g.record.tensor_shape.join(" × ")+'<br>Native grid: '+g.nativeWidth+' × '+g.nativeHeight+'<br>Display grid: '+g.width+' × '+g.height+'</p><p>'+(g.record.consistency?'Rank stability: '+g.record.consistency.spearman_rank_correlation.toFixed(4)+' (not accuracy)':'Original input.')+'</p>';
$("case-download").href=path;
const cap=$("source-caption");cap.replaceChildren();cap.append("Source: DA-2K ");const citation=document.createElement("a");citation.href="bibliography.html#ref1";citation.textContent="[1]";cap.append(citation," · "+s.archive_member+". ");
const link=document.createElement("a");link.href=s.source_url;link.textContent="Dataset and annotation source";cap.append(link);
if(s.id==="da2k_transparent_reflective_03")cap.append(" Visible watermark: Marnee Pearce; retained.");
message("Prediction loaded · larger values mean closer.");
resetPair();await updateComparison(token);
}catch(e){if(token===state.token)fail(e);}}
function setActive(which){state.active=which;for(const n of ["a","b"])$("probe-"+n).setAttribute("aria-pressed",String(n===which));}
function moveProbe(p,which){state[which]=p.map(v=>Math.min(1-1e-8,Math.max(0,v)));state.manual=true;draw();}
$("depth-canvas").addEventListener("click",e=>{if(!state.grid)return;const r=e.currentTarget.getBoundingClientRect(),v=viewport();moveProbe([v.x+(e.clientX-r.left)/r.width*v.width,v.y+(e.clientY-r.top)/r.height*v.height],e.shiftKey?"b":state.active);});
$("depth-canvas").addEventListener("keydown",e=>{if(!state.grid||!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key))return;e.preventDefault();const p=state[state.active].slice();const stride=e.shiftKey?10:1;p[0]+=(e.key==="ArrowRight"?stride:e.key==="ArrowLeft"?-stride:0)/state.grid.nativeWidth;p[1]+=(e.key==="ArrowDown"?stride:e.key==="ArrowUp"?-stride:0)/state.grid.nativeHeight;moveProbe(p,state.active);});
$("probe-a").addEventListener("click",()=>setActive("a"));$("probe-b").addEventListener("click",()=>setActive("b"));
$("reveal").addEventListener("click",()=>{state.revealed=!state.revealed;$("reveal").setAttribute("aria-pressed",String(state.revealed));$("reveal").textContent=state.revealed?"Hide depth map":"Reveal depth map";draw();});
$("opacity").addEventListener("input",()=>{$("opacity-value").textContent=$("opacity").value+"%";draw();});
$("zoom").addEventListener("change",draw);$("reset-pair").addEventListener("click",resetPair);
$("pair").addEventListener("change",()=>{resetPair();updateComparison(state.token).catch(fail);});
$("scene").addEventListener("change",()=>selectCase(true));$("condition").addEventListener("change",()=>selectCase());$("model").addEventListener("change",()=>selectCase());

function nyuUpdate(){
const s=state.catalog.nyu.find(s=>s.id===$("nyu-scene").value),key=$("nyu-model").value,layer=$("nyu-layer").value,m=s.models[key];
const path=layer==="gt"||layer==="mask"?s[layer]:m[layer];$("nyu-rgb").src=s.rgb;$("nyu-rgb").alt="NYU RGB: "+s.title;$("nyu-map").src=path;
const label=$("nyu-layer").selectedOptions[0].textContent;$("nyu-map").alt=s.title+": "+label;$("nyu-map-caption").textContent=label;
$("nyu-legend").textContent=layer==="relative"?"Relative inverse depth: dark = farther, bright = closer; each map uses its own range.":layer==="gt"||layer==="aligned"?"Viridis meter scale: dark purple = 0.1 m, yellow = 10 m. Common range for reference and aligned prediction.":layer==="error"?"Absolute relative error: dark = 0, yellow = 0.5 or higher. Excluded pixels are dark blue-gray.":"White pixels are scored; black pixels are excluded.";
const metrics=[["Aligned AbsRel ↓",m.metrics.abs_rel.toFixed(5)],["Aligned RMSE (m) ↓",m.metrics.rmse_m.toFixed(4)],["δ₁ ↑",(m.metrics.delta1*100).toFixed(2)+"%"],["Valid pixels",m.metrics.valid_pixels.toLocaleString()]];
$("nyu-metrics").replaceChildren();for(const [label,value] of metrics){const div=document.createElement("div"),strong=document.createElement("strong");strong.textContent=value;div.append(strong,label);$("nyu-metrics").append(div);}
$("nyu-fit").textContent="Reference-based fit: a = "+m.fit.scale.toFixed(6)+", shift b = "+m.fit.shift.toFixed(6)+". Clipped fraction: "+(100*m.fit.clipped_valid_fraction).toFixed(3)+"%. The reference was used to fit and score this map.";
$("nyu-source").replaceChildren();$("nyu-source").append("Source: NYU Depth V2 ");const citation=document.createElement("a");citation.href="bibliography.html#ref11";citation.textContent="[11]";$("nyu-source").append(citation," · labeled-file zero-based index "+s.index+". ");
const a=document.createElement("a");a.href=s.source_url;a.textContent="Dataset homepage";$("nyu-source").append(a);
}
for(const id of ["nyu-scene","nyu-model","nyu-layer"])$(id).addEventListener("change",nyuUpdate);
try{state.catalog=await getJSON("data/catalog.json");
fill("scene",state.catalog.scenes.map(s=>[s.id,s.title]));fill("condition",Object.entries(state.catalog.conditions));fill("model",Object.entries(state.catalog.models));
$("scene").value="da2k_transparent_reflective_03";
fill("nyu-scene",state.catalog.nyu.map(s=>[s.id,s.title]));fill("nyu-model",Object.entries(state.catalog.models));nyuUpdate();await selectCase(true);
}catch(e){fail(e);}
})();
