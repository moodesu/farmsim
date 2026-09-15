const STORAGE_KEY = "fs25HardcorePlannerV1";

const defaults = {
  players: [
    {name:"Don", role:"Unassigned"},
    {name:"Mdgi", role:"Unassigned"},
    {name:"Zakk", role:"Unassigned"}
  ],
  finance: { cash:1000, debt:0, farmValue:1000, landOwned:false },
  session: { month:"", year:1, day:1, timescale:"5x", objective:"Build first land fund" },
  tasks: [
    {id:crypto.randomUUID(), title:"Scout possible first parcel", player:"All", priority:"High", status:"Ready", notes:"Look for useful trees, access and workable terrain."},
    {id:crypto.randomUUID(), title:"Find first suitable contract", player:"All", priority:"High", status:"Ready", notes:"Maximum two simultaneous contracts in Stage 0."}
  ],
  fields: [],
  machines: [],
  purchases: [],
  transactions: [],
  cropPlans: [],
  mods: [],
  milestones: {
    firstLand:false,
    ownTractor:false,
    ownField:false,
    firstHarvest:false
  }
};

function clone(x){ return JSON.parse(JSON.stringify(x)); }

const SUPABASE_URL = "https://gortstcnvphczhoadvol.supabase.co";
const SUPABASE_KEY = "sb_publishable_5ZGl8kuShrGq-3DEXjDdaQ_S9rAmYqJ";
const FARM_SLUG = "three-hands-farm";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let state = clone(defaults);
let farmId = null;
let isAdmin = false;
let saveInFlight = false;
let selectedMapFieldId = null;

function loadLocalBackup(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return Object.assign(clone(defaults), JSON.parse(raw));
  }catch(e){
    return null;
  }
}

function cacheLocal(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setSyncStatus(text, kind=""){
  const el=document.getElementById("sync-status");
  if(!el) return;
  el.textContent=text;
  el.className=`sync-status ${kind}`.trim();
}

function setAdminMode(enabled){
  isAdmin=!!enabled;
  document.body.classList.toggle("admin-mode", isAdmin);
  const btn=document.getElementById("admin-login-btn");
  if(btn) btn.textContent=isAdmin ? "Sign out" : "Admin";
}

function money(v){ return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(v)||0); }
function esc(s=""){ return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }



const cropMonths = ["March","April","May","June","July","August","September","October","November","December","January","February"];
const cropCalendar = [
  {name:"Barley", plant:["September","October"], harvest:["June","July"], cost:1, complexity:1, opportunity:3, equipment:["seeder","grain header"], note:"Standard cereal equipment and a dependable first arable crop."},
  {name:"Canola", plant:["August","September"], harvest:["July","August"], cost:1, complexity:1, opportunity:4, equipment:["seeder","grain header"], note:"Simple cereal-style equipment with a strong-value crop."},
  {name:"Carrots", plant:["April","May","June","July"], harvest:["August","September","October","November"], cost:4, complexity:5, opportunity:4, equipment:["vegetable planter","carrot harvester"], note:"Specialist planting and harvesting equipment makes this expensive early on."},
  {name:"Corn", plant:["April","May"], harvest:["October","November"], cost:3, complexity:3, opportunity:4, equipment:["planter","corn header"], note:"Good crop, but it adds planter and corn-header requirements."},
  {name:"Cotton", plant:["February","March"], harvest:["October","November"], cost:5, complexity:5, opportunity:4, equipment:["planter","cotton harvester"], note:"High specialist-machine requirement; a poor fit for a cash-starved start."},
  {name:"Grapes", plant:["March","April","May"], harvest:["September","October"], cost:5, complexity:5, opportunity:5, equipment:["vineyard equipment","grape harvester"], note:"A long-term specialist enterprise rather than an early survival crop."},
  {name:"Grass", plant:["March","April","May","June","July","August","September","October","November"], harvest:["March","April","May","June","July","August","September","October","November","December","January","February"], cost:1, complexity:1, opportunity:3, equipment:["mower"], note:"Very flexible and cheap to establish; useful before a full arable fleet exists."},
  {name:"Green Beans", plant:["April","May","June"], harvest:["August","September","October","November"], cost:4, complexity:5, opportunity:4, equipment:["vegetable planter","green bean harvester"], note:"Potentially valuable but dependent on specialist vegetable machinery."},
  {name:"Long Grain Rice", plant:["April"], harvest:["September"], cost:5, complexity:5, opportunity:4, equipment:["rice planter","rice harvester"], note:"Specialist crop with infrastructure and equipment demands."},
  {name:"Oat", plant:["March","April"], harvest:["July","August"], cost:1, complexity:1, opportunity:3, equipment:["seeder","grain header"], note:"Excellent early cereal: short cycle and standard machinery."},
  {name:"Oilseed Radish", plant:["March","April","May","June","July","August","September","October"], harvest:[], cost:1, complexity:1, opportunity:1, equipment:["seeder"], note:"Cover crop / field improvement rather than a direct cash harvest."}
];

function normalizedMonth(value){
  const v=String(value||"").trim().toLowerCase();
  const found=cropMonths.find(m=>m.toLowerCase()===v || m.slice(0,3).toLowerCase()===v.slice(0,3));
  return found || "March";
}

