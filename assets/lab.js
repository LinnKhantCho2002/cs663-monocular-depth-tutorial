"use strict";
(async function () {
const $ = id => document.getElementById(id);
const state = {catalog:null, grid:null, values:null, rgb:null, map:null,
  baseline:null, original:null, originalMap:null, a:[.25,.5], b:[.75,.5],
  active:"a", manual:false, revealed:false, view:"depth", guess:null, token:0};
const cache = new Map();
const conditions = {clean:"Original", dark_mild:"Mild dimming", dark_strong:"Severe dimming · almost black", blur:"Blur"};
const notes = {
  clean:"Both columns use the original input. Choose dimming or blur to test a change, or compare models on this photo.",
  dark_mild:"The selected input is digitally dimmed. The camera, objects, and annotated points stay in place.",
  dark_strong:"This is an extreme digital stress test: the selected input is almost black. The original stays visible beside it. It is not a separate real low-light photograph.",
  blur:"The selected input has Gaussian blur. Fine details change; the scene and annotated points stay in place."
};
async function getJSON(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => {
    if (!r.ok) throw new Error("Could not load " + url);
    return r.json();
  }).catch(e => {cache.delete(url); throw e;}));
  return cache.get(url);
}
function fill(id, items) {
  const select = $(id); select.replaceChildren();
  for (const [value, label] of items) {
    const option = document.createElement("option"); option.value=value; option.textContent=label; select.append(option);
  }
}
function loadImage(src) {
  return new Promise((resolve,reject) => {
    const image=new Image(); image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error("Could not load image " + src)); image.src=src;
  });
}
function scene() {return state.catalog.scenes.find(s=>s.id===$("scene").value);}
function pair() {return state.grid.record.pairs[Number($("pair").value)];}
function answer(p) {return p.predicted_closer==="point1"?"A":p.predicted_closer==="point2"?"B":"Tie";}
function answerText(value) {return value==="Tie"?"Same depth":value+" closer";}
function message(text) {$("load-status").textContent=text;}
function fail(error) {message(error.message+" Try another selection or reload the page."); console.error(error);}
function decode(g) {
  const bytes=Uint8Array.from(atob(g.values),c=>c.charCodeAt(0)), view=new DataView(bytes.buffer);
  const values=new Float32Array(g.width*g.height);
  for (let i=0;i<values.length;i++) values[i]=g.low+(g.high-g.low)*view.getUint16(i*2,true)/65535;
  return values;
}
function sample(p) {
  const g=state.grid, x=Math.min(g.width-1,Math.max(0,Math.floor(p[0]*g.width))), y=Math.min(g.height-1,Math.max(0,Math.floor(p[1]*g.height)));
  return state.values[y*g.width+x];
}
function annotatedPoints() {
  const p=pair(), g=state.grid;
  return [p.point1,p.point2].map(([y,x])=>[(x+.5)/g.nativeWidth,(y+.5)/g.nativeHeight]);
}
function markers(ctx, points, width, height) {
  for (const [i,p] of points.entries()) {
    const x=p[0]*width, y=p[1]*height;
    ctx.beginPath(); ctx.arc(x,y,11,0,2*Math.PI); ctx.fillStyle=i===0?"#146fdb":"#d14443"; ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle="white"; ctx.stroke(); ctx.font="bold 14px system-ui";
    ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle="white"; ctx.fillText(i===0?"A":"B",x,y);
  }
}
function drawComparison() {
  if (!state.grid) return;
  const points=annotatedPoints();
  for (const [id,image] of [["original-photo",state.original],["changed-photo",state.rgb],["original-depth",state.originalMap],["changed-depth",state.map]]) {
    const c=$(id),ctx=c.getContext("2d"); c.width=512; c.height=Math.round(512*state.grid.nativeHeight/state.grid.nativeWidth);
    ctx.drawImage(image,0,0,c.width,c.height); markers(ctx,points,c.width,c.height);
  }
  const index=Number($("pair").value), original=state.baseline.record.pairs[index], selected=pair();
  $("comparison-model").textContent=state.catalog.models[$("model").value]+" · the same annotated pair in both columns";
  $("comparison-summary").replaceChildren();
  const expected=selected.closer_point==="point1"?"A":"B";
  const reference=document.createElement("p"); reference.textContent="Source annotation: "+expected+" is closer. This label checks only these two locations.";
  $("comparison-summary").append(reference);
  for (const [title,record,p] of [["Original",state.baseline.record,original],[conditions[$("condition").value],state.grid.record,selected]]) {
    const row=document.createElement("p"),label=document.createElement("strong"),result=document.createElement("span");
    label.textContent=title+": "; result.textContent=answerText(answer(p))+" · "+(p.correct?"matches":"does not match")+" the annotation";
    result.className=p.correct?"correct":"incorrect";
    row.append(label,result,". All annotated pairs: "+record.correct+" / "+record.total+" correct."); $("comparison-summary").append(row);
  }
  $("guess-feedback").textContent=state.guess ? "You predicted “"+answerText(state.guess)+"”. The model predicts “"+answerText(answer(selected))+"”. Your guess is about the model’s answer; the source annotation checks whether that answer is correct." : "";
}
function syncReveal() {
  const ready=Boolean(state.grid);
  $("comparison-results").hidden=!ready||!state.revealed;
  $("prediction-question").hidden=state.revealed;
  $("reveal").disabled=!ready||state.revealed;
  $("reveal").textContent=state.revealed?"Results shown":"Show model results";
  $("reveal").setAttribute("aria-expanded",String(ready&&state.revealed));
  for (const b of document.querySelectorAll("[data-guess]")) b.disabled=!ready;
}
function clearGuess() {
  state.guess=null; $("guess-status").textContent="Optional · no grade";
  for (const b of document.querySelectorAll("[data-guess]")) b.setAttribute("aria-pressed","false");
}
function viewport() {
  const z=Number($("zoom").value), width=1/z,height=1/z;
  return {x:Math.min(1-width,Math.max(0,state.a[0]-width/2)),y:Math.min(1-height,Math.max(0,state.a[1]-height/2)),width,height};
}
function draw() {
  if (!state.grid) return;
  const c=$("depth-canvas"),ctx=c.getContext("2d"),g=state.grid,v=viewport();
  c.width=768; c.height=Math.round(768*g.nativeHeight/g.nativeWidth);
  const image=state.view==="depth"?state.map:state.rgb;
  ctx.drawImage(image,v.x*image.width,v.y*image.height,v.width*image.width,v.height*image.height,0,0,c.width,c.height);
  if (state.view==="overlay") {
    ctx.globalAlpha=Number($("opacity").value)/100;
    ctx.drawImage(state.map,v.x*state.map.width,v.y*state.map.height,v.width*state.map.width,v.height*state.map.height,0,0,c.width,c.height); ctx.globalAlpha=1;
  }
  const points=[state.a,state.b].map(p=>[(p[0]-v.x)/v.width,(p[1]-v.y)/v.height]);
  ctx.beginPath();ctx.moveTo(points[0][0]*c.width,points[0][1]*c.height);ctx.lineTo(points[1][0]*c.width,points[1][1]*c.height);
  ctx.strokeStyle="white";ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.stroke();ctx.setLineDash([]);markers(ctx,points,c.width,c.height);
  drawProfile(); updateProbes();
}
function drawProfile() {
  const c=$("profile"),ctx=c.getContext("2d"),w=c.width,h=c.height,values=[];
  for(let i=0;i<128;i++){const t=i/127;values.push(sample([state.a[0]*(1-t)+state.b[0]*t,state.a[1]*(1-t)+state.b[1]*t]));}
  const min=Math.min(...values),max=Math.max(...values),range=Math.max(1e-9,max-min);
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);ctx.strokeStyle="#dce6e0";ctx.beginPath();ctx.moveTo(50,15);ctx.lineTo(50,h-30);ctx.lineTo(w-10,h-30);ctx.stroke();
  ctx.strokeStyle="#0a7469";ctx.lineWidth=2;ctx.beginPath();values.forEach((v,i)=>{const x=50+i/127*(w-65),y=h-30-(v-min)/range*(h-50);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  ctx.fillStyle="#62776f";ctx.font="11px system-ui";ctx.textAlign="right";ctx.fillText(max.toFixed(3),44,21);ctx.fillText(min.toFixed(3),44,h-29);ctx.textAlign="left";ctx.fillText("A",50,h-10);ctx.textAlign="right";ctx.fillText("B",w-10,h-10);
}
function updateProbes() {
  const g=state.grid,p=pair(),va=state.manual?sample(state.a):p.values.point1,vb=state.manual?sample(state.b):p.values.point2,winner=va>vb?"A":vb>va?"B":"Tie";
  const coord=p=>[Math.min(g.nativeWidth-1,Math.floor(p[0]*g.nativeWidth)),Math.min(g.nativeHeight-1,Math.floor(p[1]*g.nativeHeight))];
  $("probe-values").innerHTML='<div class="evidence"><strong>'+(state.manual?'Free probes (approximate)':'Annotated-point values (exact)')+'</strong><br>A (x,y): '+coord(state.a).join(", ")+' · q = '+va.toFixed(5)+'<br>B (x,y): '+coord(state.b).join(", ")+' · q = '+vb.toFixed(5)+'<br>Model answer: '+answerText(winner)+'<br><small>'+(state.manual?'These positions have no reference annotation.':'A = source point1; B = source point2.')+'</small></div>';
}
function resetPair() {
  if (!state.grid) return;
  [state.a,state.b]=annotatedPoints();state.manual=false;updatePair();draw();
}
function updatePair() {
  if (state.manual) {$("pair-result").innerHTML='<div class="evidence"><strong>Free probes: no reference score</strong><br>Restore the annotated points to check this pair. The main comparison still uses the original annotated locations.</div>';return;}
  const p=pair(),expected=p.closer_point==="point1"?"A":"B";
  $("pair-result").innerHTML='<div class="evidence"><strong>Source annotation: '+expected+' closer</strong><br>Model answer: '+answerText(answer(p))+'<br><strong class="'+(p.correct?'correct':'incorrect')+'">'+(p.correct?'Correct on this pair':'Incorrect on this pair')+'</strong></div>';
}
async function updateComparison(token) {
  const s=scene(),condition=$("condition").value,index=Number($("pair").value);
  const rows=await Promise.all(Object.entries(state.catalog.models).map(async([key,label])=>{
    const g=await getJSON(s.conditions[condition].models[key]),p=g.record.pairs[index];
    return [label,g.record.correct+" / "+g.record.total,answerText(answer(p)),p.correct?"Yes":"No"];
  }));
  if (token!==state.token) return;
  $("scene-comparison").replaceChildren();
  for (const row of rows) {
    const tr=document.createElement("tr");row.forEach((text,i)=>{const cell=document.createElement(i===0?"th":"td");cell.textContent=text;if(i===0)cell.scope="row";if(i===3)cell.className=text==="Yes"?"correct":"incorrect";tr.append(cell);});$("scene-comparison").append(tr);
  }
}
async function selectCase(reset=false,pairIndex=null) {
  if (!state.catalog) return;
  const token=++state.token;state.grid=null;state.values=null;clearGuess();syncReveal();
  for (const id of ["pair-result","probe-values","scene-comparison","comparison-summary","guess-feedback","source-caption","case-meta"]) $(id).replaceChildren();
  for (const id of ["original-photo","changed-photo","original-depth","changed-depth","depth-canvas"]) {const c=$(id);c.getContext("2d").clearRect(0,0,c.width,c.height);}
  message("Loading matching precomputed outputs…");
  const s=scene(),condition=$("condition").value,key=$("model").value;
  $("scene-prompt").textContent=s.prompt;$("case-title").textContent=state.catalog.models[key];
  $("condition-note").textContent=notes[condition];
  $("changed-photo-label").textContent="Selected input · "+conditions[condition];
  $("changed-depth-label").textContent="Prediction · "+conditions[condition];
  for (const b of document.querySelectorAll("[data-condition]")) b.setAttribute("aria-pressed",String(b.dataset.condition===condition));
  if (reset) {
    fill("pair",s.pairs.map((p,i)=>[String(i),"Pair "+(i+1)]));
    if (pairIndex!==null) $("pair").value=String(pairIndex);else if (s.id==="da2k_transparent_reflective_03"||s.id==="da2k_adverse_style_03") $("pair").value="1";
    $("zoom").value="1";
  }
  const path=s.conditions[condition].models[key], originalPath=s.conditions.clean.models[key];
  try {
    const [g,rgb,map,baseline,original,originalMap]=await Promise.all([
      getJSON(path),loadImage(s.conditions[condition].rgb),loadImage(path.replace("data/","media/").replace(".json",".png")),
      getJSON(originalPath),loadImage(s.conditions.clean.rgb),loadImage(originalPath.replace("data/","media/").replace(".json",".png"))
    ]);
    if (token!==state.token) return;
    Object.assign(state,{grid:g,values:decode(g),rgb,map,baseline,original,originalMap});
    $("case-meta").innerHTML='<p>Input tensor: '+g.record.tensor_shape.join(" × ")+'<br>Native grid: '+g.nativeWidth+' × '+g.nativeHeight+'<br>Display grid: '+g.width+' × '+g.height+'</p><p>'+(g.record.consistency?'Rank stability: '+g.record.consistency.spearman_rank_correlation.toFixed(4)+' (not accuracy)':'Original input.')+'</p><p>Free-probe values use the approximate display grid. Annotated values come from the full-resolution output.</p>';
    $("case-download").href=path;
    const cap=$("source-caption");cap.replaceChildren();cap.append("Photo: DA-2K ");const citation=document.createElement("a");citation.href="bibliography.html#ref1";citation.textContent="[1]";cap.append(citation," · "+s.archive_member+". ");
    const link=document.createElement("a");link.href=s.source_url;link.textContent="Dataset and annotation source";cap.append(link);
    if(s.id==="da2k_transparent_reflective_03")cap.append(" Photo: Marnee Pearce; watermark retained.");
    resetPair();drawComparison();await updateComparison(token);
    if(token!==state.token)return;
    message("Precomputed outputs loaded. Changing the condition loads its matching prediction.");syncReveal();
  } catch(error) {
    if(token===state.token){state.grid=null;syncReveal();fail(error);}
  }
}
function setActive(which) {state.active=which;for(const n of ["a","b"])$("probe-"+n).setAttribute("aria-pressed",String(n===which));}
function moveProbe(point,which) {state[which]=point.map(v=>Math.min(1-1e-8,Math.max(0,v)));state.manual=true;updatePair();draw();}
$("depth-canvas").addEventListener("click",e=>{if(!state.grid)return;const r=e.currentTarget.getBoundingClientRect(),v=viewport();moveProbe([v.x+(e.clientX-r.left)/r.width*v.width,v.y+(e.clientY-r.top)/r.height*v.height],e.shiftKey?"b":state.active);});
$("depth-canvas").addEventListener("keydown",e=>{if(!state.grid||!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key))return;e.preventDefault();const p=state[state.active].slice(),stride=e.shiftKey?10:1;p[0]+=(e.key==="ArrowRight"?stride:e.key==="ArrowLeft"?-stride:0)/state.grid.nativeWidth;p[1]+=(e.key==="ArrowDown"?stride:e.key==="ArrowUp"?-stride:0)/state.grid.nativeHeight;moveProbe(p,state.active);});
$("probe-a").addEventListener("click",()=>setActive("a"));$("probe-b").addEventListener("click",()=>setActive("b"));
$("reveal").addEventListener("click",()=>{if(!state.grid)return;state.revealed=true;drawComparison();syncReveal();});
for (const b of document.querySelectorAll("[data-guess]")) b.addEventListener("click",()=>{
  state.guess=b.dataset.guess;for(const option of document.querySelectorAll("[data-guess]"))option.setAttribute("aria-pressed",String(option===b));
  $("guess-status").textContent="Your prediction: "+answerText(state.guess)+". Show the results to compare.";
});
for (const b of document.querySelectorAll("[data-condition]")) b.addEventListener("click",()=>{
  if($("condition").value===b.dataset.condition)return;
  $("condition").value=b.dataset.condition;$("condition").dispatchEvent(new Event("change"));
});
for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click",()=>{
  state.view=b.dataset.view;for(const option of document.querySelectorAll("[data-view]"))option.setAttribute("aria-pressed",String(option===b));
  $("overlay-control").hidden=state.view!=="overlay";draw();
});
$("opacity").addEventListener("input",()=>{$("opacity-value").textContent=$("opacity").value+"%";draw();});
$("zoom").addEventListener("change",draw);$("reset-pair").addEventListener("click",resetPair);
$("pair").addEventListener("change",()=>{if(!state.grid)return;clearGuess();resetPair();drawComparison();updateComparison(state.token).catch(fail);});
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
const examples={
"mirror":{scene:"da2k_transparent_reflective_03",condition:"clean",model:"v2",pair:1,reading:"Mirror · pair 2. Reveal V2’s prediction, then choose DA3 in the Model control to compare the same points."},
"mirror-da3":{scene:"da2k_transparent_reflective_03",condition:"clean",model:"da3",pair:1,reading:"Mirror · DA3 · pair 2. Reveal the prediction and check it against the annotation."},
"traffic-original":{scene:"da2k_adverse_style_03",condition:"clean",model:"v2",pair:1,reading:"Traffic · V2 · pair 2. Try dimming or blur with the same model, then reveal the results."},
"dimming":{scene:"da2k_adverse_style_03",condition:"dark_strong",model:"v2",pair:1,reading:"Traffic · severe dimming · V2 · pair 2. Compare the original and almost-black input, then reveal both predictions."},
"traffic-ac":{scene:"da2k_adverse_style_03",condition:"dark_strong",model:"ac",pair:1,reading:"Traffic · severe dimming · AC · pair 2. Reveal the results to compare its answer with the annotation."},
"kitchen":{layer:"aligned",reading:"Kitchen · V2 · aligned prediction. Scale and shift were fitted using the reference. Next compare the sensor reference and error map."},
"kitchen-reference":{layer:"gt",reading:"Kitchen · filled sensor reference. Compare the right counter edge with the aligned V2 prediction, using the same meter color range."},
"kitchen-error":{layer:"error",reading:"Kitchen · V2 · relative error. Bright areas near the counter edge show a mismatch; blue-gray areas were excluded. A low average does not mean every edge is correct."}
};
const exampleButtons=[...document.querySelectorAll("[data-example]")];
for(const button of exampleButtons){button.disabled=true;button.setAttribute("aria-pressed","false");button.addEventListener("click",()=>applyExample(button.dataset.example).catch(fail));}
function clearGuidance(){$("case-reading").textContent="";$("kitchen-reading").textContent="";for(const button of exampleButtons)button.setAttribute("aria-pressed","false");$("example-status").textContent="Controls changed. Compare the current scene, model, input, and reference in the viewer.";}
for(const id of ["scene","condition","model","pair","nyu-scene","nyu-model","nyu-layer"])$(id).addEventListener("change",clearGuidance);
async function applyExample(key){
const example=examples[key];if(!example||!state.catalog)return;
for(const button of exampleButtons){button.disabled=true;button.setAttribute("aria-pressed",String(button.dataset.example===key));}
$("example-status").textContent="Loading the example…";
try{
let target;
if(example.layer){$("nyu-scene").value="nyu_0001";$("nyu-model").value="v2";$("nyu-layer").value=example.layer;nyuUpdate();target=document.querySelector(".kitchen-steps");}
else{
$("scene").value=example.scene;$("condition").value=example.condition;$("model").value=example.model;
state.revealed=false;$("inspection-tools").open=false;clearGuess();syncReveal();
$("opacity").value="65";$("opacity-value").textContent="65%";setActive("a");
await selectCase(true,example.pair);if(!state.grid)throw new Error("Could not load the selected example.");target=$("explorer");
}
$("example-status").textContent=example.reading;
const note=example.layer?$("kitchen-reading"):$("case-reading");note.textContent=example.reading;
target.scrollIntoView({block:"start"});
}catch(e){$("example-status").textContent="The example could not load. Retry or reload the page.";throw e;}
finally{for(const button of exampleButtons)button.disabled=false;}
}
try{state.catalog=await getJSON("data/catalog.json");
fill("scene",state.catalog.scenes.map(s=>[s.id,s.title]));fill("model",Object.entries(state.catalog.models));
$("scene").value="da2k_adverse_style_03";
fill("nyu-scene",state.catalog.nyu.map(s=>[s.id,s.title]));fill("nyu-model",Object.entries(state.catalog.models));nyuUpdate();await selectCase(true);
for(const button of exampleButtons)button.disabled=false;
const initial=new URLSearchParams(location.search).get("example");if(initial&&examples[initial])await applyExample(initial);
}catch(e){fail(e);}
})();
