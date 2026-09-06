// shared-cycle.js — cycle + energy tracking shared by training-ledger and nutrition-ledger.
// Self-contained date helpers (no dependency on the host page) to avoid load-order issues.

const CYCLE_STORAGE_KEY = 'shared-cycle-v1';
let cycleState = null;

function cyclePad2(n){ return n < 10 ? '0' + n : '' + n; }
function cycleToISO(d){ return d.getFullYear() + '-' + cyclePad2(d.getMonth()+1) + '-' + cyclePad2(d.getDate()); }
function cycleTodayISO(){ return cycleToISO(new Date()); }
function cycleDaysBetween(fromIso, toIso){
  const a = fromIso.split('-').map(Number), b = toIso.split('-').map(Number);
  const d1 = new Date(a[0], a[1]-1, a[2]), d2 = new Date(b[0], b[1]-1, b[2]);
  return Math.round((d2 - d1) / 86400000);
}

function cycleDefaultState(){
  return { periodStarts: [], avgCycleLength: 28, avgPeriodLength: 5, energyLogs: {}, updatedAt: 0 };
}

function loadCycleState(){
  const local = localStorage.getItem(CYCLE_STORAGE_KEY);
  cycleState = local ? JSON.parse(local) : cycleDefaultState();
  if(!cycleState.energyLogs) cycleState.energyLogs = {};
  if(!cycleState.periodStarts) cycleState.periodStarts = [];
  if(!cycleState.avgCycleLength) cycleState.avgCycleLength = 28;
  if(!cycleState.avgPeriodLength) cycleState.avgPeriodLength = 5;
}

function saveCycleState(){
  cycleState.updatedAt = Date.now();
  localStorage.setItem(CYCLE_STORAGE_KEY, JSON.stringify(cycleState));
  pushCycleToFirebase();
}

function pushCycleToFirebase(){
  if(!window.firebaseCycleReady || !window.firebaseCycleUser) return;
  firebase.firestore().collection('shared-cycle').doc(window.firebaseCycleUser.uid)
    .set({ value: JSON.stringify(cycleState), updatedAt: cycleState.updatedAt })
    .catch(function(e){ console.error('Cycle Firebase sync failed (saved locally)', e); });
}

function syncCycleFromFirebase(onUpdate){
  if(!window.firebaseCycleReady || !window.firebaseCycleUser) return;
  firebase.firestore().collection('shared-cycle').doc(window.firebaseCycleUser.uid).get()
    .then(function(doc){
      if(!doc.exists){ pushCycleToFirebase(); return; }
      const remote = doc.data();
      const remoteUpdated = remote.updatedAt || 0;
      const localUpdated = cycleState.updatedAt || 0;
      if(remoteUpdated > localUpdated){
        cycleState = JSON.parse(remote.value);
        localStorage.setItem(CYCLE_STORAGE_KEY, remote.value);
        if(onUpdate) onUpdate();
      } else if(localUpdated > remoteUpdated){
        pushCycleToFirebase();
      }
    })
    .catch(function(e){ console.error('Cycle Firebase read failed (using local copy)', e); });
}

function initCycleFirebase(onReady){
  if(!window.firebase) return;
  try{
    firebase.auth().onAuthStateChanged(function(user){
      if(user){
        window.firebaseCycleUser = user;
        window.firebaseCycleReady = true;
        syncCycleFromFirebase(onReady);
      }
    });
  }catch(e){ console.error('Cycle firebase auth hook failed', e); }
}

function mostRecentPeriodStart(iso){
  const starts = cycleState.periodStarts.filter(function(d){ return d <= iso; }).sort();
  return starts.length ? starts[starts.length-1] : null;
}

// Simplified, non-diagnostic phase estimate based on average cycle/period length.
function cyclePhaseForDate(iso){
  const last = mostRecentPeriodStart(iso);
  if(!last) return null;
  const dayNum = cycleDaysBetween(last, iso) + 1;
  const cycleLen = cycleState.avgCycleLength;
  const periodLen = cycleState.avgPeriodLength;
  const effectiveDay = ((dayNum - 1) % cycleLen) + 1;
  const ovulationCenter = Math.round(cycleLen / 2) - 1;
  let phase;
  if(effectiveDay <= periodLen) phase = 'Menstrual';
  else if(effectiveDay < ovulationCenter - 1) phase = 'Follicular';
  else if(effectiveDay <= ovulationCenter + 1) phase = 'Ovulatory';
  else phase = 'Luteal';
  return { day: effectiveDay, phase: phase };
}

function logPeriodStart(iso){
  if(!cycleState.periodStarts.includes(iso)){
    cycleState.periodStarts.push(iso);
    cycleState.periodStarts.sort();
    saveCycleState();
  }
}

function removePeriodStart(iso){
  cycleState.periodStarts = cycleState.periodStarts.filter(function(d){ return d !== iso; });
  saveCycleState();
}

function logEnergy(iso, rating, type, notes){
  cycleState.energyLogs[iso] = { rating: rating, type: type, notes: notes || '' };
  saveCycleState();
}

loadCycleState();