function monthDistance(from,to){
  const a=cropMonths.indexOf(from), b=cropMonths.indexOf(to);
  if(a<0 || b<0) return 99;
  return (b-a+cropMonths.length)%cropMonths.length;
}

function harvestDistance(crop,current){
  if(!crop.harvest.length) return 99;
  return Math.min(...crop.harvest.map(m=>monthDistance(current,m)));
}

function machineCoverage(crop){
  const fleet=state.machines.map(m=>`${m.name} ${m.type}`.toLowerCase()).join(" ");
  const aliases={
    "seeder":["seeder","seed drill","drill"], "grain header":["grain header","cereal header","combine"],
    "planter":["planter"], "corn header":["corn header","maize header"], "mower":["mower"],
    "vegetable planter":["vegetable planter","planter"], "carrot harvester":["carrot harvester"],
    "green bean harvester":["green bean harvester","bean harvester"], "cotton harvester":["cotton harvester"],
    "vineyard equipment":["vineyard","grape"], "grape harvester":["grape harvester"],
    "rice planter":["rice planter"], "rice harvester":["rice harvester"]
  };
  const missing=crop.equipment.filter(req=>!(aliases[req]||[req]).some(term=>fleet.includes(term)));
  return {owned:crop.equipment.length-missing.length,total:crop.equipment.length,missing};
}

function recommendationScore(crop,current,goal){
  const distance=harvestDistance(crop,current), coverage=machineCoverage(crop), stage=currentStage();
  let score=50;
  if(goal==="lowCost") score += (6-crop.cost)*11 + (6-crop.complexity)*9;
  if(goal==="quickCash") score += distance===99 ? -35 : Math.max(0,45-distance*7) + (6-crop.complexity)*3;
  if(goal==="longTerm") score += crop.opportunity*12 + (6-crop.cost)*3;
  score += coverage.total ? (coverage.owned/coverage.total)*18 : 0;
  if(stage<2 && crop.complexity>=4) score -= 30;
  if(stage<2 && crop.cost>=4) score -= 22;
  if(crop.name==="Oilseed Radish") score -= 25;
  return Math.round(score);
}

function renderCropRecommendations(){
  const monthEl=document.getElementById("crop-current-month"), goalEl=document.getElementById("crop-goal");
  if(!monthEl || !goalEl) return;
  const current=normalizedMonth(monthEl.value || state.session.month || "March"), goal=goalEl.value || "lowCost";
  const options=cropCalendar.filter(c=>c.plant.includes(current)).map(c=>({
    ...c, score:recommendationScore(c,current,goal), distance:harvestDistance(c,current), coverage:machineCoverage(c)
  })).sort((a,b)=>b.score-a.score);
  const summary=document.getElementById("crop-recommend-summary"), results=document.getElementById("crop-recommend-results");
  if(!summary || !results) return;
  if(!options.length){
    summary.innerHTML=`<div class="recommend-callout"><strong>No listed crop can be planted in ${esc(current)}.</strong><span>Prepare fields, harvest what is ready, run contracts, or wait for the next planting window.</span></div>`;
    results.innerHTML=""; return;
  }
  const best=options[0], goalLabels={lowCost:"low cost",quickCash:"quick cash",longTerm:"long-term value"};
  summary.innerHTML=`<div class="recommend-callout"><span class="eyebrow">Best fit for ${esc(current)}</span><strong>${esc(best.name)}</strong><span>${esc(best.note)}</span><small>Ranked for ${esc(goalLabels[goal])} · Stage ${currentStage()} ${esc(stageDefs[currentStage()].name)}</small></div>`;
  results.innerHTML=options.map((c,i)=>{
    const harvest=c.distance===99?"No cash harvest":c.distance===0?"Harvestable this month":`${c.distance} month${c.distance===1?"":"s"} to first harvest window`;
    const coverageText=`${c.coverage.owned}/${c.coverage.total} equipment requirements matched`;
    const missing=c.coverage.missing.length?`Missing: ${c.coverage.missing.join(", ")}`:"Recorded fleet matches the key equipment categories.";
    const warning=(currentStage()<2 && c.complexity>=4)?`<span class="recommend-warning">Specialist crop — poor early-game fit</span>`:"";
    return `<article class="recommend-card ${i===0?"best":""}"><div class="recommend-rank">#${i+1}</div><div class="recommend-main"><div class="recommend-title"><strong>${esc(c.name)}</strong>${i===0?'<span class="badge">Recommended</span>':""}</div><p>${esc(c.note)}</p><div class="recommend-meta"><span>${esc(harvest)}</span><span>Cost ${c.cost}/5</span><span>Complexity ${c.complexity}/5</span><span>${esc(coverageText)}</span></div><small>${esc(missing)}</small>${warning}</div><div class="recommend-score">${c.score}</div></article>`;
  }).join("");
}

