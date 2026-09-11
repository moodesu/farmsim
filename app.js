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
  milestones: {
    firstLand:false,
    ownTractor:false,
    ownField:false,
    firstHarvest:false
  }
};

function clone(x){ return JSON.parse(JSON.stringify(x)); }
let state = loadState();

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return clone(defaults);
    const parsed = JSON.parse(raw);
    return Object.assign(clone(defaults), parsed);
  }catch(e){
    return clone(defaults);
  }
}
function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); renderAll(); }
function money(v){ return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(v)||0); }
function esc(s=""){ return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

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
    machines:["Machinery","Fleet inventory and purchase wishlist."],
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
  renderMachines();
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
  e.preventDefault(); const d=Object.fromEntries(new FormData(e.target)); d.amount=Number(d.amount)||0; d.date=new Date().toLocaleDateString();
  state.transactions.push(d); state.finance.cash=Math.max(0,state.finance.cash+d.amount); e.target.reset(); save();
});

document.getElementById("export-btn").addEventListener("click",()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="fs25-hardcore-farm-data.json"; a.click(); URL.revokeObjectURL(url);
});
document.getElementById("import-file").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  try{ const imported=JSON.parse(await file.text()); state=Object.assign(clone(defaults), imported); save(); alert("Farm data imported."); }
  catch(err){ alert("That file could not be imported."); }
  e.target.value="";
});

renderAll();