function renderCropPlanner(){
  const current=normalizedMonth(state.session.month || "March");
  const select=document.getElementById("crop-current-month");
  select.value=current;
  document.getElementById("plant-now-title").textContent=current;
  document.getElementById("harvest-now-title").textContent=current;
  const planting=cropCalendar.filter(c=>c.plant.includes(current));
  const harvesting=cropCalendar.filter(c=>c.harvest.includes(current));
  document.getElementById("plant-now").innerHTML=planting.length?planting.map(c=>`<span class="crop-chip plant">${esc(c.name)}</span>`).join(""):`<span class="muted">Nothing in this calendar.</span>`;
  document.getElementById("harvest-now").innerHTML=harvesting.length?harvesting.map(c=>`<span class="crop-chip harvest">${esc(c.name)}</span>`).join(""):`<span class="muted">Nothing in this calendar.</span>`;

  const header=`<div class="crop-cell crop-name head">Crop</div>${cropMonths.map(m=>`<div class="crop-cell month-head ${m===current?"current-month":""}">${m.slice(0,3)}</div>`).join("")}`;
  const rows=cropCalendar.map(c=>`<div class="crop-cell crop-name">${esc(c.name)}</div>${cropMonths.map(m=>{
    const plant=c.plant.includes(m), harvest=c.harvest.includes(m);
    const cls=["crop-cell","season-cell",m===current?"current-month":"",plant?"plant":"",harvest?"harvest":""].filter(Boolean).join(" ");
    const label=plant&&harvest?"Plant / harvest":plant?"Plant":harvest?"Harvest":"";
    return `<div class="${cls}" title="${esc(c.name)} · ${esc(m)}${label?" · "+label:""}">${plant?'<span class="season-mark plant-mark"></span>':""}${harvest?'<span class="season-mark harvest-mark"></span>':""}</div>`;
  }).join("")}`).join("");
  document.getElementById("crop-calendar").innerHTML=header+rows;

  const cropSelect=document.getElementById("crop-plan-crop");
  if(!cropSelect.options.length) cropSelect.innerHTML=cropCalendar.map(c=>`<option>${esc(c.name)}</option>`).join("");
  const monthOrder=m=>cropMonths.indexOf(m);
  const plans=[...state.cropPlans].sort((a,b)=>monthOrder(a.month)-monthOrder(b.month));
  document.getElementById("crop-plan-list").innerHTML=plans.length?plans.map(p=>`<div class="data-row"><div class="data-row-main"><strong>${esc(p.field)} · ${esc(p.crop)}</strong><small>${esc(p.operation)} · ${esc(p.month)}${p.notes?" · "+esc(p.notes):""}</small></div><button class="mini delete delete-crop-plan" data-id="${p.id}">Delete</button></div>`).join(""):`<div class="empty">No crop operations planned yet.</div>`;
  document.querySelectorAll(".delete-crop-plan").forEach(b=>b.addEventListener("click",()=>{state.cropPlans=state.cropPlans.filter(p=>p.id!==b.dataset.id); save();}));  renderCropRecommendations();
}

function renderMods(){
  const root=document.getElementById("mods-grid");
  if(!root) return;
  const stage=currentStage();
  const mods=Array.isArray(state.mods)?state.mods:[];
  const count=document.getElementById("mods-count");
  if(count) count.textContent=`${mods.length} installed`;
  root.innerHTML=mods.length ? mods.map(mod=>{
    const unlock=Number(mod.unlock_stage ?? mod.unlock ?? 0);
    const status=mod.status || "Allowed";
    const note=mod.rule_note || mod.note || "";
    const available=unlock===99 ? false : stage>=unlock;
    const stateText=unlock===99 ? status : available ? "Available now" : `Unlocks Stage ${unlock}`;
    const stateClass=unlock===99 ? "critical" : available ? "done" : "";
    const link=mod.modhub_url ? `<a class="small-btn mod-link" href="${esc(mod.modhub_url)}" target="_blank" rel="noopener">ModHub</a>` : "";
    return `<article class="mod-card"><div class="mod-card-head"><div><span class="eyebrow">${esc(mod.category||"Mod")}</span><h3>${esc(mod.name)}</h3></div><span class="badge ${stateClass}">${esc(stateText)}</span></div><p>${esc(note)}</p><div class="mod-card-actions"><small>${esc(status)}</small><div>${link}<button class="mini delete admin-only delete-mod" data-id="${esc(mod.id||"")}" data-name="${esc(mod.name)}">Remove</button></div></div></article>`;
  }).join("") : `<div class="empty">No mods recorded yet.</div>`;
  document.querySelectorAll(".delete-mod").forEach(b=>b.addEventListener("click",()=>{
    if(!isAdmin) return;
    const label=b.dataset.name||"this mod";
    if(!confirm(`Remove ${label} from the farm mod list?`)) return;
    state.mods=state.mods.filter(m=>m.id!==b.dataset.id);
    save();
  }));
}

const stageDefs = [
  {id:0,name:"Broke",threshold:0,desc:"Contract labour only. No land, loans or normal leasing."},
  {id:1,name:"Homestead",threshold:0,desc:"First parcel owned. Buy machinery; leasing still locked."},
  {id:2,name:"Working Farm",threshold:150000,desc:"Leasing and loans unlocked once operational requirements are met."},
  {id:3,name:"Established Farm",threshold:350000,desc:"Livestock, specialist crops, silage and basic productions unlocked."},
  {id:4,name:"Agribusiness",threshold:750000,desc:"Major productions and large-scale expansion unlocked."}
];

function currentStage(){
  if(!state.finance.landOwned) return 0;
  const stage2Req = state.finance.farmValue >= 150000 &&
    state.milestones.ownTractor && state.milestones.ownField && state.milestones.firstHarvest;
  if(state.finance.farmValue >= 750000) return 4;
  if(state.finance.farmValue >= 350000) return 3;
  if(stage2Req) return 2;
  return 1;
}

function loanLimit(){
  return currentStage() >= 2 ? Math.floor(state.finance.farmValue * .25) : 0;
}

function navTo(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  const meta = {
    dashboard:["Dashboard","Shared farm status and current objective."],
    planner:["Session Planner","Plan and assign the next co-op session."],
    fields:["Fields","Track parcels, crops and next operations."],
    crops:["Crop Planner","Seasonal planting, harvest windows and farm crop plans."],
    machines:["Machinery","Fleet inventory and purchase wishlist."],
    mods:["Mods / DLC","Installed mods and their hardcore campaign status."],
    finance:["Finance","Shared farm balances and transaction log."],
    progression:["Progression","Campaign stages and unlock conditions."],
    rules:["Ruleset","The official hardcore co-op house rules."]
  };
  document.getElementById("page-title").textContent = meta[id][0];
  document.getElementById("page-subtitle").textContent = meta[id][1];
  window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>navTo(b.dataset.view)));
document.querySelectorAll("[data-view-jump]").forEach(b=>b.addEventListener("click",()=>navTo(b.dataset.viewJump)));

function renderDashboard(){
  const st = currentStage();
  document.getElementById("dash-cash").textContent = money(state.finance.cash);
  document.getElementById("dash-debt").textContent = money(state.finance.debt);
  document.getElementById("dash-value").textContent = money(state.finance.farmValue);
  document.getElementById("dash-stage").textContent = `Stage ${st}`;
  document.getElementById("dash-stage-name").textContent = stageDefs[st].name;
  document.getElementById("dash-loan-limit").textContent = st>=2 ? `Loan cap ${money(loanLimit())}` : "Loans locked";

  const target = state.finance.landOwned ? 150000 : 30000;
  const current = state.finance.landOwned ? state.finance.farmValue : state.finance.cash;
  const pct = Math.max(0,Math.min(100,Math.round((current/target)*100)));
  document.getElementById("objective-name").textContent = state.finance.landOwned ? "Reach Working Farm" : "Build first land fund";
  document.getElementById("objective-progress").style.width = pct+"%";
  document.getElementById("objective-copy").textContent = `${money(current)} / ${money(target)}`;
  document.getElementById("objective-percent").textContent = pct+"%";

  document.getElementById("player-list").innerHTML = state.players.map(p=>{
    const open = state.tasks.filter(t=>t.player===p.name && t.status!=="Done");
    const task = open[0]?.title || "No active assignment";
    return `<div class="player-row"><div class="avatar">${esc(p.name[0])}</div><div class="player-meta"><strong>${esc(p.name)}</strong><small>${esc(task)}</small></div><span class="badge">${open.length} open</span></div>`;
  }).join("");

  const priorityOrder = {Critical:0,High:1,Medium:2,Low:3};
  const openTasks = state.tasks.filter(t=>t.status!=="Done").sort((a,b)=>priorityOrder[a.priority]-priorityOrder[b.priority]).slice(0,5);
  document.getElementById("dashboard-tasks").innerHTML = openTasks.length ? openTasks.map(taskRow).join("") : `<div class="empty">No open tasks.</div>`;

  const sortedPurchases = [...state.purchases].sort((a,b)=>priorityOrder[a.priority]-priorityOrder[b.priority]);
  const next = sortedPurchases[0];
  document.getElementById("next-purchase-title").textContent = next ? next.name : "Nothing planned";
  const spendable = Math.max(0,state.finance.cash - (state.finance.landOwned ? 10000 : 0));
  document.getElementById("next-purchase-body").innerHTML = next ?
    `<p><strong>${money(next.price)}</strong></p><p class="muted">${esc(next.reason||"No reason recorded")}</p><span class="badge ${next.priority.toLowerCase()}">${esc(next.priority)}</span> <span class="badge">${spendable>=next.price?"Affordable":"Need "+money(next.price-spendable)}</span>` :
    `<p class="muted">Add an item from Machinery → Purchase wishlist.</p>`;

  document.getElementById("count-fields").textContent = state.fields.length;
  document.getElementById("count-machines").textContent = state.machines.length;
  document.getElementById("count-tasks").textContent = state.tasks.filter(t=>t.status!=="Done").length;
  document.getElementById("count-purchases").textContent = state.purchases.length;
}

function taskRow(t){
  return `<div class="task-row"><div class="task-row-main"><strong>${esc(t.title)}</strong><small>${esc(t.player)} · ${esc(t.status)}${t.notes?" · "+esc(t.notes):""}</small></div><span class="badge ${t.priority.toLowerCase()}">${esc(t.priority)}</span></div>`;
}

function renderPlanner(){
  const statuses = ["Backlog","Ready","In Progress","Done"];
  document.getElementById("task-board").innerHTML = statuses.map(status=>{
    const tasks = state.tasks.filter(t=>t.status===status);
    return `<div class="board-col"><h3><span>${status}</span><span>${tasks.length}</span></h3>${tasks.map(t=>`
      <div class="board-card">
        <p><strong>${esc(t.title)}</strong></p>
        <small>${esc(t.player)} · ${esc(t.priority)}</small>
        ${t.notes?`<small style="display:block;margin-top:5px">${esc(t.notes)}</small>`:""}
        <div class="board-actions">
          ${statuses.filter(s=>s!==status).map(s=>`<button class="mini move-task" data-id="${t.id}" data-status="${s}">${s}</button>`).join("")}
          <button class="mini delete delete-task" data-id="${t.id}">Delete</button>
        </div>
      </div>`).join("") || `<div class="empty">No tasks</div>`}</div>`;
  }).join("");

  document.querySelectorAll(".move-task").forEach(b=>b.addEventListener("click",()=>{
    const t=state.tasks.find(x=>x.id===b.dataset.id); if(t){ t.status=b.dataset.status; save(); }
  }));
  document.querySelectorAll(".delete-task").forEach(b=>b.addEventListener("click",()=>{
    state.tasks=state.tasks.filter(x=>x.id!==b.dataset.id); save();
  }));

  const f=document.getElementById("session-form");
  f.month.value=state.session.month||"";
  f.year.value=state.session.year||1;
  f.day.value=state.session.day||1;
  f.timescale.value=state.session.timescale||"5x";
  f.objective.value=state.session.objective||"";
}

function renderFields(){
  document.getElementById("fields-table").innerHTML = state.fields.length ? state.fields.map((f,i)=>`
    <div class="data-row"><div class="data-row-main"><strong>${esc(f.name)} · ${esc(f.crop||"Unassigned")}</strong><small>${esc(f.state)} · Next: ${esc(f.next||"Not set")}</small></div><button class="mini delete delete-field" data-i="${i}">Delete</button></div>`).join("") : `<div class="empty">No land or fields recorded yet.</div>`;
  document.querySelectorAll(".delete-field").forEach(b=>b.addEventListener("click",()=>{state.fields.splice(Number(b.dataset.i),1); save();}));
}

function renderMachines(){
  document.getElementById("machine-list").innerHTML = state.machines.length ? state.machines.map((m,i)=>`
    <div class="data-row"><div class="data-row-main"><strong>${esc(m.name)}</strong><small>${esc(m.type||"Machine")} · ${esc(m.ownership)} · ${money(m.value)}</small></div><button class="mini delete delete-machine" data-i="${i}">Delete</button></div>`).join("") : `<div class="empty">No machinery yet.</div>`;
  document.querySelectorAll(".delete-machine").forEach(b=>b.addEventListener("click",()=>{state.machines.splice(Number(b.dataset.i),1); syncMilestones(); save();}));

  document.getElementById("purchase-list").innerHTML = state.purchases.length ? state.purchases.map((p,i)=>`
    <div class="data-row"><div class="data-row-main"><strong>${esc(p.name)}</strong><small>${money(p.price)} · ${esc(p.priority)}${p.reason?" · "+esc(p.reason):""}</small></div><button class="mini delete delete-purchase" data-i="${i}">Delete</button></div>`).join("") : `<div class="empty">No planned purchases.</div>`;
  document.querySelectorAll(".delete-purchase").forEach(b=>b.addEventListener("click",()=>{state.purchases.splice(Number(b.dataset.i),1); save();}));
}

function renderFinance(){
  const spendable = Math.max(0,state.finance.cash-(state.finance.landOwned?10000:0));
  ["finance-cash","finance-debt","finance-value"].forEach((id,idx)=>{
    document.getElementById(id).textContent = money([state.finance.cash,state.finance.debt,state.finance.farmValue][idx]);
  });
  document.getElementById("finance-spendable").textContent = money(spendable);

  const f=document.getElementById("balance-form");
  f.cash.value=state.finance.cash;
  f.debt.value=state.finance.debt;
  f.farmValue.value=state.finance.farmValue;
  f.landOwned.value=String(state.finance.landOwned);

  document.getElementById("transaction-list").innerHTML = state.transactions.length ? [...state.transactions].reverse().slice(0,30).map(t=>`
    <div class="data-row"><div class="data-row-main"><strong>${esc(t.description)}</strong><small>${esc(t.category)} · ${esc(t.date)}</small></div><strong>${money(t.amount)}</strong></div>`).join("") : `<div class="empty">No transactions yet.</div>`;
}

function renderProgression(){
  const st=currentStage();
  const checks = {
    0:["No land owned","No normal leasing","No loans"],
    1:["First parcel purchased","$10,000 reserve rule applies","Leasing still locked"],
    2:[`${state.finance.farmValue>=150000?"✓":"○"} $150,000 farm value`,`${state.milestones.ownTractor?"✓":"○"} Own tractor`,`${state.milestones.ownField?"✓":"○"} Own field`,`${state.milestones.firstHarvest?"✓":"○"} Complete first harvest`],
    3:[`${state.finance.farmValue>=350000?"✓":"○"} $350,000 farm value`,"Livestock/basic productions unlocked"],
    4:[`${state.finance.farmValue>=750000?"✓":"○"} $750,000 farm value`,"Major expansion unlocked"]
  };
  document.getElementById("stage-list").innerHTML = stageDefs.map(s=>`
    <div class="stage ${s.id===st?"current":s.id>st?"locked":""}">
      <div class="stage-head"><div><span class="eyebrow">Stage ${s.id}</span><h2>${s.name}</h2></div><span class="badge">${s.id<st?"Completed":s.id===st?"Current":"Locked"}</span></div>
      <p class="muted">${s.desc}</p>
      <ul>${checks[s.id].map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
    </div>`).join("");
}

function syncMilestones(){
  state.milestones.firstLand = !!state.finance.landOwned;
  state.milestones.ownTractor = state.machines.some(m => /tractor/i.test(m.type) || /tractor/i.test(m.name));
  state.milestones.ownField = state.fields.length>0;
}

function renderAll(){
  syncMilestones();
  renderDashboard();
  renderPlanner();
  renderFields();
  renderCropPlanner();
  renderMachines();
  renderMods();
  renderFinance();
  renderProgression();
}

document.getElementById("task-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target));
  state.tasks.push({id:crypto.randomUUID(),...d}); e.target.reset(); save();
});
document.getElementById("session-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target));
  d.year=Number(d.year)||1; d.day=Number(d.day)||1; state.session=d; save();
});
document.getElementById("clear-done-btn").addEventListener("click",()=>{state.tasks=state.tasks.filter(t=>t.status!=="Done"); save();});
document.getElementById("field-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target)); state.fields.push(d); e.target.reset(); save();
});


document.getElementById("crop-current-month").addEventListener("change",e=>{
  state.session.month=e.target.value;
  cacheLocal();
  renderCropPlanner();
  if(isAdmin) save();
});
document.getElementById("crop-recommend-form").addEventListener("submit",e=>{
  e.preventDefault();
  state.session.month=document.getElementById("crop-current-month").value;
  cacheLocal();
  renderCropRecommendations();
  if(isAdmin) save();
});
document.getElementById("crop-goal").addEventListener("change",renderCropRecommendations);
document.getElementById("crop-plan-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target));
  state.cropPlans.push({id:crypto.randomUUID(),...d}); e.target.reset(); save();
});

document.getElementById("mod-form")?.addEventListener("submit",e=>{
  e.preventDefault();
  if(!isAdmin) return;
  const d=Object.fromEntries(new FormData(e.target));
  const name=String(d.name||"").trim();
  if(!name) return;
  const duplicate=(state.mods||[]).some(m=>String(m.name).toLowerCase()===name.toLowerCase());
  if(duplicate){ alert("That mod is already in the list."); return; }
  state.mods.push({
    id:crypto.randomUUID(), name,
    category:String(d.category||"Mod").trim()||"Mod",
    status:String(d.status||"Allowed"),
    unlock_stage:Number(d.unlock_stage)||0,
    modhub_url:String(d.modhub_url||"").trim(),
    rule_note:String(d.rule_note||"").trim()
  });
  e.target.reset();
  save();
});

document.getElementById("machine-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target)); d.value=Number(d.value)||0; state.machines.push(d); e.target.reset(); save();
});
document.getElementById("purchase-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target)); d.price=Number(d.price)||0; state.purchases.push(d); e.target.reset(); save();
});
document.getElementById("balance-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target));
  state.finance.cash=Math.max(0,Number(d.cash)||0);
  state.finance.debt=Math.max(0,Number(d.debt)||0);
  state.finance.farmValue=Math.max(0,Number(d.farmValue)||0);
  state.finance.landOwned=d.landOwned==="true";
  save();
});
document.getElementById("transaction-form").addEventListener("submit",e=>{
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target)); d.amount=Number(d.amount)||0;
  d.date=new Date().toISOString().slice(0,10);
  state.transactions.push(d); state.finance.cash=Math.max(0,state.finance.cash+d.amount); e.target.reset(); save();
});


async function checkAdminSession(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){
    setAdminMode(false);
    return false;
  }
  const {data, error}=await db.from("fs_admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
  if(error || !data){
    setAdminMode(false);
    return false;
  }
  setAdminMode(true);
  return true;
}

async function loadRemoteState(showStatus=true){
  try{
    if(showStatus) setSyncStatus("Loading…");
    const {data:farm,error:farmErr}=await db.from("fs_farm").select("*").eq("slug",FARM_SLUG).single();
    if(farmErr) throw farmErr;
    farmId=farm.id;

    const [
      tasksRes, fieldsRes, machinesRes, purchasesRes,
      txRes, plansRes, milestonesRes, modsRes
    ]=await Promise.all([
      db.from("fs_tasks").select("*").eq("farm_id",farmId).order("sort_order",{ascending:true}).order("created_at",{ascending:true}),
      db.from("fs_fields").select("*").eq("farm_id",farmId).order("created_at",{ascending:true}),
      db.from("fs_machines").select("*").eq("farm_id",farmId).order("created_at",{ascending:true}),
      db.from("fs_purchases").select("*").eq("farm_id",farmId).eq("purchased",false).order("created_at",{ascending:true}),
      db.from("fs_transactions").select("*").eq("farm_id",farmId).order("happened_on",{ascending:true}).order("created_at",{ascending:true}),
      db.from("fs_crop_plans").select("*").eq("farm_id",farmId).order("created_at",{ascending:true}),
      db.from("fs_milestones").select("*").eq("farm_id",farmId).maybeSingle(),
      db.from("fs_mods").select("*").eq("farm_id",farmId).eq("enabled",true).order("name",{ascending:true})
    ]);

    for(const r of [tasksRes,fieldsRes,machinesRes,purchasesRes,txRes,plansRes,milestonesRes,modsRes]){
      if(r.error) throw r.error;
    }

    state={
      ...clone(defaults),
      players:Array.isArray(farm.players) ? farm.players.map(name=>({name,role:"Unassigned"})) : clone(defaults.players),
      finance:{
        cash:Number(farm.cash)||0,
        debt:Number(farm.debt)||0,
        farmValue:Number(farm.farm_value)||0,
        landOwned:!!farm.land_owned
      },
      session:{
        month:farm.game_month||"",
        year:Number(farm.game_year)||1,
        day:Number(farm.game_day)||1,
        timescale:farm.timescale||"5x",
        objective:farm.current_objective||""
      },
      tasks:(tasksRes.data||[]).map(r=>({
        id:r.id,title:r.title,player:r.player,priority:r.priority,status:r.status,notes:r.notes||""
      })),
      fields:(fieldsRes.data||[]).map(r=>({
        id:r.id,name:r.name,area:Number(r.area_ha)||null,crop:r.crop||"",state:r.state||"Planned",next:r.next_operation||"",notes:r.notes||""
      })),
      machines:(machinesRes.data||[]).map(r=>({
        id:r.id,name:r.name,type:r.type||"",ownership:r.ownership||"Owned",value:Number(r.value)||0,notes:r.notes||""
      })),
      purchases:(purchasesRes.data||[]).map(r=>({
        id:r.id,name:r.name,price:Number(r.target_price)||0,priority:r.priority||"Medium",reason:r.reason||""
      })),
      transactions:(txRes.data||[]).map(r=>({
        id:r.id,description:r.description,amount:Number(r.amount)||0,category:r.category||"Other",date:r.happened_on||""
      })),
      cropPlans:(plansRes.data||[]).map(r=>({
        id:r.id,field:r.field_name||"",crop:r.crop,operation:r.operation||"",month:r.target_month||"",notes:r.notes||""
      })),
      milestones:{
        firstLand:!!milestonesRes.data?.first_land,
        ownTractor:!!milestonesRes.data?.own_tractor,
        ownField:!!milestonesRes.data?.own_field,
        firstHarvest:!!milestonesRes.data?.first_harvest
      },
      mods:(modsRes.data||[]).map(r=>({
        id:r.id,name:r.name,category:r.category||"Mod",status:r.status||"Allowed",
        unlock_stage:Number(r.unlock_stage)||0,rule_note:r.rule_note||"",modhub_url:r.modhub_url||""
      }))
    };
    cacheLocal();
    renderAll();
    setSyncStatus("Live · Supabase","ok");
  }catch(err){
    console.error(err);
    const cached=loadLocalBackup();
    if(cached){
      state=cached;
      renderAll();
      setSyncStatus("Offline cache","error");
    }else{
      setSyncStatus("Load failed","error");
    }
  }
}

async function replaceRows(table, rows){
  const {error:delErr}=await db.from(table).delete().eq("farm_id",farmId);
  if(delErr) throw delErr;
  if(rows.length){
    const {error:insErr}=await db.from(table).insert(rows);
    if(insErr) throw insErr;
  }
}

async function syncRemoteState(){
  if(!isAdmin || !farmId) return;
  if(saveInFlight) return;
  saveInFlight=true;
  setSyncStatus("Saving…");
  try{
    syncMilestones();
    const {error:farmErr}=await db.from("fs_farm").update({
      cash:state.finance.cash,
      debt:state.finance.debt,
      farm_value:state.finance.farmValue,
      land_owned:state.finance.landOwned,
      game_month:state.session.month||"",
      game_year:state.session.year||1,
      game_day:state.session.day||1,
      days_per_month:3,
      timescale:state.session.timescale||"5x",
      current_objective:state.session.objective||"",
      map_name:"Moss Valley",
      updated_at:new Date().toISOString()
    }).eq("id",farmId);
    if(farmErr) throw farmErr;

    await replaceRows("fs_tasks", state.tasks.map((t,i)=>({
      farm_id:farmId,title:t.title,player:t.player||"All",priority:t.priority||"Medium",
      status:t.status||"Ready",notes:t.notes||"",sort_order:i
    })));
    await replaceRows("fs_fields", state.fields.map(f=>({
      farm_id:farmId,name:f.name,area_ha:f.area||null,crop:f.crop||"",state:f.state||"Planned",
      next_operation:f.next||"",notes:f.notes||""
    })));
    await replaceRows("fs_machines", state.machines.map(m=>({
      farm_id:farmId,name:m.name,type:m.type||"",ownership:m.ownership||"Owned",
      value:Number(m.value)||0,notes:m.notes||""
    })));
    await replaceRows("fs_purchases", state.purchases.map(p=>({
      farm_id:farmId,name:p.name,target_price:Number(p.price)||0,priority:p.priority||"Medium",
      reason:p.reason||"",purchased:false
    })));
    await replaceRows("fs_transactions", state.transactions.map(t=>({
      farm_id:farmId,description:t.description,amount:Number(t.amount)||0,
      category:t.category||"Other",happened_on:/^\d{4}-\d{2}-\d{2}$/.test(t.date||"")?t.date:new Date().toISOString().slice(0,10)
    })));
    await replaceRows("fs_crop_plans", state.cropPlans.map(p=>({
      farm_id:farmId,field_name:p.field||"",crop:p.crop,operation:p.operation||"",
      target_month:p.month||"",notes:p.notes||""
    })));
    await replaceRows("fs_mods", (state.mods||[]).map(m=>({
      farm_id:farmId,name:m.name,category:m.category||"Mod",enabled:true,
      rule_note:m.rule_note||m.note||"",status:m.status||"Allowed",
      unlock_stage:Number(m.unlock_stage ?? m.unlock ?? 0),modhub_url:m.modhub_url||""
    })));

    const {error:milestoneErr}=await db.from("fs_milestones").upsert({
      farm_id:farmId,
      first_land:!!state.milestones.firstLand,
      own_tractor:!!state.milestones.ownTractor,
      own_field:!!state.milestones.ownField,
      first_harvest:!!state.milestones.firstHarvest,
      updated_at:new Date().toISOString()
    });
    if(milestoneErr) throw milestoneErr;

    cacheLocal();
    setSyncStatus("Saved · Supabase","ok");
  }catch(err){
    console.error(err);
    setSyncStatus("Save failed","error");
    alert("Supabase save failed. Your browser copy is still preserved locally.");
  }finally{
    saveInFlight=false;
  }
}

function save(){
  cacheLocal();
  renderAll();
  if(isAdmin) syncRemoteState();
}

function downloadCampaignBackup(filename="fs25-hardcore-farm-data.json"){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

document.getElementById("export-btn").addEventListener("click",()=>{
  downloadCampaignBackup();
});

document.getElementById("reset-campaign-btn").addEventListener("click",()=>{
  const ok=confirm(
    "Reset the Moss Valley campaign?\n\n" +
    "This will clear cash/debt, tasks, fields, machinery, purchases, transactions, crop plans and progression. " +
    "The rules, players, map and mod reference list stay in the site.\n\n" +
    "A JSON backup will download automatically before anything is cleared."
  );
  if(!ok) return;

  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  downloadCampaignBackup(`fs25-campaign-backup-${stamp}.json`);

  state=clone(defaults);
  cacheLocal();
  renderAll();
  navTo("dashboard");
  if(isAdmin) syncRemoteState();
  alert("Campaign reset complete. Your previous campaign was exported as a JSON backup.");
});
document.getElementById("import-file").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  if(!isAdmin){ alert("Admin sign-in is required to import farm data."); e.target.value=""; return; }
  try{ const imported=JSON.parse(await file.text()); state=Object.assign(clone(defaults), imported); save(); alert("Farm data imported and queued for Supabase sync."); }
  catch(err){ alert("That file could not be imported."); }
  e.target.value="";
});


async function initialiseApp(){
  setAdminMode(false);
  await checkAdminSession();
  await loadRemoteState();

  db.auth.onAuthStateChange(async ()=>{
    await checkAdminSession();
    renderAll();
  });

  document.getElementById("refresh-data-btn").addEventListener("click",()=>loadRemoteState());

  const dialog=document.getElementById("admin-dialog");
  const msg=document.getElementById("admin-message");
  document.getElementById("admin-login-btn").addEventListener("click",async ()=>{
    if(isAdmin){
      await db.auth.signOut();
      setAdminMode(false);
      msg.textContent="";
      setSyncStatus("Public view","ok");
      return;
    }
    dialog.showModal();
  });
  document.getElementById("admin-dialog-close").addEventListener("click",()=>dialog.close());

  document.getElementById("admin-login-form").addEventListener("submit",async e=>{
    e.preventDefault();
    const form=new FormData(e.target);
    msg.textContent="Signing in…";
    const {data,error}=await db.auth.signInWithPassword({
      email:String(form.get("email")||"").trim(),
      password:String(form.get("password")||"")
    });
    if(error){
      msg.textContent=error.message;
      return;
    }
    const allowed=await checkAdminSession();
    if(!allowed){
      const uid=data.user?.id||"unknown";
      msg.textContent=`Signed in, but this account is not authorised as the farm admin. User ID: ${uid}`;
      return;
    }
    msg.textContent="Admin access enabled.";
    dialog.close();
    await loadRemoteState(false);
  });

  document.getElementById("migrate-local-btn").addEventListener("click",async ()=>{
    if(!isAdmin) return;
    const local=loadLocalBackup();
    if(!local){ alert("No browser campaign data was found."); return; }
    if(!confirm("Replace the Supabase farm state with the campaign currently stored in this browser?")) return;
    state=Object.assign(clone(defaults),local);
    renderAll();
    await syncRemoteState();
    alert("Browser campaign data has been pushed to Supabase.");
  });

  setInterval(()=>{
    if(!isAdmin && document.visibilityState==="visible") loadRemoteState(false);
  },60000);
}

initialiseApp();
