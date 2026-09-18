/* eslint-disable */
// Engine lifted verbatim from namjapcounterFINAL.html, IIFE wrapper swapped
// for a named export so React can run it after the markup is mounted.
//
// The pure parts have since moved out to src/lib/counter/, where they can be
// tested without a browser: storage layout, backup merge and the sync outbox.
// This file is still the DOM and the wiring.
import * as Storage from "@/lib/counter/storage";
import * as Backup from "@/lib/counter/backup";
import * as Outbox from "@/lib/counter/outbox";
import { dayKey } from "@/lib/counter/day";
import { summarise } from "@/lib/counter/streak";
import { stageSize } from "./counter-size";
import * as Combine from "@/lib/counter/combine";
import { browserAccessToken, browserSession, createSyncClient, hasSessionCookie } from "@/lib/counter/sync-client";
import * as AccountLink from "@/lib/counter/account-link";
import * as Names from "@/lib/counter/names";
import { writePremiumFlag } from "@/lib/premium-flag";

export default function initNamJapCounter() {
"use strict";
/* ==========================================================================
   NAM JAP COUNTER — engine
   count / target / rounds / session, modes (up, countdown, timer, auto),
   day rollover, streak, history, backup. Everything in localStorage.
   ========================================================================== */
var R = document.getElementById('njc');
/* The page's own language, put back when the counter leaves. */
var pageLang = document.documentElement.lang || 'en';
function $(s){ return R.querySelector(s); }
function $$(s){ return Array.prototype.slice.call(R.querySelectorAll(s)); }

/* ---------- teardown ----------
   Listeners inside #njc die with the subtree when React unmounts it. The ones on
   window and document do not, and neither do intervals, the BroadcastChannel, or
   the wake lock.

   Without this, navigating away and back leaves the old engine running beside
   the new one: two sets of intervals writing to the same storage, and — since
   Phase 2 — two elections. The old one keeps heartbeating, so the new counter
   decides another tab owns the count and refuses to accept a tap. The widget
   goes quietly dead on the second visit.

   Every global listener and timer is registered through these. */
var teardowns = [];

function on(target, type, fn, opts){
  target.addEventListener(type, fn, opts);
  teardowns.push(function(){ target.removeEventListener(type, fn, opts); });
}

function every(fn, ms){
  var id = setInterval(fn, ms);
  teardowns.push(function(){ clearInterval(id); });
  return id;
}
var MAX = 9999999;

/* ---------- library ---------- */
/* The built-in names and their Hindi meanings live in src/lib/counter/names.ts,
   so the pages that read this history can show a name instead of its id. */
/* library(), not NAMES: the page inlines the database's copy as
   window.__njcNames before this runs, so a name added in the admin panel appears
   without a deploy. It returns the bundled list when there is no injected one —
   which is what keeps the counter working with no network at all. */
var NAMES = Names.library();
var QUICK = ['radha','shiv','mahadev','hanuman','shriram'];
var MEANING_HI = Names.MEANING_HI;
var TARGETS = [11,21,27,54,108,216,324,540,1008];
var ROUNDS  = [1,3,5,7,11,0];

/* ---------- i18n ---------- */
var L = {
 en:{title:'Nam Jap Counter',sub:'नाम जप · माला',round:'Round',today:'Today',streak:'Streak',

  customLeft:'{n} of {max} letters',
  notSaving:'This browser is not saving your jap — a reload would lose it. Use a normal (not private) window, or download a backup now.',
  full:'Full screen',fullS:'Full',exit:'Exit',exitS:'Exit',undo:'Undo',
  target:'Target',reset:'Reset',more:'More',mUp:'Count up',mDown:'Countdown',mTimer:'Timer',mAuto:'Auto',mHaptic:'Haptic',
  practice:'Your practice',mala:'Mala',lifetime:'Lifetime',last7:'Last 7 days',best:'Best day',
  active:'Active days',ttime:'Time on the mala',pace:'Pace',history:'History',library:'Library',allNames:'All names',
  chooseName:'Choose a name',ownName:'Your own name or mantra',add:'Add',setTarget:'Set a target',set:'Set',
  rounds:'Rounds of the mala',roundsS:'Stop and celebrate after this many malas. ∞ keeps going.',noTarget:'No target, count freely',resetT:'Reset',
  rUndoT:'Undo last count',rUndoS:'Steps back by one. Nothing else changes.',
  rCountT:'Reset the counter',rCountS:'Back to zero. Today and history are kept; this session\'s malas are not added.',
  rSessT:'Finish the session',rSessS:'Banks the mala and starts fresh at zero.',
  rTodayT:'Clear today',rTodayS:"Removes today's count from your record.",
  rAll:'Erase everything',rNote:'These change only this device.',
  settings:'Settings',theme:'Theme',numerals:'Numerals',lang:'Language',feedback:'While counting',
  addOwn:'+ Your own',renameL:'Rename this name',renamePrompt:'Rename your mantra',
  thPrabhat:'Prabhat',thRatri:'Ratri',thKashi:'Kashi',thTulsi:'Tulsi',
  vibT:'Haptic',vibS:'A short pulse on every count.',
  bubT:'Name bubbles',bubS:'The name rises from the ring as you count.',
  bdT:'Bead ring',bdS:'Draw the mala beads around the arc.',
  awT:'Keep the screen awake',awS:'The screen stays on while you count.',
  auto:'Auto count',timerLen:'Timer length',yourData:'Your data',backup:'Back up',restore:'Restore',
  dataNote:'Saved automatically in this browser. With Premium it is also synced to your account.',
  mileT:'Target reached',mileS:'Your count is saved. Continue this mala, or Finish to bank it and start again at zero.',
  cont:'Continue',newRound:'New mala',finish:'Finish',roundDone:'Mala complete',timeUp:'Time complete',
  timeDone:'Time complete · {min} min · {chants} chants',
  noHist:'Nothing recorded yet.',total:'Total',names:'Names',mantras:'Mantra jap',yours:'Your names',viewAll:'View all',showLess:'Show less',freeCount:'Free count',of:'of',r:'Mala',
  favL:'Favourite',searchPh:'Search name, mantra or meaning',customPh:'Write your own mantra',targetPh:'Custom target',badFile:'That file could not be read',
  imported:'Restored. {added} new days added, {raised} updated. Nothing was removed.',
  nudge:'Your jap lives only in this browser. Keep a backup file somewhere safe.',dismiss:'Dismiss',
  nudgeSafari:'Safari can delete this site\'s saved jap if you do not visit for a week. Save a backup file, or add this page to your Home Screen to keep it.',
  importAsk:'This file adds {chants} chants to your practice (days changed: {days}). Counts only go up, so this cannot be undone.',importYes:'Add them',importNone:'This file has nothing new to add.',fileTooBig:'That file is too large to be a Nam Jap backup',
  stashAsk:'This device has {chants} chants from before you signed in. They are kept on this device, not in your account.',stashAdd:'Add to my account',stashAdded:'Added to your account.',stashFail:'Could not add them just now. Check your internet connection and try again.',
  syncedNoReset:'Today\'s counts are already saved to your account and cannot be erased here',
  syncedNoResetAll:'Your history is saved to your account. To erase it, write to us to delete the account',
  pickName:'Select a name',tapC:'Tap to count',pickNameSub:'Choose a name to begin',pickHint:'Tap the ring to choose a name',
  close:'Close',confirmToday:'Tap again to clear today',confirmAll:'Tap again to erase everything',
  targetBad:'Enter a whole number from 1 to {max}',noMatch:'No names match. Add it below as your own.',
  remove:'Remove?',removeL:'Remove this name',pageSub:'Spiritual Name Chanting Counter',minU:'m',hourU:'h'},
 hi:{title:'नाम जप काउंटर',sub:'नाम जप · माला',round:'माला',today:'आज',streak:'निरंतरता',

  customLeft:'{max} में से {n} अक्षर',
  notSaving:'यह ब्राउज़र आपका जप सहेज नहीं रहा — रीलोड करने पर खो जाएगा। सामान्य (प्राइवेट नहीं) विंडो खोलें, या अभी बैकअप डाउनलोड करें।',
  full:'पूर्ण स्क्रीन',fullS:'पूर्ण',exit:'बाहर',exitS:'बाहर',undo:'वापस',
  target:'लक्ष्य',reset:'रीसेट',more:'अधिक',mUp:'गिनती',mDown:'उल्टी गिनती',mTimer:'समय',mAuto:'स्वतः',mHaptic:'कंपन',
  practice:'आपकी साधना',mala:'माला',lifetime:'कुल जप',last7:'पिछले 7 दिन',best:'सर्वश्रेष्ठ दिन',
  active:'सक्रिय दिन',ttime:'माला का समय',pace:'गति',history:'इतिहास',library:'नाम सूची',allNames:'सभी नाम',
  chooseName:'नाम चुनें',ownName:'अपना नाम या मंत्र',add:'जोड़ें',setTarget:'लक्ष्य तय करें',set:'तय करें',
  rounds:'माला संख्या',roundsS:'इतनी मालाओं के बाद रुककर उत्सव। ∞ पर जप चलता रहता है।',noTarget:'बिना लक्ष्य, मुक्त जप',resetT:'रीसेट',
  rUndoT:'आख़िरी जप वापस',rUndoS:'एक कदम पीछे। और कुछ नहीं बदलेगा।',
  rCountT:'काउंटर शून्य करें',rCountS:'शून्य से शुरू। आज और इतिहास सुरक्षित रहेंगे; इस सत्र की मालाएँ कुल में नहीं जुड़ेंगी।',
  rSessT:'सत्र पूर्ण करें',rSessS:'माला दर्ज होकर शून्य से नया आरम्भ।',
  rTodayT:'आज का रिकॉर्ड हटाएँ',rTodayS:'आज की गिनती रिकॉर्ड से हट जाएगी।',
  rAll:'सब कुछ मिटाएँ',rNote:'ये केवल इसी डिवाइस पर असर करते हैं।',
  settings:'सेटिंग',theme:'थीम',numerals:'अंक',lang:'भाषा',feedback:'जप के समय',
  addOwn:'+ अपना',renameL:'यह नाम बदलें',renamePrompt:'अपने मंत्र का नाम बदलें',
  thPrabhat:'प्रभात',thRatri:'रात्रि',thKashi:'काशी',thTulsi:'तुलसी',
  vibT:'कंपन',vibS:'हर जप पर हल्का कंपन।',
  bubT:'नाम बुलबुला',bubS:'जप पर नाम ऊपर उठता है।',
  bdT:'माला मणि',bdS:'वृत्त के चारों ओर मनके दिखाएँ।',
  awT:'स्क्रीन चालू रखें',awS:'जप के दौरान स्क्रीन बंद न हो।',
  auto:'स्वतः जप',timerLen:'समय अवधि',yourData:'आपका डेटा',backup:'बैकअप',restore:'पुनर्स्थापित',
  dataNote:'आपके ब्राउज़र में अपने आप सुरक्षित। प्रीमियम के साथ आपके खाते में भी सिंक होता है।',
  mileT:'लक्ष्य पूर्ण',mileS:'आपकी गिनती सुरक्षित है। यही माला जारी रखें, या समाप्त करके दर्ज करें और शून्य से शुरू करें।',
  cont:'जारी रखें',newRound:'नई माला',finish:'समाप्त',roundDone:'माला पूर्ण',timeUp:'समय पूर्ण',
  timeDone:'समय पूर्ण · {min} मिनट · {chants} जप',
  noHist:'अभी कोई रिकॉर्ड नहीं।',total:'कुल',names:'नाम',mantras:'मंत्र जप',yours:'आपके नाम',viewAll:'सब देखें',showLess:'कम दिखाएँ',freeCount:'मुक्त जप',of:'में से',r:'माला',
  favL:'पसंदीदा',searchPh:'नाम, मंत्र या अर्थ खोजें',customPh:'अपना मंत्र लिखें',targetPh:'अपना लक्ष्य',badFile:'यह फ़ाइल पढ़ी नहीं जा सकी',
  imported:'पुनर्स्थापित। {added} नए दिन जुड़े, {raised} अपडेट हुए। कुछ भी नहीं हटाया गया।',
  nudge:'आपका जप केवल इसी ब्राउज़र में है। बैकअप फ़ाइल सुरक्षित रखें।',dismiss:'बंद करें',
  nudgeSafari:'एक सप्ताह न आने पर Safari इस साइट का सहेजा जप मिटा सकता है। बैकअप फ़ाइल सहेजें, या इस पेज को होम स्क्रीन पर जोड़ें।',
  importAsk:'यह फ़ाइल आपकी साधना में {chants} जप जोड़ेगी (बदले दिन: {days})। गिनती केवल बढ़ती है, इसे वापस नहीं लिया जा सकता।',importYes:'जोड़ें',importNone:'इस फ़ाइल में जोड़ने को कुछ नया नहीं है।',fileTooBig:'यह फ़ाइल नाम जप बैकअप होने के लिए बहुत बड़ी है',
  stashAsk:'इस डिवाइस पर साइन इन से पहले के {chants} जप हैं। वे इसी डिवाइस पर रखे हैं, आपके खाते में नहीं।',stashAdd:'खाते में जोड़ें',stashAdded:'आपके खाते में जोड़ दिए गए।',stashFail:'अभी नहीं जुड़ सके। इंटरनेट देखकर फिर कोशिश करें।',
  syncedNoReset:'आज की गिनती आपके खाते में सहेजी जा चुकी है, यहाँ से मिटाई नहीं जा सकती',
  syncedNoResetAll:'आपका इतिहास आपके खाते में सहेजा गया है। मिटाने के लिए खाता हटाने हेतु हमें लिखें',
  pickName:'नाम चुनें',tapC:'गिनने के लिए टैप करें',pickNameSub:'शुरू करने के लिए नाम चुनें',pickHint:'नाम चुनने के लिए वृत्त पर टैप करें',
  close:'बंद करें',confirmToday:'पुष्टि के लिए फिर टैप करें — आज का रिकॉर्ड हटेगा',confirmAll:'पुष्टि के लिए फिर टैप करें — सब कुछ मिटेगा',
  targetBad:'1 से {max} तक पूरी संख्या लिखें',noMatch:'कोई नाम नहीं मिला। नीचे अपना नाम जोड़ें।',
  remove:'हटाएँ?',removeL:'यह नाम हटाएँ',pageSub:'आध्यात्मिक नाम जप काउंटर',minU:' मि',hourU:' घं'}
};
function t(k){ var d = L[S.lang] || L.en; return d[k] !== undefined ? d[k] : (L.en[k] !== undefined ? L.en[k] : k); }

/* ---------- state ---------- */
/* One definition of what a day is, shared with every page that reads this
   history — see src/lib/counter/day.ts and docs/SPEC.md 1. Two copies of a
   rule this central is how a streak page and a counter start disagreeing. */
function todayKey(){ return dayKey(); }
function keyOf(d){ return dayKey(d); }
var BLANK = {
  // A brand new visitor starts on the first name, so the counter is ready to
  // tap and looks the same before and after it boots (2026-09-15, Rajan).
  v:1, nameId:'radha', custom:[], favs:[],
  lastBackup:null, importedBackups:[], nudgedOn:null,
  count:0, target:108, rounds:null, malaDone:0, lifetime:0,
  mode:'up', autoMs:1500, timerSec:300,
  hist:{}, lastDay:todayKey(),
  theme:'prabhat', numerals:'latin', lang:'en',
  vibration:false, bubbles:true, beads:true, awake:false
};
var S = {};
for (var k0 in BLANK) S[k0] = BLANK[k0];
var undoStack = [];

/* Storage lives in src/lib/counter/storage.ts. The state object S is unchanged;
   only where it is written has moved. A tap now rewrites a fraction of a
   kilobyte instead of the user's entire history — see that file's header. */
var store = Storage.localStore();
var sourceId = '';
var outbox = {};
var watermark = {};
var coldDirty = false;
/* Other devices' counts, cached from the server (src/lib/counter/combine.ts).
   S.hist stays this installation's own record and is the only thing uploaded;
   everything shown reads the combined view. */
var others = Combine.emptyOthers();
var hasOthers = false;
var sync = null;

function adopt(o){
  /* null is a real choice for two keys: rounds (no limit) and target ("No target,
     count freely"). Replacing a stored null target with BLANK's 108 is how free
     count came back as "Target 108" after every reload. */
  for(var k in BLANK){
    var keepNull = k === 'rounds' || (k === 'target' && o[k] === null);
    S[k] = (o[k] !== undefined && o[k] !== null) || keepNull ? o[k] : BLANK[k];
  }
  if(o.rounds === undefined) S.rounds = BLANK.rounds;
}

function load(){
  var r = Storage.load(store);
  sourceId = r.sourceId;
  outbox = Outbox.readOutbox(r.outbox);
  watermark = Outbox.readWatermark(r.watermark);
  if(!r.fresh) adopt(r.state);
  /* Sync bookkeeping is kept out of BLANK, because BLANK is what a backup may
     carry — so adopt() skips it and it is picked up here. */
  var st = r.fresh ? {} : r.state;
  S.syncFrom = typeof st.syncFrom === 'string' ? st.syncFrom : undefined;
  S.historyUploaded = st.historyUploaded === true;
  /* The account whose practice this device holds (src/lib/counter/account-link.ts). */
  S.owner = typeof st.owner === 'string' ? st.owner : undefined;
  setOthers(Combine.readOthers(st.others));
  /* A migration from the single-key format has not been written in the new
     shape yet, and the old key is only ever read once. Flush both halves now so
     a crash before the next idle tick cannot lose the whole history. */
  if(r.migrated) coldDirty = true;
  if(!S.hist || typeof S.hist !== 'object') S.hist = {};
  if(!S.custom) S.custom = [];
  if(!S.favs) S.favs = [];
  S.lastDay = todayKey();
  if(r.migrated) saveCold();
}

function setOthers(o){
  others = o;
  S.others = o;
  hasOthers = Object.keys(o.devices).length > 0 || Object.keys(o.history).length > 0;
}

/* This device plus every other one. A free counter has no others, and gets its
   own history back untouched — no copy made on every tap. */
function viewHist(){ return hasOthers ? Combine.combinedHistory(S.hist, others) : S.hist; }

/* Every open tab counts, into one total. Each tab holds its own copy of S and
   writes the whole of it, so a tab that wrote a stale copy would erase another
   tab's taps. Two rules prevent that: every save stamps the store (njc.rev), and
   before this tab changes anything it takes in whatever another tab saved since
   it last looked (adoptIfChanged). This replaced an election in which one tab
   counted and any other only watched. */
var lastRev = null;
function stamp(){ lastRev = Storage.touchRev(store); }

function saveCold(){
  Storage.saveCold(store, S, { sourceId: sourceId });
  coldDirty = false;
  stamp();
}

/* Hot only. Used where the change is definitely inside the hot set and happens
   often enough that the cost matters: counting, undo, and the time ticker. */
function saveTap(){
  Storage.saveHot(store, S, { sourceId: sourceId, outbox: outbox, watermark: watermark });
  hotSaved = hotSignature();
  stamp();
}

/* What this tab would write, short enough to compare on every tap.
 *
 * Only used to skip a write that would change nothing. A tab closing flushes the
 * hot half in case it holds unsaved taps; when it holds none, that write is pure
 * risk — in WebKit the two tabs are separate processes and localStorage reaches
 * the backing store asynchronously, so a closing tab's copy of the total can land
 * AFTER a tap made in the other tab and undo it. Seen on the iPad project on
 * 2026-09-12: the ring read 8, the stored blob read 7. */
function hotSignature(){
  /* Today's record too: tickTime() adds time on the mala to it, and that is
     unsaved work a closing tab must still flush. */
  return [S.count, S.lifetime, S.malaDone, S.lastDay, S.nameId,
          JSON.stringify((S.hist || {})[todayKey()] || null),
          JSON.stringify(outbox)].join('|');
}
var hotSaved = null;

/* Flush before this tab goes away — but only if it actually holds something the
   store does not. */
function saveTapIfUnsaved(){
  if(hotSignature() !== hotSaved) saveTap();
}

/* Everything else. Marking the cold half dirty is the default on purpose: there
   are thirty-odd call sites, and getting one of them wrong the other way round
   would silently stop persisting a setting. This way the worst case is a flush
   that was not needed. */
function save(){
  coldDirty = true;
  saveTap();
  /* Written straight away rather than on the 20-second flush. Settings change
     rarely, so the cost is nothing, and every other open tab sees it at once. */
  flushCold();
}

function flushCold(){ if(coldDirty) saveCold(); }

/* What a round is when the user has not set a target — see count(). */
var ROUND_FALLBACK = 108;

/* Take in what another tab saved, if anything. Cheap when nothing changed: one
   short key is compared. Called before every change this tab makes and whenever
   the storage event says another tab wrote.

   It re-renders but does not re-boot, so an Auto count or a timer running in
   this tab carries on. This tab's undo history is dropped when the count moved
   underneath it: stepping back through it now would also take back the other
   tab's taps. */
function adoptIfChanged(){
  var rev = Storage.readRev(store);
  if(rev === lastRev) return false;
  lastRev = rev;
  var before = S.count;
  load();
  if(S.count !== before) undoStack = [];
  R.setAttribute('data-theme', S.theme || 'prabhat');
  beadsBuilt = 0;
  applyLang();
  syncMore();
  return true;
}

/* Record what this installation owes the server for today and the current name.
   Nothing sends it yet; Phase 8 does.

   Today the day's total and this installation's own contribution are the same
   number, because nothing else can contribute. Once sync lands they diverge —
   another device's component arrives and the displayed total rises without this
   installation having counted anything — and at that point the engine has to
   track `mine` separately from the total. That is the whole point of
   docs/ARCHITECTURE.md §1, and this line is where the difference will show up. */
function markOutbox(){
  /* The per-name component, not the day's total.
     Marking the total under whichever name happened to be selected meant that
     switching name mid-day marked the same number under two names, and the
     server sums components — so a day would have counted twice. */
  /* No name, nothing owed. The server refuses an empty name id, and one bad entry
     fails the whole request. Nor is a zero worth sending for a name merely
     selected — unless it lowers an entry an undo took back. */
  if(!S.nameId) return;
  var rec = nameRec();
  if(!rec.c && !rec.r && !rec.s && !outbox[Outbox.keyOf(todayKey(), S.nameId)]) return;
  outbox = Outbox.mark(outbox, todayKey(), S.nameId, { c: rec.c, r: rec.r, s: rec.s });
}
function dayRec(k){ k = k || todayKey(); if(!S.hist[k]) S.hist[k] = {c:0,r:0,s:0}; return S.hist[k]; }

/* The same three numbers again, split by the name being chanted.

   Days recorded before this existed have no breakdown at all, and stats says so
   rather than guessing. Today's is different: if the day already has a total and
   the breakdown is only starting now, that total is seeded onto the current name
   — it is where those taps almost certainly came from, and it keeps the
   invariant that the parts add up to the whole. */
function nameRec(k, id){
  k = k || todayKey();
  id = id || S.nameId || '';
  var day = dayRec(k);
  if(!day.n){
    day.n = {};
    if(day.c || day.r || day.s) day.n[id] = { c: day.c, r: day.r || 0, s: day.s || 0 };
  }
  if(!day.n[id]) day.n[id] = { c: 0, r: 0, s: 0 };
  return day.n[id];
}

/* ---------- numerals ---------- */
var DEV = '०१२३४५६७८९';
function fmt(n){
  var s = Math.round(Number(n) || 0).toLocaleString('en-IN');
  return S.numerals === 'deva' ? s.replace(/[0-9]/g, function(d){ return DEV.charAt(+d); }) : s;
}

/* ---------- names ---------- */
function allNames(){ return NAMES.concat(S.custom || []); }
function current(){
  if(!S.nameId) return null;                 // nothing chosen yet
  var a = allNames();
  for(var i=0;i<a.length;i++) if(a[i].id === S.nameId) return a[i];
  return NAMES[0];
}

/* ---------- view model ---------- */
function view(){
  /* Countdown needs a number to count down from. With no target it counted up
     under a pressed "Countdown" chip; it now counts down each mala of 108. */
  var c = S.count, tg = S.target || (S.mode === 'down' ? ROUND_FALLBACK : null), out = {};
  if(tg){
    var inRound = c % tg;
    var shown = (inRound === 0 && c > 0) ? tg : inRound;
    var roundNo = (inRound === 0 && c > 0) ? c/tg : Math.floor(c/tg) + 1;
    out.roundNo = roundNo;
    out.progress = (shown / tg) * 100;
    out.display = fmt(S.mode === 'down' ? (tg - shown) : shown);
    out.targetLine = S.mode === 'down'
      ? fmt(shown) + ' ' + t('of') + ' ' + fmt(tg)
      : t('of') + ' ' + fmt(tg);
    out.roundLine = t('r') + ' ' + fmt(roundNo) + (S.rounds && roundNo <= S.rounds ? ' / ' + fmt(S.rounds) : '');
  }else{
    out.progress = (c % 108) / 108 * 100;
    out.display = fmt(Math.min(c, MAX));
    out.targetLine = t('freeCount');
    out.roundLine = null;
  }
  return out;
}

/* ---------- stage geometry ---------- */
var CX=50, CY=50, R_OUT=45, CIRC = 2*Math.PI*39.4;
/* One bead per count up to a mala of 60. Above that the ring keeps about 54
   beads, each standing for an even share of the target (108 -> 54 beads of 2),
   so the number printed in a lit bead is always the count it has reached. */
function beadCount(){
  var tg = S.target || 108;
  if(tg <= 60) return Math.max(tg, 1);
  return tg % 56 === 0 ? 56 : tg % 50 === 0 ? 50 : 54;
}
var beadsBuilt = 0, beadsFor = '', beadsOn = -1, beadR = 2;
function beadAt(i, n){
  var a = -Math.PI/2 + ((i + 0.5)*Math.PI*2)/n;
  return [(CX + R_OUT*Math.cos(a)).toFixed(2), (CY + R_OUT*Math.sin(a)).toFixed(2)];
}
function drawBeads(p){
  var g = $('#njcBeads');
  if(!S.beads){ if(g.childNodes.length){ g.innerHTML=''; beadsBuilt=0; } return; }
  var n = beadCount(), tg = S.target || 108, key = tg + S.numerals, i;
  if(beadsBuilt !== n || beadsFor !== key){
    // Beads nearly touch, as on a real mala, but never overlap. One halo marks
    // the bead just reached; it is moved, not drawn 54 times.
    beadR = Math.min(2.25, (Math.PI*R_OUT/n) * 0.86);
    var html = '<circle class="njc-bead-halo" r="' + (beadR*1.75).toFixed(2) + '"/>';
    for(i=0;i<n;i++){
      var xy = beadAt(i, n), label = String(i === n-1 ? tg : Math.round((i+1)*tg/n));
      html += '<g class="njc-bead"><circle class="njc-bead-dot" cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + beadR.toFixed(2) +
        '"/><text class="njc-bead-num" x="' + xy[0] + '" y="' + xy[1] + '" font-size="' +
        (beadR * (label.length <= 2 ? 0.98 : label.length === 3 ? 0.76 : 0.6)).toFixed(2) + '">' + digitsFor(label) + '</text></g>';
    }
    g.innerHTML = html;
    beadsBuilt = n; beadsFor = key; beadsOn = -1;
  }
  var on = Math.min(n, Math.ceil((p/100) * n - 1e-6));
  if(on === beadsOn) return;
  /* Only the beads whose state changed are touched: re-classing all 54 every
     tap re-styled the whole ring and cost a frame on a phone. */
  var lo = beadsOn < 0 ? 0 : Math.min(on, beadsOn), hi = beadsOn < 0 ? n : Math.max(on, beadsOn);
  for(i=lo;i<hi;i++) g.childNodes[i+1].setAttribute('class', i < on ? 'njc-bead on' : 'njc-bead');
  var halo = g.firstChild;
  if(on > 0){ var h = beadAt(on - 1, n); halo.setAttribute('cx', h[0]); halo.setAttribute('cy', h[1]); }
  halo.style.display = on > 0 ? 'inline' : '';
  beadsOn = on;
}

/* ---------- render ---------- */
var lastDisplay = null, rollAnim = null;
function setLine(sel, val){
  var el = $(sel);
  if(el.hidden !== !val) el.hidden = !val;
  if(val) setText(sel, val);
}
/* Every tap re-renders. Writing an unchanged string still dirties layout, and
   with the ring's text inside a container query that was a full re-layout per
   tap, so a value is written only when it differs. */
function setText(sel, val){
  var el = $(sel); val = String(val);
  if(el.textContent !== val) el.textContent = val;
}
var htmlCache = {};
function setHTML(sel, html){
  if(htmlCache[sel] === html) return;
  htmlCache[sel] = html;
  $(sel).innerHTML = html;
}
function mmss(s){ var m = Math.floor(s/60), x = s%60; return String(m).padStart(2,'0')+':'+String(x).padStart(2,'0'); }
function digitsFor(s){ return S.numerals === 'deva' ? String(s).replace(/[0-9]/g, function(d){ return DEV.charAt(+d); }) : String(s); }
function hm(ms){ var m = Math.round(ms/60000); return m < 60 ? digitsFor(m) + t('minU') : digitsFor((m/60).toFixed(1)) + t('hourU'); }

function render(){
  var v = view(), d = dayRec(), nm = current();

  var dg = $('#njcDigits');
  if(v.display !== lastDisplay){
    /* Restarting a CSS animation needed a forced layout (offsetWidth) on every
       tap. A Web Animation restarts without one. */
    var first = lastDisplay === null;
    lastDisplay = v.display;
    dg.textContent = v.display;
    var dl = String(Math.max(1, v.display.length));
    if(dg.style.getPropertyValue('--digits') !== dl) dg.style.setProperty('--digits', dl);
    if(!first && dg.animate && !reducedMotion()){
      if(rollAnim) rollAnim.cancel();
      rollAnim = dg.animate([{ opacity:0, transform:'translate3d(0,.42em,0)' }, { opacity:1, transform:'none' }],
        { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }

  var p = Math.max(0, Math.min(100, v.progress));
  /* The beads carry the progress. With the bead ring switched off in Settings,
     the arc on the track shows it instead. */
  R.classList.toggle('njc-nobeads', !S.beads);
  if(!S.beads) $('#njcArc').setAttribute('stroke-dashoffset', (CIRC*(1 - p/100)).toFixed(2));
  drawBeads(p);

  setLine('#njcTargetLine', v.targetLine);
  setLine('#njcRoundLine', v.roundLine);
  setLine('#njcTimerLine', timerLeft !== null ? mmss(timerLeft) : null);

  // A custom mantra has no separate transliteration, so its name would print
  // twice — once in Devanagari and once identically beneath. Two identical
  // lines read as a rendering bug, so show the meaning alone instead.
  if(!nm){
    // Nothing chosen yet. The ring, the select bar and the hint all ask for a
    // name rather than counting under a default the reader never picked.
    // #10: "Select a name" used to appear three times, plus a fourth hint. The
    // highlighted bar asks once; the line under the ring says what to do.
    setText('#njcPhrase', t('pickHint'));
    setText('#njcPhraseSub', '');
    setText('#njcPhraseMean', '');
    setText('#njcFsDev', t('pickName'));
    setText('#njcSbTitle', t('pickName'));
    setText('#njcSbSub', t('pickNameSub'));
    setText('#njcSbDev', '');
  }else{
    var same = nm.t === nm.n;
    setText('#njcPhrase', nm.n);
    var mean = meaning(nm);
    // Inside the ring: the name, its transliteration, then the meaning.
    setText('#njcPhraseSub', same ? mean : nm.t);
    setText('#njcPhraseMean', same ? '' : mean);
    setText('#njcFsDev', nm.n);
    setText('#njcSbTitle', same ? nm.n : nm.t);
    setText('#njcSbSub', mean);
    setText('#njcSbDev', same ? '' : nm.n);
  }
  R.classList.toggle('njc-noname', !nm);
  /* A long name gets a smaller, two-line setting so it stays inside the ring. */
  var nl = nm ? nm.n.length : 0;
  R.setAttribute('data-long', nl > 22 ? 2 : nl > 12 ? 1 : 0);

  // The same round number the ring shows. floor(count/target)+1 reads "2" at
  // exactly one full mala, while the ring correctly still says "Mala 1".
  setText('#njcToday', fmt(d.c));

  $('#njcUndo').disabled = undoStack.length === 0;

  setText('#njcTargetLblLg', S.target ? t('target') + ' ' + fmt(S.target) : t('target'));
  setText('#njcTargetLblSm', S.target ? fmt(S.target) : t('target'));

  renderPractice();
}

/* The same rule as the Streak page and the header chip (docs/SPEC.md §3): a day
   counts once its own target was completed. Counting any day with a single tap
   made this panel say "1d" while the Streak page said 0. */
function streak(H){
  return summarise(H || viewHist(), todayKey()).current;
}

var HIST_SHORT = 3, histOpen = false;
function renderPractice(){
  var H = viewHist(), d = H[todayKey()] || {c:0,r:0,s:0}, keys = [], k;
  for(k in H) if(H[k] && H[k].c > 0) keys.push(k);
  keys.sort();
  var best = 0, tsec = 0, extra = 0;
  for(var i=0;i<keys.length;i++){
    if(H[keys[i]].c > best) best = H[keys[i]].c;
    tsec += H[keys[i]].s || 0;
  }
  /* Lifetime is this device's own running total plus what the others added. */
  if(hasOthers) for(k in H) extra += (H[k].c || 0) - ((S.hist[k] && S.hist[k].c) || 0);
  setText('#njcPToday', fmt(d.c));
  /* B05: free count completes a mala every 108 too (count() records it). */
  setText('#njcPMala', fmt(S.malaDone + Math.floor(S.count/(S.target || ROUND_FALLBACK))));
  // #18: "0" here but "—" in the row above for the same thing. One symbol.
  var stP = streak(H);
  setText('#njcPStreak', stP > 0 ? fmt(stP) : '—');
  setText('#njcPTotal', fmt(S.lifetime + Math.max(0, extra)));
  /* The row above the ring: today's count, malas and the lifetime total (2026-09-13). */
  setText('#njcHMala', $('#njcPMala').textContent);
  setText('#njcHTotal', $('#njcPTotal').textContent);
  /* B67: a crore and more does not fit a third of a 320px phone at full size. */
  ['#njcToday','#njcHMala','#njcHTotal','#njcPToday','#njcPMala','#njcPTotal'].forEach(function(id){
    var el = $(id), n = el.textContent.length;
    if(n >= 9) el.setAttribute('data-long', n >= 11 ? '2' : '1'); else el.removeAttribute('data-long');
  });
  setText('#njcBest', fmt(best));
  setText('#njcActive', fmt(keys.length));
  setText('#njcTime', hm(tsec));
  // Needs a full minute of actual sitting before a rate means anything —
  // under that, a burst of taps reported absurd figures like 493/min.
  var mins = (d.s || 0) / 60000;
  setText('#njcPace', mins >= 1 ? fmt(Math.round(d.c/mins)) + ' /min' : '—');

  var arr = [], loc = S.lang === 'hi' ? 'hi-IN' : 'en-GB';
  for(var j=6;j>=0;j--){
    var dt = new Date(); dt.setDate(dt.getDate() - j);
    var kk = keyOf(dt);
    arr.push({ c:(H[kk] && H[kk].c) || 0,
               // #35: three letters, as on the Streak and Stats pages ("Mon", not "Mo").
               /* B72: slicing cut Devanagari mid-letter (गुर, शुक); Hindi short names are already short. */
               l: S.lang === 'hi' ? dt.toLocaleDateString(loc, {weekday:'short'}) : dt.toLocaleDateString(loc, {weekday:'short'}).slice(0,3),
               now: kk === todayKey() });
  }
  var mx = 1;
  for(var a=0;a<arr.length;a++) if(arr[a].c > mx) mx = arr[a].c;
  setHTML('#njcChart', arr.map(function(x){
    return '<div class="njc-cc' + (x.now ? ' today' : '') + '"><em>' + (x.c ? fmt(x.c) : '') + '</em>' +
      '<div class="njc-cb" style="height:' + Math.max(x.c/mx*100, 3) + '%"></div><small>' + esc(x.l) + '</small></div>';
  }).join(''));

  /* B16: "View all" means all; the short list is cut below. */
  var last = keys.slice().reverse();
  /* Three days, then "View all" — the full list pushed the panel far down the page. */
  var more = last.length > HIST_SHORT;
  if(more && !histOpen) last = last.slice(0, HIST_SHORT);
  $('#njcHistMore').hidden = !more;
  setText('#njcHistMore', t(histOpen ? 'showLess' : 'viewAll'));
  $('#njcHistMore').setAttribute('aria-expanded', String(histOpen));
  setHTML('#njcHist', last.length ? last.map(function(kk){
    var h = H[kk];
    var parts = kk.split('-');
    var dd = new Date(+parts[0], +parts[1]-1, +parts[2]);
    return '<div class="njc-row"><span class="k">' +
      // #35: "11 Sept 26" read like a time; a full year matches the other pages.
      esc(digitsFor(dd.toLocaleDateString(loc, {day:'numeric', month:'short', year:'numeric'}))) +
      '</span><span class="v tabular">' + fmt(h.c) + (h.r ? ' · ' + fmt(h.r) + '×' : '') + '</span></div>';
  }).join('') : '<p style="font-size:12.5px;color:var(--fg-subtle);text-align:center;padding:10px 0">' + esc(t('noHist')) + '</p>');
}

/* ---------- lists ---------- */
function esc(s){
  return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}
function meaning(x){
  return (S.lang === 'hi' && MEANING_HI[x.id]) || x.m || '';
}
/* removable: the full list in the sheet offers a remove control on your own names. */
function libItem(x, removable){
  var own = removable === true && S.custom.some(function(c){ return c.id === x.id; });
  var faved = S.favs.indexOf(x.id) > -1;
  /* B34: the star, rename and remove are buttons of their own beside the name,
     not role=button spans inside it — nested controls a keyboard could not reach. */
  return '<div class="njc-librow">' +
    '<button type="button" class="njc-star' + (faved ? ' on' : '') + '" data-fav="' + esc(x.id) + '" aria-pressed="' + faved + '" aria-label="' + esc(t('favL') + ': ' + x.t) + '">★</button>' +
    '<button type="button" class="njc-libitem" data-id="' + esc(x.id) + '" aria-current="' + (x.id === S.nameId) + '">' +
    '<span class="n"><b>' + esc(x.t) + '</b><span>' + esc(meaning(x)) + '</span></span>' +
    '<span class="a">' + (x.t === x.n ? '' : esc(x.n)) + '</span>' +
    '</button>' +
    /* #28: a typo in your own mantra could only be fixed by deleting it and adding
       it again, which also split its history across two ids. */
    (own ? '<button type="button" class="njc-del njc-ren" data-ren="' + esc(x.id) + '" aria-label="' + esc(t('renameL')) + '">✎</button>' : '') +
    (own ? '<button type="button" class="njc-del" data-del="' + esc(x.id) + '" aria-label="' + esc(t('removeL')) + '">✕</button>' : '') +
    '</div>';
}
function renderLib(){
  var all = allNames();
  var favFirst = all.slice().sort(function(a,b){
    return (S.favs.indexOf(a.id) > -1 ? 0 : 1) - (S.favs.indexOf(b.id) > -1 ? 0 : 1);
  });
  var html = favFirst.slice(0,10).map(function(x){ return libItem(x); }).join('');
  $('#njcLib').innerHTML = html;
  $('#njcLib2').innerHTML = html;

  var ids = S.favs.concat(QUICK).filter(function(id,i,a){ return a.indexOf(id) === i; }).slice(0,5);
  $('#njcQuick').innerHTML = ids.map(function(id){
    var x = null; for(var i=0;i<all.length;i++) if(all[i].id === id) x = all[i];
    if(!x) return '';
    return '<button type="button" class="njc-chip" data-quick="' + esc(id) + '" aria-pressed="' + (id === S.nameId) + '">' + esc(x.t) + '</button>';
  }).join('') + '<button type="button" class="njc-chip outline" data-openall="1">' + esc(t('allNames')) + ' ▾</button>';
}
function renderAllList(q){
  q = (q || '').trim().toLowerCase();
  /* B17: "harekrishna" and "hanumanji" are how people type these. Spaces are
     ignored and a respectful -ji / -जी ending is dropped before comparing. */
  var squash = function(v){ return String(v).toLowerCase().replace(/\s+/g, '').replace(/(ji|जी)$/, ''); };
  var qs = squash(q);
  /* #28: your own names first — they were listed after all 39 built-in ones. */
  var list = (S.custom || []).concat(NAMES).filter(function(x){
    var hay = (x.n + ' ' + x.t + ' ' + (x.m||'') + ' ' + (MEANING_HI[x.id]||'')).toLowerCase();
    return !q || hay.indexOf(q) > -1 || (qs.length > 1 && squash(hay).indexOf(qs) > -1);
  });
  if(!list.length){ $('#njcAllList').innerHTML = '<p class="njc-empty">' + esc(t('noMatch')) + '</p>'; return; }
  var own = S.custom || [];
  var groups = [
    ['yours', list.filter(function(x){ return own.indexOf(x) > -1; })],
    ['names', list.filter(function(x){ return own.indexOf(x) < 0 && x.g !== 'mantra'; })],
    ['mantras', list.filter(function(x){ return x.g === 'mantra'; })]
  ];
  $('#njcAllList').innerHTML = groups.filter(function(g){ return g[1].length; }).map(function(g){
    return '<p class="njc-group">' + esc(t(g[0])) + '</p>' + g[1].map(function(x){ return libItem(x, true); }).join('');
  }).join('');
}
function renderTargets(){
  $('#njcTargets').innerHTML = TARGETS.map(function(n){
    return '<button type="button" class="njc-tbtn tabular" data-t="' + n + '" aria-pressed="' + (S.target === n) + '">' + fmt(n) + '</button>';
  }).join('');
  $('#njcRounds').innerHTML = ROUNDS.map(function(n){
    return '<button type="button" class="njc-tbtn tabular" data-r="' + n + '" aria-pressed="' + ((S.rounds || 0) === n) + '">' + (n ? fmt(n) + '×' : '∞') + '</button>';
  }).join('');
}

/* ---------- time on the mala ---------- */
var sessionMark = Date.now(), lastCountAt = 0;
var IDLE_MS = 180000;   // three minutes with no count is not time on the mala
function tickTime(){
  var n = Date.now(), delta = n - sessionMark;
  sessionMark = n;
  // Only count time that sits inside an actual sitting: from the first count
  // until three minutes after the last one. A tab left open all afternoon
  // must not report five hours of japa.
  if(!lastCountAt || n - lastCountAt > IDLE_MS) return;
  if(delta > 0 && delta < 120000){
    // Resolved before the day moves: see the note on nameRec().
    var mineT = nameRec();
    dayRec().s = (dayRec().s || 0) + delta;
    mineT.s += delta;
  }
}

/* ---------- counting ---------- */
function count(x, y){
  /* Another tab may have counted since this one last looked: start from its
     number, not this tab's stale copy, or the save below would erase its taps. */
  adoptIfChanged();
  // No name picked yet: ask for one rather than counting into the void.
  if(!current()){ sheet('name'); return; }
  /* A tap after midnight closes yesterday. Flushing here rather than waiting for
     the minute timer means the day that just ended reaches the cold half before
     the hot blob moves on to the new one. */
  if(S.lastDay !== todayKey()){ S.lastDay = todayKey(); coldDirty = true; flushCold(); }
  if(S.count >= MAX) return;
  tickTime();
  lastCountAt = Date.now();
  undoStack.push(S.count);
  if(undoStack.length > 100) undoStack.shift();

  /* Before the increment. nameRec() seeds a new breakdown from the day total,
     so asking for it afterwards would seed the tap that has just landed and
     then count it again. */
  var mine = nameRec();
  S.count++; S.lifetime++; dayRec().c++; mine.c++;
  /* No press-scale of the stage: scaling the ring re-laid out its 54 bead
     numbers on every frame and halved the frame rate on a phone. The ripple and
     the rolling number are the feedback. */
  buzz(14); ripple(x, y); bubble();

  /* A round is counted even when no target is set. "Count freely" leaves
     S.target null, and the old guard `if(S.target && ...)` meant those users
     never recorded a round at all — and so, under docs/SPEC.md §3, could never
     earn a streak day. Nobody decided that; it was a hole. 108 is the tradition
     a free counter would be measured against anyway. */
  var step = S.target || ROUND_FALLBACK;
  if(S.count % step === 0){
    dayRec().r = (dayRec().r || 0) + 1; mine.r++;
    burst(); buzz([30,50,30]);
    var roundNo = S.count / step;
    /* B06: "Target reached" only when a target was set; free count gets the pill.
       B09: past a rounds limit each further mala is a pill, not the card again. */
    if(S.target && (!S.rounds || roundNo === S.rounds)) showMilestone('target');
    else showMilestone('round');
  }
  markOutbox();
  /* A finished mala goes up at once; any other tap waits for a quiet moment. */
  if(sync){ if(S.count % step === 0) sync.flushNow(); else sync.changed(); }
  announce();
  render(); saveTap();
  warnIfNotSaving();
}
/* #45: a refused write used to vanish in silence — the count went on climbing on
   screen, and a reload took all of it. Said once per visit, with the one way to
   keep it. */
var notSavingWarned = false;
function warnIfNotSaving(){
  if(notSavingWarned || !store.writeFailed || !store.writeFailed()) return;
  notSavingWarned = true;
  notice(t('notSaving'), { tone: 'bad', actionLabel: t('backup'), onAction: function(){ $('#njcExport').click(); } });
}
function undo(){
  adoptIfChanged();
  if(!undoStack.length) return;
  /* A component the server has confirmed cannot come back down: lowering it
     locally would be resurrected by GREATEST on the next sync, so the tap would
     reappear. Until sync exists the watermark is empty and this never fires —
     see src/lib/counter/outbox.ts. */
  /* The watermark is per day AND name, so it is compared with this name's own
     count. Against the day's total, a confirmed tap could be undone on a day with
     two names. */
  if(!Outbox.canUndo(watermark, todayKey(), S.nameId || '', nameRec().c)) return;
  var prev = undoStack.pop();
  var back = S.count - prev;
  if(back <= 0) return;
  var step = S.target || ROUND_FALLBACK;
  /* Rounds have to come back down with everything else. They did not before,
     so completing a mala and undoing past it left the round credited — harmless
     while it was only a label, wrong now that it decides the streak. */
  var rounds = Math.floor(S.count / step) - Math.floor(prev / step);
  S.count = prev;
  S.lifetime = Math.max(0, S.lifetime - back);
  var rec = dayRec(), mine = nameRec();  // resolved before either moves
  rec.c = Math.max(0, rec.c - back);
  mine.c = Math.max(0, mine.c - back);
  if(rounds > 0){
    rec.r = Math.max(0, (rec.r || 0) - rounds);
    mine.r = Math.max(0, mine.r - rounds);
  }
  markOutbox();
  if(sync) sync.changed();
  buzz(8); hideMilestone(); render(); saveTap();
}
function finishSession(){
  S.malaDone += Math.floor(S.count / (S.target || ROUND_FALLBACK));
  S.count = 0; undoStack = []; hideMilestone();
  render(); save();
}
/* #44: this spoke the name and the number after every tap, and a long mantra was
   still being read out several taps later. Now the number alone, at most once a
   second, and the name only when it changes. Mala complete and the milestones
   speak through their own status elements. */
var lastAnnounceAt = 0, lastAnnouncedName = null, announceTimer = null;
teardowns.push(function(){ if(announceTimer) clearTimeout(announceTimer); announceTimer = null; });
function announce(){
  var nm = current();
  var id = nm ? nm.id : null;
  var named = id !== lastAnnouncedName;
  lastAnnouncedName = id;
  var wait = named ? 0 : Math.max(0, 1000 - (Date.now() - lastAnnounceAt));
  if(announceTimer) clearTimeout(announceTimer);
  announceTimer = setTimeout(function(){
    announceTimer = null;
    lastAnnounceAt = Date.now();
    var now = current();
    $('#njcLive').textContent = (named && now ? now.t + ' ' : '') + view().display;
  }, wait);
}

/* ---------- feedback ---------- */
function reducedMotion(){ return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function buzz(p){ if(S.vibration && navigator.vibrate){ try{ navigator.vibrate(p); }catch(e){} } }
function ripple(x, y){
  if(x == null || reducedMotion()) return;
  var stage = $('#njcStage'), r = stage.getBoundingClientRect();
  if(x < r.left - 40 || x > r.right + 40 || y < r.top - 40 || y > r.bottom + 40) return;
  var el = document.createElement('span');
  el.className = 'njc-ripple';
  el.style.left = (x - r.left) + 'px';
  el.style.top  = (y - r.top) + 'px';
  stage.appendChild(el);
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 640);
}
function burst(){
  if(reducedMotion()) return;
  var s = $('#njcStage'), el = document.createElement('span');
  el.className = 'njc-burst'; s.appendChild(el);
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 800);
}
function bubble(){
  if(!S.bubbles) return;
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var stage = $('#njcStage'), nm = current();
  if(!nm) return;
  var live = stage.querySelectorAll('.njc-bubble');
  if(live.length > 3 && live[0].parentNode) live[0].parentNode.removeChild(live[0]);
  var deva = S.count % 2 === 0;
  var el = document.createElement('span');
  el.className = 'njc-bubble' + (deva ? ' dv' : '');
  el.textContent = deva ? nm.n : nm.t;
  el.style.setProperty('--drift', Math.round((Math.random()*2 - 1) * 46) + 'px');
  stage.appendChild(el);
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 2100);
}

/* ---------- milestone ---------- */
var mileEl = null, mileKind = null, mileTimer = null;
function hideMilestone(){
  if(mileTimer){ clearTimeout(mileTimer); mileTimer = null; }
  if(mileEl && mileEl.parentNode) mileEl.parentNode.removeChild(mileEl);
  mileEl = null; mileKind = null;
}
function showMilestone(kind, text){
  hideMilestone();
  mileKind = kind;
  if(kind !== 'target'){
    mileEl = document.createElement('div');
    mileEl.className = 'njc-pill';
    mileEl.setAttribute('role','status');
    mileEl.textContent = (text || t('roundDone')) + ' ✓';
    R.appendChild(mileEl);
    mileTimer = setTimeout(hideMilestone, 2600);
    return;
  }
  mileEl = document.createElement('div');
  mileEl.className = 'njc-mile';
  mileEl.setAttribute('role','status');
  mileEl.innerHTML =
    '<p class="t">' + esc(t('mileT')) + ' ✓</p><p class="s">' + esc(t('mileS')) + '</p>' +
    /* #13: "New mala" and "Finish" did exactly the same thing. Two choices remain:
       keep going, or bank the malas and start again at zero. */
    '<div class="acts">' +
      '<button type="button" data-m="cont">' + esc(t('cont')) + '</button>' +
      '<button type="button" class="primary" data-m="fin">' + esc(t('finish')) + '</button>' +
    '</div>';
  R.appendChild(mileEl);
  mileEl.addEventListener('click', function(e){
    var b = e.target.closest('[data-m]');
    if(!b) return;
    e.stopPropagation();
    var m = b.getAttribute('data-m');
    if(m === 'cont') hideMilestone(); else finishSession();
  });
}

/* ---------- timer / auto ---------- */
var timerLeft = null, timerInt = null, autoInt = null;
/* #39: the time left is read from the clock, not counted down tick by tick. A
   phone pauses or slows a page's timers while its screen is off, so a 15-minute
   sitting used to run on for as long as the screen stayed dark. The screen is also
   kept awake while a timer runs, and the first tick after the end — however late —
   finishes it. */
var timerEnd = 0, timerStartChants = 0;
function startTimer(){
  stopAuto();
  timerEnd = Date.now() + S.timerSec * 1000;
  keepTimerEnd();
  timerStartChants = S.lifetime || 0;
  timerLeft = S.timerSec;
  if(timerInt) clearInterval(timerInt);
  wake(true);
  unlockChime();                       // inside the tap that chose Timer, so iOS lets it sound later
  timerInt = setInterval(tickTimer, 1000);
  render();
}
function tickTimer(){
  if(!timerInt) return;
  timerLeft = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
  if(timerLeft <= 0){ endTimer(); return; }
  render();
}
/* #26: the end was a 2.6-second pill, easy to miss with eyes closed, and the Timer
   chip stayed pressed. Now a soft bell, a vibration where there is one, a notice
   that stays until it is dismissed, and the counter back to counting up. */
function endTimer(){
  var mins = Math.max(1, Math.round(S.timerSec / 60));
  var chants = Math.max(0, (S.lifetime || 0) - timerStartChants);
  stopTimer();
  buzz([60,80,60]);
  chime();
  setMode('up');
  notice(t('timeDone').replace('{min}', fmt(mins)).replace('{chants}', fmt(chants)), { tone: 'good' });
}
/* B14: the end of a running timer outlives a reload. */
var TIMER_KEY = 'njc.timer';
function keepTimerEnd(){ try{ localStorage.setItem(TIMER_KEY, String(timerEnd)); }catch(e){} }
function resumeTimer(end){
  startTimer();
  timerEnd = end; keepTimerEnd();
  timerLeft = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  S.uiMode = 'timer';
  $$('.njc-mode[data-mode]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === 'timer')); });
  render();
}
teardowns.push(function(){ if(timerInt) clearInterval(timerInt); timerInt = null; if(autoInt) clearInterval(autoInt); autoInt = null; });
function stopTimer(){
  if(timerInt) clearInterval(timerInt);
  if(timerInt){ try{ localStorage.removeItem(TIMER_KEY); }catch(e){} }
  timerInt = null; timerLeft = null;
  if(!S.awake) wake(false);
}

var audioCtx = null;
function unlockChime(){
  try{
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(!audioCtx){
      audioCtx = new AC();
      teardowns.push(function(){ try{ audioCtx.close(); }catch(e){} audioCtx = null; });
    }
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){ /* no sound, the notice and vibration still come */ }
}
function chime(){
  try{
    if(!audioCtx) return;
    var now = audioCtx.currentTime;
    [528, 792].forEach(function(freq, i){
      var at = now + i * 0.2;
      var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(at); osc.stop(at + 1.9);
    });
  }catch(e){}
}

/* #40: Auto stopped only when switched off — it counted on through a finished mala,
   into streak, stats and sync, with nobody there. It now ends with each mala, and
   it skips its ticks while the page is hidden. */
function startAuto(){
  stopTimer(); if(autoInt) clearInterval(autoInt);
  autoInt = setInterval(function(){
    if(!current()){ setMode('up'); return; }
    if(document.hidden) return;
    count();
    if(S.count % (S.target || ROUND_FALLBACK) === 0) setMode('up');
  }, S.autoMs);
}
function stopAuto(){ if(autoInt) clearInterval(autoInt); autoInt = null; }

function setMode(m){
  /* Auto counts by itself, so it needs a name first. Without one every tick asked
     for a name again, and the sheet came back each time it was closed. */
  if(m === 'auto' && !current()){ sheet('name'); m = 'up'; }
  S.mode = (m === 'down') ? 'down' : 'up';
  S.uiMode = m;
  stopAuto();
  if(m !== 'timer') stopTimer();
  if(m === 'timer') startTimer();
  if(m === 'auto') startAuto();
  $$('.njc-mode[data-mode]').forEach(function(b){
    b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === m));
  });
  render(); save();
}

/* ---------- wake lock ---------- */
var wl = null;
function wake(on){
  try{
    if(on && navigator.wakeLock && navigator.wakeLock.request){
      navigator.wakeLock.request('screen').then(function(l){ wl = l; }, function(){});
    } else if(wl){ wl.release(); wl = null; }
  }catch(e){}
}

/* ---------- sheets ---------- */
var SHEETS = { name:'#shName', target:'#shTarget', reset:'#shReset', more:'#shMore' };
var openSheet = null, scrollLock = 0, sheetOpenedAt = 0;
/* A sheet is a dialog: focus goes into it, everything behind it is inert so Tab
   cannot wander back into the page, and closing it hands focus back to the
   control that opened it. None of that happened before — Tab walked the whole
   page first, and Escape left focus nowhere. */
var sheetOpener = null, inerted = [];
function inertAround(el){
  for(var node = el; node && node.parentElement && node !== document.body; node = node.parentElement){
    var sibs = node.parentElement.children;
    for(var i = 0; i < sibs.length; i++){
      var s = sibs[i];
      if(s === node || s.id === 'njcScrim' || s.inert || s.tagName === 'SCRIPT' || s.tagName === 'STYLE') continue;
      s.inert = true; inerted.push(s);
    }
  }
}
function releaseInert(){
  for(var i = 0; i < inerted.length; i++) inerted[i].inert = false;
  inerted = [];
}
/* #41: on Android the Back gesture is how people close things. With no history
   entry for a sheet, Back left the counter instead. Opening a sheet now adds one
   entry; Back closes the sheet, and closing it any other way takes the entry away. */
var sheetInHistory = false;
function sheet(name, fromHash){
  var from = document.activeElement;
  closeSheet(true);                    // switching sheets keeps the one entry
  if(!name) return;
  openSheet = name;
  /* A sheet opened by a #library or #settings link already has the link's own
     history entry, whose hash is then removed — pushing another would make Back
     land on the hash again and reopen the sheet. */
  if(!sheetInHistory && fromHash !== true){
    try{ history.pushState(history.state, '', location.href); sheetInHistory = true; }catch(e){}
  }
  sheetOpenedAt = Date.now();
  sheetOpener = from && from !== document.body ? from : null;
  var el = $(SHEETS[name]);
  el.classList.add('open');
  $('#njcScrim').classList.add('open');
  inertAround(el);
  var first = el.querySelector('[data-close]');
  if(first){ try{ first.focus({preventScroll: true}); }catch(e){ first.focus(); } }
  scrollLock = window.pageYOffset;
  document.documentElement.style.overflow = 'hidden';
  // .njc sets isolation:isolate, so the sheets cannot escape the counter's own
  // stacking context. The page's sticky header outranks it and painted over
  // the open sheet. This flag lets the page lift the counter while a sheet is
  // up; a page without the rule is unaffected.
  document.documentElement.classList.add('njc-sheet-open');
  if(name === 'name'){ renderAllList($('#njcSearch').value); }
  if(name === 'target'){ renderTargets(); targetMsg(''); }
  if(name === 'more'){ syncMore(); }
}
function closeSheet(keepHistory){
  for(var k in SHEETS) $(SHEETS[k]).classList.remove('open');
  $('#njcScrim').classList.remove('open');
  var wasOpen = !!openSheet;
  if(wasOpen && keepHistory !== true && sheetInHistory){
    sheetInHistory = false;
    try{ history.back(); }catch(e){}   // its popstate finds nothing left to close
  }
  releaseInert();
  disarm();
  document.documentElement.style.overflow = '';
  document.documentElement.classList.remove('njc-sheet-open');
  openSheet = null;
  // scrollLock was captured on open and never used. Chrome keeps the position
  // through an overflow:hidden lock, iOS Safari does not and drops the reader
  // back to the top of the page. Put it back.
  if(wasOpen && !R.classList.contains('njc-faux-fs')){
    // 'instant', because the page sets scroll-behavior:smooth and a restore
    // that animates reads as the page sliding away on its own.
    try{ window.scrollTo({top: scrollLock, behavior: 'instant'}); }
    catch(e){ window.scrollTo(0, scrollLock); }
  }
  if(wasOpen){
    if(sheetOpener && document.contains(sheetOpener)){
      try{ sheetOpener.focus({preventScroll: true}); }catch(e){}
    }
    sheetOpener = null;
  }
}

/* ---------- events ---------- */
var downAt = 0, moved = false, sx = 0, sy = 0;
var surf = $('#njcSurface');
function atRoundLimit(){ return !!(S.rounds && S.target && S.count >= S.rounds * S.target); }
/* At least half of the ring inside the viewport, or the counter in full screen. */
function ringInView(){
  if(R.classList.contains('immersive')) return true;
  var r = $('#njcStage').getBoundingClientRect();
  var seen = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
  return r.height > 0 && seen >= r.height / 2;
}
on(surf, 'pointerdown', function(e){ downAt = Date.now(); moved = false; sx = e.clientX; sy = e.clientY; });
on(surf, 'pointermove', function(e){
  if(Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12) moved = true;
});
on(surf, 'pointerup', function(e){
  if(moved || Date.now() - downAt > 800) return;
  /* B07: the tap that closes "Target reached" is a chant as well — except at the
     end of a set number of rounds, where it only closes the card. */
  if(mileEl && mileKind === 'target'){ hideMilestone(); if(atRoundLimit()) return; }
  count(e.clientX, e.clientY);
});
on(surf, 'click', function(e){ e.preventDefault(); });
on(surf, 'contextmenu', function(e){ e.preventDefault(); });
/* A touch is followed by the browser's compatibility mouse events and a click.
   When the tap opens a sheet (no name chosen yet), that click landed on the scrim
   that had just appeared and closed the sheet 13ms later: on every phone,
   "Tap to choose a name" did nothing. The tap is fully handled on pointerup. */
on(surf, 'touchend', function(e){ if(e.cancelable) e.preventDefault(); }, {passive: false});

on(document, 'keydown', function(e){
  var tn = (e.target && e.target.tagName) || '';
  /* Escape closes a sheet wherever focus is, including its own search, name and
     target fields. It used to return early for inputs, so a sheet whose field
     had focus could not be closed from the keyboard at all. */
  if(e.key === 'Escape' && openSheet){ closeSheet(); return; }
  if(tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT') return;
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  /* A focused control owns its keys: Enter follows a link, Space presses a
     button. This used to count a chant and swallow the key on every one of them,
     so a keyboard could not open Target, Reset or More, nor leave by the header.
     Only the ring itself, or nothing focused at all, counts. */
  var focused = e.target && e.target.closest ? e.target.closest('a[href],button,summary,select,[role="button"],[role="switch"],[tabindex]') : null;
  if(focused && focused !== surf) return;
  /* B08: Space and Backspace are also the page's scroll and back keys. Unless the
     ring itself has focus they count only while the ring is on screen — reading
     the article further down, they scroll as they always do. */
  if(focused !== surf && /^(Space|Enter|NumpadEnter|Backspace)$/.test(e.code) && !ringInView()) return;
  if(e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter'){
    if(openSheet) return;
    e.preventDefault();
    // A key held down repeats; a resting finger is not a stream of chants.
    if(e.repeat) return;
    if(mileEl && mileKind === 'target'){ hideMilestone(); if(atRoundLimit()) return; }
    count();
  } else if(e.code === 'Backspace'){
    if(openSheet) return;
    e.preventDefault();
    if(e.repeat) return;
    undo();
  } else if(e.key === 'f' || e.key === 'F'){
    if(!openSheet && !e.repeat) toggleFs();
  }
});

/* And a second line of defence for any other path to the same ghost click. */
on($('#njcScrim'), 'click', function(){
  if(Date.now() - sheetOpenedAt < 400) return;
  closeSheet();
});
$$('[data-close]').forEach(function(b){ on(b, 'click', closeSheet); });
on($('#njcSelectBar'), 'click', function(){ sheet('name'); });
on($('#njcTargetBtn'), 'click', function(){ sheet('target'); });
on($('#njcResetBtn'), 'click', function(){ sheet('reset'); });
on($('#njcMoreBtn'), 'click', function(){ sheet('more'); });
on($('#njcUndo'), 'click', undo);

/* #28: rename your own mantra in place. The id stays the same, so its history
   stays with it. */
function renameCustom(id){
  var own = null;
  for(var i = 0; i < S.custom.length; i++) if(S.custom[i].id === id) own = S.custom[i];
  if(!own) return;
  var v = window.prompt(t('renamePrompt'), own.n);
  if(v === null) return;
  v = v.trim().replace(/\s+/g, ' ').slice(0, +$('#njcCustom').getAttribute('maxlength') || 60);
  if(!v) return;
  adoptIfChanged();
  for(var j = 0; j < S.custom.length; j++) if(S.custom[j].id === id){ S.custom[j].n = v; S.custom[j].t = v; }
  coldDirty = true; save(); flushCold();
  renderLib(); renderAllList($('#njcSearch').value); render();
}

on(R, 'click', function(e){
  var ren = e.target.closest('[data-ren]');
  if(ren){
    e.stopPropagation(); e.preventDefault();
    renameCustom(ren.getAttribute('data-ren'));
    return;
  }
  var del = e.target.closest('[data-del]');
  if(del){
    e.stopPropagation(); e.preventDefault();
    removeCustom(del);
    return;
  }
  var fav = e.target.closest('[data-fav]');
  if(fav){
    e.stopPropagation(); e.preventDefault();
    var id = fav.getAttribute('data-fav');
    var i = S.favs.indexOf(id);
    if(i > -1) S.favs.splice(i,1); else S.favs.push(id);
    save(); renderLib(); renderAllList($('#njcSearch').value);
    return;
  }
  if(e.target.closest('[data-openall]')){ sheet('name'); return; }
  if(e.target.closest('#njcHistMore')){ histOpen = !histOpen; renderPractice(); return; }
  var item = e.target.closest('.njc-libitem');
  if(item){ pick(item.getAttribute('data-id')); if(openSheet === 'name') closeSheet(); return; }
  var q = e.target.closest('[data-quick]');
  if(q){ pick(q.getAttribute('data-quick')); return; }
});
/* Your own names can be taken out again — two taps, like everything else that
   cannot be undone. Days already counted under the name stay in the history. */
function removeCustom(btn){
  var id = btn.getAttribute('data-del');
  if(!btn.hasAttribute('data-armed')){
    btn.setAttribute('data-armed', '');
    btn.textContent = t('remove');
    $('#njcLive').textContent = t('removeL');
    setTimeout(function(){
      if(btn.isConnected && btn.hasAttribute('data-armed')){ btn.removeAttribute('data-armed'); btn.textContent = '✕'; }
    }, 4000);
    return;
  }
  S.custom = S.custom.filter(function(c){ return c.id !== id; });
  S.favs = S.favs.filter(function(f){ return f !== id; });
  if(S.nameId === id) S.nameId = null;
  save(); renderLib(); renderAllList($('#njcSearch').value); render();
}
function pick(id){
  var a = allNames(), x = null;
  for(var i=0;i<a.length;i++) if(a[i].id === id) x = a[i];
  if(!x) return;
  S.nameId = id;
  renderLib(); render(); save();
  /* The name line under the ring is taller for some names than for the empty
     "Select a name" state (Devanagari with matras above the line), so the ring
     is measured again — or the mode chips end a few pixels under the fold. */
  sizeStage();
}

on($('#njcSearch'), 'input', function(){ renderAllList(this.value); });
on($('#njcCustomAdd'), 'click', function(){
  var v = $('#njcCustom').value.trim().replace(/\s+/g, ' ');
  if(!v) return;
  /* A name that is already in the list is picked, not added a second time. */
  var existing = allNames(), low = v.toLowerCase();
  for(var e1 = 0; e1 < existing.length; e1++){
    if(existing[e1].n.toLowerCase() === low || existing[e1].t.toLowerCase() === low){
      $('#njcCustom').value = '';
      pick(existing[e1].id); renderAllList(''); closeSheet();
      return;
    }
  }
  var id = 'c' + Date.now();
  S.custom.push({ id:id, n:v, t:v, m:'' });
  $('#njcCustom').value = '';
  S.nameId = id;
  save(); renderLib(); renderAllList(''); render(); closeSheet();
});
on($('#njcCustom'), 'keydown', function(e){ if(e.key === 'Enter') $('#njcCustomAdd').click(); });
/* A field at the foot of a sheet — the custom mantra here, the target, the search
   — sat under the phone keyboard: you typed blind and only saw it once the
   keyboard closed. The viewport meta (interactive-widget) lifts the sheet on
   Chrome and Firefox; iOS Safari does not honour it, so once the keyboard has
   opened we bring the focused field into view ourselves. */
on(R, 'focusin', function(e){
  var el = e.target;
  if(!openSheet || !el || !/^(INPUT|TEXTAREA)$/.test(el.tagName || '')) return;
  setTimeout(function(){
    if(document.activeElement !== el) return;
    try{ el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); }catch(err){ try{ el.scrollIntoView(); }catch(e2){} }
  }, 300);
});
/* #46: the field stops at its limit without a word, and a long mantra was saved
   cut mid-word. The count shows as the limit comes near. */
function customLeft(){
  var input = $('#njcCustom'), max = +input.getAttribute('maxlength') || 60, n = input.value.length;
  $('#njcCustomLeft').textContent = n >= max - 15 ? t('customLeft').replace('{n}', fmt(n)).replace('{max}', fmt(max)) : '';
}
on($('#njcCustom'), 'input', customLeft);
on($('#njcCustomAdd'), 'click', function(){ setTimeout(customLeft, 0); });
/* #11: the add-your-own field is at the end of a long list; this button beside the
   search box goes straight to it, carrying over whatever was searched. */
on($('#njcAddOwn'), 'click', function(){
  var input = $('#njcCustom'), typed = $('#njcSearch').value.trim();
  if(typed && !input.value) input.value = typed.slice(0, +input.getAttribute('maxlength') || 60);
  try{ input.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); }catch(e){}
  try{ input.focus({ preventScroll: true }); }catch(e){ input.focus(); }
  customLeft();
});

/* B10: a mala part-way through belongs to the target it was started under, so a
   new target banks the session and starts again at zero, as Finish does. Before,
   Mala read 1 while no round had been recorded — and so no streak day. */
function changeTarget(n){
  if(n === S.target) return;
  if(S.count > 0){
    S.malaDone += Math.floor(S.count / (S.target || ROUND_FALLBACK));
    S.count = 0; undoStack = []; hideMilestone();
  }
  S.target = n;
}
on($('#njcTargets'), 'click', function(e){
  var b = e.target.closest('[data-t]'); if(!b) return;
  changeTarget(+b.getAttribute('data-t'));
  beadsBuilt = 0; renderTargets(); render(); save();
});
on($('#njcRounds'), 'click', function(e){
  var b = e.target.closest('[data-r]'); if(!b) return;
  var n = +b.getAttribute('data-r');
  S.rounds = n || null;
  renderTargets(); render(); save();
});
/* parseInt read "1e3" as 1 and "1.5" as 1, clamped 99999999 in silence, and
   ignored everything it rejected without a word. A target is a whole number in
   range, and the field says so when it is not. */
function targetMsg(text){
  var m = $('#njcTargetMsg'), inp = $('#njcTargetIn');
  if(!m){
    if(!text) return;
    m = document.createElement('p');
    m.id = 'njcTargetMsg'; m.className = 'njc-fieldmsg'; m.setAttribute('role', 'alert');
    inp.parentNode.insertAdjacentElement('afterend', m);
    inp.setAttribute('aria-describedby', 'njcTargetMsg');
  }
  m.textContent = text; m.hidden = !text;
  inp.setAttribute('aria-invalid', String(!!text));
}
on($('#njcTargetSet'), 'click', function(){
  /* B15: valueAsNumber read "1e3" as 1000. Digits only. */
  var inp = $('#njcTargetIn'), n = /^\s*\d+\s*$/.test(inp.value) ? +inp.value : NaN;
  if(!isFinite(n) || n < 1 || n > MAX || Math.floor(n) !== n){
    targetMsg(t('targetBad').replace('{max}', fmt(MAX)));
    try{ inp.focus({preventScroll: true}); }catch(e){}
    return;
  }
  targetMsg('');
  changeTarget(n);
  beadsBuilt = 0; renderTargets(); render(); save(); closeSheet();
});
on($('#njcTargetIn'), 'keydown', function(e){ if(e.key === 'Enter') $('#njcTargetSet').click(); });
on($('#njcTargetClear'), 'click', function(){
  changeTarget(null); S.rounds = null;
  beadsBuilt = 0; renderTargets(); render(); save(); closeSheet();
});

/* Clear today and Erase everything cannot be undone, and one stray tap used to do
   either. The first tap arms the option and says what the second will do; a
   second tap within five seconds acts. Closing the sheet disarms it. */
var armed = null, armTimer = null;
function arm(btn, key){
  if(armed === btn){ disarm(); return true; }
  disarm();
  armed = btn;
  var label = btn.querySelector('b') || btn;
  btn.setAttribute('data-was', label.textContent);
  btn.setAttribute('data-armed', '');
  label.textContent = t(key);
  $('#njcLive').textContent = t(key);
  armTimer = setTimeout(disarm, 5000);
  return false;
}
function disarm(){
  if(armTimer){ clearTimeout(armTimer); armTimer = null; }
  if(!armed) return;
  var label = armed.querySelector('b') || armed;
  if(armed.hasAttribute('data-was')) label.textContent = armed.getAttribute('data-was');
  armed.removeAttribute('data-armed'); armed.removeAttribute('data-was');
  armed = null;
}
on($('#njcRUndo'), 'click', function(){ undo(); closeSheet(); });
on($('#njcRCount'), 'click', function(){ S.count = 0; undoStack = []; hideMilestone(); render(); save(); closeSheet(); });
on($('#njcRSession'), 'click', function(){ finishSession(); closeSheet(); });
/* Both resets used to leave the outbox holding the erased, higher values, so the
   next sync uploaded the taps anyway. And a count the server has confirmed cannot
   be erased from here at all: the next pull would bring it straight back. */
function syncedToday(){
  var p = todayKey() + '|';
  for(var k in watermark) if(k.indexOf(p) === 0) return true;
  return false;
}
function dropOutbox(prefix){
  for(var k in outbox) if(!prefix || k.indexOf(prefix) === 0) delete outbox[k];
}
on($('#njcRToday'), 'click', function(){
  if(syncedToday()){ notice(t('syncedNoReset'), { tone: 'bad' }); closeSheet(); return; }
  if(!arm(this, 'confirmToday')) return;
  /* B11: today's own chants leave Total too. B12: and the session on the ring with
     them — the ring kept showing them and Undo pointed at counts that were gone. */
  var gone = (S.hist[todayKey()] && S.hist[todayKey()].c) || 0;
  S.lifetime = Math.max(0, S.lifetime - gone);
  delete S.hist[todayKey()];
  dropOutbox(todayKey() + '|');
  S.count = 0; undoStack = []; hideMilestone();
  render(); save(); closeSheet();
});
on($('#njcRAll'), 'click', function(){
  if(Object.keys(watermark).length){ notice(t('syncedNoResetAll'), { tone: 'bad' }); closeSheet(); return; }
  if(!arm(this, 'confirmAll')) return;
  dropOutbox();
  var keep = { theme:S.theme, numerals:S.numerals, lang:S.lang,
               vibration:S.vibration, bubbles:S.bubbles, beads:S.beads, awake:S.awake };
  for(var k in BLANK) S[k] = BLANK[k];
  S.hist = {}; S.custom = []; S.favs = [];
  for(var j in keep) S[j] = keep[j];
  S.lastDay = todayKey();
  undoStack = []; hideMilestone();
  save(); boot(true); closeSheet();
});

$$('[data-toggle]').forEach(function(b){
  on(b, 'click', function(){
    var k = b.getAttribute('data-toggle');
    S[k] = !S[k];
    b.setAttribute('aria-checked', String(!!S[k]));
    if(k === 'awake') wake(S[k]);
    if(k === 'vibration') $('#njcHapticChip').setAttribute('aria-pressed', String(S[k]));
    if(k === 'beads') beadsBuilt = 0;
    save(); render();
  });
});
on($('#njcHapticChip'), 'click', function(){
  S.vibration = !S.vibration;
  $('#njcHapticChip').setAttribute('aria-pressed', String(S.vibration));
  syncMore(); save();
});
$$('.njc-mode[data-mode]').forEach(function(b){
  on(b, 'click', function(){ setMode(b.getAttribute('data-mode')); });
});

on($('#njcThemeSeg'), 'click', function(e){
  var b = e.target.closest('[data-th]'); if(!b) return;
  S.theme = b.getAttribute('data-th'); R.setAttribute('data-theme', S.theme); syncMore(); save();
});
on($('#njcNumSeg'), 'click', function(e){
  var b = e.target.closest('[data-num]'); if(!b) return;
  S.numerals = b.getAttribute('data-num'); lastDisplay = null; syncMore(); renderTargets(); render(); save();
});
on($('#njcLangSeg'), 'click', function(e){
  var b = e.target.closest('[data-lang]'); if(!b) return;
  S.lang = b.getAttribute('data-lang'); applyLang(); syncMore(); render(); save();
});
on($('#njcAutoSeg'), 'click', function(e){
  var b = e.target.closest('[data-ms]'); if(!b) return;
  S.autoMs = +b.getAttribute('data-ms'); if(autoInt){ startAuto(); } syncMore(); save();
});
on($('#njcTimerSeg'), 'click', function(e){
  var b = e.target.closest('[data-sec]'); if(!b) return;
  /* B13: choosing the length already running does not restart it. */
  var sec = +b.getAttribute('data-sec'); if(sec === S.timerSec) return;
  S.timerSec = sec; if(timerInt){ startTimer(); } syncMore(); save();
});

on($('#njcThemeBtn'), 'click', function(){
  var order = ['prabhat','ratri','kashi','tulsi'];
  S.theme = order[(order.indexOf(S.theme) + 1) % order.length];
  R.setAttribute('data-theme', S.theme); syncMore(); save();
});
on($('#njcLang'), 'click', function(){
  // render() as well as applyLang(): the hint line is rewritten by render when
  // no name is chosen, and applyLang would otherwise put "Tap to count" back.
  S.lang = S.lang === 'en' ? 'hi' : 'en'; applyLang(); syncMore(); render(); save();
});

function syncMore(){
  $$('#njcThemeSeg [data-th]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-th') === S.theme)); });
  $$('#njcNumSeg [data-num]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-num') === S.numerals)); });
  $$('#njcLangSeg [data-lang]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === S.lang)); });
  $$('#njcAutoSeg [data-ms]').forEach(function(b){ b.setAttribute('aria-pressed', String(+b.getAttribute('data-ms') === S.autoMs)); });
  $$('#njcTimerSeg [data-sec]').forEach(function(b){ b.setAttribute('aria-pressed', String(+b.getAttribute('data-sec') === S.timerSec)); });
  $$('[data-toggle]').forEach(function(b){
    b.setAttribute('aria-checked', String(!!S[b.getAttribute('data-toggle')]));
  });
  $('#njcHapticChip').setAttribute('aria-pressed', String(S.vibration));
}

/* ---------- fullscreen ----------
   iPhone Safari has no element fullscreen at all, and the API can reject on
   a locked-down embed. Either way we fall back to pinning the counter over
   the page so the full-screen button the copy promises always does something. */
var fauxFs = false;

function setFauxFs(on){
  fauxFs = on;
  R.classList.toggle('immersive', on);
  R.classList.toggle('njc-faux-fs', on);
  document.documentElement.classList.toggle('njc-fs-lock', on);
  paintFsButton(on);
  settleStage();
}
/* Entering or leaving full screen changes the viewport a moment AFTER the event:
   the browser bars slide away, and on a desktop the height grows by less than
   CHROME_SLOP, which the resize guard ignored. The ring stayed sized for the old
   screen. Measure now, and again once the new size has landed. */
/* A timer that outlives a teardown is harmless: sizing finds no column and stops. */
var settleT = 0;
function settleStage(){
  clearTimeout(settleT);
  lastW = lastH = 0;
  sizeStage();
  settleT = setTimeout(function(){ lastW = innerWidth; lastH = innerHeight; sizeStage(); }, 300);
}

/* The page, not the counter element, goes full screen, with the counter already
   pinned over it. Making the element full screen moved it into the top layer,
   and a phone showed the black backdrop for a second or two while the counter
   was laid out again at the new size. Now the frame the browser shows as it
   switches is the counter itself. If the request is refused, the pinned counter
   simply stays: that is the iPhone fallback anyway. */
function toggleFs(){
  if(!document.fullscreenElement){
    if(fauxFs){ setFauxFs(false); return; }
    setFauxFs(true);
    var el = document.documentElement;
    if(el.requestFullscreen) el.requestFullscreen().catch(Object);
  }else document.exitFullscreen();
}
on($('#njcFs'), 'click', toggleFs);

/* Escape leaves the fallback the same way it leaves real fullscreen. */
on(document, 'keydown', function(e){
  if(fauxFs && e.key === 'Escape') toggleFs();
});
function paintFsButton(on){
  $('#njcFsPath').setAttribute('d', on
    ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
    : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
  var lg = $('#njcFs').querySelector('.lg'), sm = $('#njcFs').querySelector('.sm');
  lg.textContent = on ? t('exit') : t('full');
  sm.textContent = on ? t('exitS') : t('fullS');
}

function fsChange(){
  var on = !!document.fullscreenElement;
  // Leaving by Escape or the back gesture takes the pinned counter down with it.
  if(on !== fauxFs) setFauxFs(on); else settleStage();
}
on(document, 'fullscreenchange', fsChange);

/* ---------- notices ----------
   A strip above the counter for the two things the widget needs to say out
   loud. It replaces alert(), which blocks the page, cannot be styled, and reads
   like an error even when the news is good.

   Built here rather than added to the markup constant: it is absent far more
   often than it is present, and the constant is shared with the server render. */
var noticeEl = null;

function dismissNotice(){
  if(noticeEl && noticeEl.parentNode) noticeEl.parentNode.removeChild(noticeEl);
  noticeEl = null;
  sizeStage();
}

function notice(text, opts){
  opts = opts || {};
  dismissNotice();

  noticeEl = document.createElement('div');
  noticeEl.className = 'njc-notice' + (opts.tone ? ' ' + opts.tone : '');
  noticeEl.setAttribute('role', 'status');

  var msg = document.createElement('p');
  msg.textContent = text;
  noticeEl.appendChild(msg);

  if(opts.actionLabel){
    var act = document.createElement('button');
    act.type = 'button';
    act.className = 'act';
    act.textContent = opts.actionLabel;
    act.addEventListener('click', function(){
      dismissNotice();
      if(opts.onAction) opts.onAction();
    });
    noticeEl.appendChild(act);
  }

  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'x';
  close.setAttribute('aria-label', t('dismiss'));
  close.textContent = '✕';
  close.addEventListener('click', function(){
    dismissNotice();
    if(opts.onDismiss) opts.onDismiss();
  });
  noticeEl.appendChild(close);

  var col = R.querySelector('.njc-col');
  if(col) col.insertBefore(noticeEl, col.firstChild);
  sizeStage();
}

/* ---------- backup ---------- */
/* Validation, merging and the file format live in src/lib/counter/backup.ts,
   where they are tested. This is the file picker and the alerts. */
on($('#njcExport'), 'click', function(){
  var blob = Backup.makeBackup(Backup.localOnly(S), { sourceId: sourceId, backupId: Storage.newSourceId() });
  var b = new Blob([JSON.stringify(blob, null, 2)], {type:'application/json'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = 'nam-jap-' + todayKey() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1500);
  S.lastBackup = todayKey();
  save();
});
on($('#njcImport'), 'click', function(){ $('#njcFile').click(); });
on($('#njcFile'), 'change', function(){
  var f = this.files[0];
  this.value = '';
  if(!f) return;
  /* A backup file is untrusted: hand-edited, from someone else, or not a backup
     at all. Nothing in it ever runs — it is read as JSON data and every field is
     checked in src/lib/counter/backup.ts — and the file itself is never uploaded.
     A huge file could still freeze the tab, so size is checked before reading. */
  if(f.size > Backup.MAX_FILE_BYTES){ notice(t('fileTooBig'), { tone: 'bad' }); return; }
  var rd = new FileReader();
  rd.onerror = function(){ notice(t('badFile'), { tone: 'bad' }); };
  rd.onload = function(){
    var parsed;
    try{ parsed = Backup.parseBackup(String(rd.result), BLANK, todayKey()); }
    catch(e){ notice(e && e.message === 'too-large' ? t('fileTooBig') : t('badFile'), { tone: 'bad' }); return; }

    /* Merge, never replace. The old import assigned every field straight from
       the file, so restoring a three-month-old backup deleted three months of
       practice. Counts only rise, so taking the larger of the two values can
       only ever add. */
    adoptIfChanged();
    var preview = Backup.mergeBackup(S, parsed.state);
    closeSheet();
    if(!preview.chantsAdded && !preview.daysAdded && !preview.daysRaised && !preview.namesAdded){
      notice(t('importNone'), { tone: 'good' });
      return;
    }

    /* Because counts only rise, whatever a file adds stays — on this device and,
       with Premium, in the account. So say what it adds, and ask. */
    notice(t('importAsk')
      .replace('{chants}', fmt(preview.chantsAdded))
      .replace('{days}', fmt(preview.daysAdded + preview.daysRaised)), {
      actionLabel: t('importYes'),
      onAction: function(){
        // Merged again from the latest state: another tab may have counted
        // while the question was on screen.
        adoptIfChanged();
        var r = Backup.mergeBackup(S, parsed.state);
        if(Storage.tooLarge(r.state)){ notice(t('fileTooBig'), { tone: 'bad' }); return; }
        for(var k in r.state) S[k] = r.state[k];
        if(parsed.meta.backupId){
          var marked = Backup.rememberImport(S, parsed.meta.backupId);
          S.importedBackups = marked.importedBackups;
        }
        save(); flushCold(); boot(true);
        notice(t('imported')
          .replace('{added}', fmt(r.daysAdded))
          .replace('{raised}', fmt(r.daysRaised)), { tone: 'good' });
      }
    });
  };
  rd.readAsText(f);
});

/* ---------- housekeeping ---------- */
/* visibilitychange is the reliable one on mobile; pagehide does not always fire
   when the OS reclaims a backgrounded tab. Both flush the cold half, because
   this may be the last moment before the page is gone. */
on(document, 'visibilitychange', function(){
  if(document.hidden){
    adoptIfChanged();
    tickTime(); markOutbox(); saveTapIfUnsaved(); flushCold(); stopAuto();
    /* The last reliable moment on a phone; keepalive lets the request outlive the page. */
    if(sync) sync.flushNow({ keepalive: true });
  }
  else {
    sessionMark = Date.now();
    if(S.awake || timerInt) wake(true);   // the browser drops the lock whenever the page is hidden
    if(timerInt) tickTimer();             // a timer that ran out while away finishes now, not a second later
    if(linkedTo === null) linkAccount();  // back online, perhaps
    if(sync) sync.maybePull();
  }
});
on(window, 'pagehide', function(){
  adoptIfChanged();
  tickTime(); markOutbox(); saveTapIfUnsaved(); flushCold();
  if(sync) sync.flushNow({ keepalive: true });
});
every(function(){
  adoptIfChanged();
  tickTime();
  /* Time on the mala reaches the outbox without waiting for a tap. */
  if(lastCountAt){ markOutbox(); if(sync) sync.changed(); }
  saveTap(); flushCold();
}, 20000);
every(function(){
  adoptIfChanged();
  /* A rollover closes yesterday. Its record now lives only in the cold half, so
     flush before the hot blob stops carrying it. */
  if(S.lastDay !== todayKey()){ S.lastDay = todayKey(); render(); save(); flushCold(); }
  if(linkedTo === null) linkAccount();      // an account this device could not reach earlier
}, 60000);

/* ---------- language ---------- */
function applyLang(){
  disarm();
  $$('[data-i]').forEach(function(el){ el.textContent = t(el.getAttribute('data-i')); });
  /* Read aloud in the language it is shown in, and the heading above the counter
     follows the same choice. */
  document.documentElement.lang = S.lang === 'hi' ? 'hi' : pageLang;
  var pageSub = document.querySelector('.counter-head p');
  if(pageSub) pageSub.textContent = t('pageSub');
  $$('[data-close]').forEach(function(b){ b.setAttribute('aria-label', t('close')); });
  $('#njcHist').setAttribute('aria-label', t('history'));
  $('#njcLang').textContent = S.lang === 'en' ? 'अ' : 'A';
  $('#njcSearch').placeholder = t('searchPh');
  $('#njcCustom').placeholder = t('customPh');
  $('#njcTargetIn').placeholder = t('targetPh');
  /* B35: a placeholder is not a name; the fields say what they are. */
  $('#njcSearch').setAttribute('aria-label', t('searchPh'));
  $('#njcCustom').setAttribute('aria-label', t('customPh'));
  $('#njcTargetIn').setAttribute('aria-label', t('targetPh'));
  paintFsButton(fauxFs);
  renderLib(); renderTargets(); renderAllList($('#njcSearch').value || ''); render();
}

/* ---------- stage sizing ----------
   The ring is capped by the width AND by the height actually left over, so a
   short phone or a landscape screen never pushes the controls off the fold. */
/* The ring is sized from the room ACTUALLY left over, not from a dvh guess.
   A 320x568 phone has ~80px less than the guess allowed, and the mode chips
   went under the fold. So: lay the column out with no ring at all, measure
   what the rest of the tool costs, and give the ring the remainder. */
var sizing = false, sizeRaf = 0;
/* The last viewport the ring was sized against. On a phone the URL bar slides
   away as you scroll, which fires resize and visualViewport resize and changes
   innerHeight by 60-120px. Re-sizing the ring for that reflows the page under
   the finger and the scroll jumps. So a height-only change is ignored unless
   it is big enough to be a real one: a rotation, a split screen, a keyboard. */
var lastW = 0, lastH = 0;
var CHROME_SLOP = 140;

function viewportChangedEnough(){
  var w = window.innerWidth, h = window.innerHeight;
  if(w !== lastW || Math.abs(h - lastH) > CHROME_SLOP){
    lastW = w; lastH = h;
    return true;
  }
  return false;
}

function sizeStage(){
  // Coalesce to one measurement per frame. The observer, the window resize and
  // the visual viewport all fire for a single rotation.
  // Deliberately a timer, NOT requestAnimationFrame: rAF does not run in a
  // background or hidden tab, and the ring would then never be sized at all.
  if(sizeRaf) return;
  sizeRaf = setTimeout(function(){
    sizeRaf = 0;
    if(sizing) return;            // the observer must not chase its own change
    sizing = true;
    try{ sizeStageInner(); } finally { sizing = false; }
  }, 0);
}
/* The ring is sized by stageSize() in counter-size.js, the same function the
   server HTML runs before the first paint, so the ring is drawn at its real size
   from the start and nothing under it moves when this engine boots. */
function sizeStageInner(){
  var col = R.querySelector('.njc-col');
  if(!col) return;
  var top = col.getBoundingClientRect().top - R.getBoundingClientRect().top;
  R.style.setProperty('--njc-coltop', Math.round(top) + 'px');
  var size = stageSize(R);
  if(size == null) return;
  $('#njcStage').style.setProperty('--stage-px', size + 'px');
}
/* Viewport-driven resizes go through the guard; element-driven ones do not,
   because a column that actually changed width must always be re-measured. */
/* In full screen there is no browser bar to slide, so every resize is real. */
function sizeStageOnViewport(){
  if(R.classList.contains('immersive')){ lastW = window.innerWidth; lastH = window.innerHeight; sizeStage(); return; }
  if(viewportChangedEnough()) sizeStage();
}

on(window, 'resize', sizeStageOnViewport);
// A plain resize listener misses the case where the element is resized without
// the window changing — a sidebar opening, a WordPress theme reflowing, the
// browser pane being dragged. ResizeObserver catches all of it.
if(window.ResizeObserver){
  var roW = 0;
  var ro = new ResizeObserver(function(entries){
    // Only the width matters here. The counter's own height changes as the
    // ring is drawn, and reacting to that is how the observer chases itself.
    var w = Math.round(entries[0].contentRect.width);
    if(w === roW) return;
    roW = w;
    sizeStage();
  });
  ro.observe(R);
}
if(window.visualViewport) on(window.visualViewport, 'resize', sizeStageOnViewport);
if(document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ sizeStage(); render(); });
on(window, 'orientationchange', function(){
  lastW = 0; lastH = 0;               // a rotation always re-measures
  setTimeout(sizeStage, 120);
});

/* ---------- boot ---------- */
function boot(reloaded){
  if(!reloaded) load();
  R.setAttribute('data-theme', S.theme || 'prabhat');
  beadsBuilt = 0;
  sizing = true;
  lastW = window.innerWidth; lastH = window.innerHeight;  // seed the guard
  try{ sizeStageInner(); } finally { sizing = false; }   // synchronous first pass
  applyLang();
  syncMore();
  /* #30: iPhone browsers have no vibration API, so the Haptic switch did nothing
     there. It is shown only where a pulse can actually happen. */
  if(!navigator.vibrate){
    $('#njcHapticChip').hidden = true;
    $$('[data-toggle="vibration"]').forEach(function(b){ b.hidden = true; });
  }
  var savedTimerEnd = 0;
  try{ savedTimerEnd = +localStorage.getItem(TIMER_KEY) || 0; }catch(e){}
  setMode(S.mode === 'down' ? 'down' : 'up');
  if(savedTimerEnd > Date.now()) resumeTimer(savedTimerEnd);
  else { try{ localStorage.removeItem(TIMER_KEY); }catch(e){} }
  if(S.awake) wake(true);
  render();
}
boot();

/* Ask the browser not to evict this origin. iOS clears site data for origins it
   has not seen in a while, and for this app that means deleting someone's
   practice. The browser may refuse; nothing here depends on the answer. */
Storage.requestPersistence();

/* ---------- sync (Premium) ---------- */
/* Only what this device counted from the day it first synced goes up under its
   own id. Earlier days — the outbox has held them since long before Premium — go
   once, under the shared history source, by uploadHistory(). Sending them both
   ways would count them twice on every other device. */
function syncFloor(){ return S.syncFrom || todayKey(); }

var historyInFlight = false;
function uploadHistory(){
  if(!sync || historyInFlight || S.historyUploaded || !S.syncFrom) return;
  historyInFlight = true;
  var entries = [];
  for(var day in S.hist){
    if(day >= S.syncFrom) continue;
    var rec = S.hist[day];
    if(rec.n){
      for(var id in rec.n){
        var v = rec.n[id];
        if(v.c > 0) entries.push({ day: day, naamId: id, c: v.c, r: Math.min(v.r || 0, v.c), s: Math.min(v.s || 0, 86400000), version: 1 });
      }
    } else if(rec.c > 0){
      /* Days recorded before names were tracked: one lump, under a reserved id. */
      entries.push({ day: day, naamId: '_day', c: rec.c, r: Math.min(rec.r || 0, rec.c), s: Math.min(rec.s || 0, 86400000), version: 1 });
    }
  }
  sync.sendHistory(entries).then(function(done){
    historyInFlight = false;
    if(done && sync){ adoptIfChanged(); S.historyUploaded = true; coldDirty = true; flushCold(); sync.pull(); }
  });
}

sync = createSyncClient({
  pending: function(){
    var floor = syncFloor();
    return Outbox.pending(outbox).filter(function(e){ return e.day >= floor; });
  },
  sourceId: function(){ return sourceId; },
  /* Every tab may sync. What goes up is each day's absolute value, merged with
     GREATEST on the server, so two tabs sending the same numbers change nothing.
     But only once this device holds the signed-in account's practice, and only
     while it still does — another tab signing out takes the practice away. */
  canSync: function(){ return linkedTo !== null && S.owner === linkedTo; },
  onResult: function(acks, rejected, rows, days){
    adoptIfChanged();
    var r = Outbox.acknowledge(outbox, watermark, acks);
    outbox = r.outbox; watermark = r.watermark;
    /* Refused for good (a wrong clock, a bad shape): stop resending. The taps stay
       in this device's own history; they just never reach the account. */
    for(var i=0;i<rejected.length;i++) delete outbox[rejected[i].key];
    if(acks.length){
      undoStack = [];                         // confirmed taps are not undoable
      if(!S.syncFrom){
        S.syncFrom = todayKey();
        /* Days before it are history's job now; they never go up as this device. */
        for(var k in outbox) if(outbox[k].day < S.syncFrom) delete outbox[k];
      }
    }
    setOthers(Combine.mergeOthers(others, rows, days));
    /* The account page asks "is this device reaching the account?" (#21). The
       server answered, so it is — whatever it said about individual days. */
    store.setItem(Storage.SYNCED_KEY, String(Date.now()));
    coldDirty = true;
    saveTap(); flushCold(); render();
    uploadHistory();
  },
  onPull: function(rows){
    adoptIfChanged();
    store.setItem(Storage.SYNCED_KEY, String(Date.now()));
    setOthers(Combine.mergeOthers(others, rows, 'all'));
    restoreNameFromHistory();
    coldDirty = true;
    flushCold(); render();
  },
  onNotPremium: function(){ writePremiumFlag(false); }
}, {
  getToken: browserAccessToken,
  fetch: function(u, i){ return window.fetch(u, i); },
  now: function(){ return Date.now(); },
  setTimeout: function(fn, ms){ return window.setTimeout(fn, ms); },
  clearTimeout: function(h){ window.clearTimeout(h); }
});
/* ---------- whose practice (src/lib/counter/account-link.ts) ---------- */
/* Nothing syncs until this device knows the practice it holds is the signed-in
   account's. Deciding can take one pull, and sending first could put a free
   practice into an account that already had one. */
var linkedTo = null, linking = false, linkTries = 0;
var LINK_RETRY_MS = [3000, 10000, 30000];
function signedInHere(){
  try{ return hasSessionCookie(document.cookie, process.env.NEXT_PUBLIC_SUPABASE_URL); }catch(e){ return false; }
}
function reloadStored(){ adoptIfChanged(); undoStack = []; boot(true); }
function pullRows(token){
  return window.fetch('/api/sync/pull/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ sourceId: sourceId })
  }).then(function(res){
    return res.ok ? res.json().then(function(d){ return Array.isArray(d.others) ? d.others : []; }) : null;
  }, function(){ return null; });
}
function claimFor(userId){ S.owner = userId; coldDirty = true; save(); flushCold(); return true; }
function linkAccount(){
  /* One attempt at a time. A pull that fails — offline, a slow server — leaves
     the device unlinked rather than guessing, and the timer below tries again,
     so a counter opened without a network still joins its account later. */
  if(linking || linkedTo !== null) return Promise.resolve();
  linking = true;
  return browserSession().then(function(sess){
    if(!sess || !sync) return false;          // free, or signed out: nothing to link
    adoptIfChanged();
    var decision = AccountLink.decide(S, sess.userId);
    if(decision === 'linked') return true;
    if(decision === 'adopt' || decision === 'claim') return claimFor(sess.userId);
    if(decision === 'switch'){
      AccountLink.startEmptyFor(store, sess.userId, todayKey());
      reloadStored();
      return true;
    }
    /* A practice from before sign-in. An empty account was just bought: the
       practice becomes the account's. An account that already has one keeps it,
       and this device's is set aside for the user to decide. */
    return pullRows(sess.token).then(function(rows){
      if(rows === null || !sync) return false;  // could not ask: nothing is sent; the next visit asks again
      adoptIfChanged();
      if(!rows.length) return claimFor(sess.userId);
      if(!AccountLink.setAside(store, sess.userId, todayKey())) return false;
      reloadStored();
      return true;
    });
  }).then(function(ok){
    linking = false;
    if(!ok){
      /* Could not settle it — offline, or the server was busy. Try again soon
         rather than leaving a signed-in device unlinked for the whole visit. */
      if(sync && signedInHere() && linkTries < LINK_RETRY_MS.length){
        var wait = LINK_RETRY_MS[linkTries++];
        var again = setTimeout(linkAccount, wait);
        teardowns.push(function(){ clearTimeout(again); });
      }
      return;
    }
    if(!sync) return;
    linkedTo = S.owner;
    sync.pull();
    uploadHistory();       // picks up an upload a closed tab left unfinished
    if(Outbox.pending(outbox).length) sync.changed();
    offerStash();
  }, function(){ linking = false; /* no session library, or offline: stay local */ });
}

/* Signing in on a device that has just been handed the account's practice leaves
   the ring asking "choose a name", although the history plainly shows which name
   this person chants. Names are not synced, so pick the most-chanted one that
   this device knows. Never overrides a name the user has already chosen. */
function restoreNameFromHistory(){
  if(S.nameId && (S.nameId !== BLANK.nameId || S.count)) return;
  var H = viewHist(), totals = {}, day, id;
  for(day in H){
    var per = H[day] && H[day].n;
    if(!per) continue;
    for(id in per) totals[id] = (totals[id] || 0) + (per[id].c || 0);
  }
  var all = allNames(), best = null, bestCount = 0;
  for(id in totals){
    if(id === '_day' || totals[id] <= bestCount) continue;
    for(var i = 0; i < all.length; i++){
      if(all[i].id === id){ best = id; bestCount = totals[id]; break; }
    }
  }
  if(!best) return;
  S.nameId = best;
  coldDirty = true;
  save(); flushCold(); renderLib();
}

/* Asked once. Declining keeps the practice on this device, and signing out gives it back. */
function offerStash(){
  var stash = AccountLink.readStash(store);
  if(!stash || stash.askedOn) return;
  var st = AccountLink.stashedState(store);
  var n = st ? AccountLink.chantsIn(st) : 0;
  if(!n){ AccountLink.dropStash(store); return; }
  AccountLink.markStashAsked(store, todayKey());
  clearTimeout(nudgeTimer);
  notice(t('stashAsk').replace('{chants}', fmt(n)), { actionLabel: t('stashAdd'), onAction: addStash });
}
function addStash(){
  browserAccessToken().then(function(token){
    return AccountLink.uploadStash(store, token, function(u, i){ return window.fetch(u, i); });
  }).then(function(done){
    if(!done){
      notice(t('stashFail'), { tone: 'bad', actionLabel: t('stashAdd'), onAction: addStash });
      return;
    }
    adoptIfChanged();
    var st = AccountLink.stashedState(store);
    if(st){ var names = AccountLink.namesFromStash(S, st); S.custom = names.custom; S.favs = names.favs; }
    AccountLink.dropStash(store);
    coldDirty = true; save(); flushCold(); boot(true);
    if(sync) sync.pull();
    notice(t('stashAdded'), { tone: 'good' });
  }, function(){ notice(t('stashFail'), { tone: 'bad', actionLabel: t('stashAdd'), onAction: addStash }); });
}

linkAccount();

/* The storage event fires in every tab except the one that wrote, so each open
   counter shows a tap made in another tab straight away. A null key means the
   storage was cleared. */
on(window, 'storage', function(e){
  if(e.key !== null && e.key !== Storage.REV_KEY) return;
  adoptIfChanged();
});

/* Tried and removed on 2026-09-12: a delayed second read ("reconfirm") to catch
   WebKit serving a stale value across processes. It fixed a cosmetic lag — the
   ring a tap behind after another tab closed — and cost something far worse: the
   re-read could hand this tab an older blob at an arbitrary moment, and the test
   that guards the core invariant (a stale tab must never write over another
   tab's taps) failed twice in twelve runs. The stored number was always right;
   only the ring could lag, and the next tap or visit corrects it. Not worth
   trading data for. */

/* Read it once more, a moment later.
 *
 * WebKit gives each tab its own process and a cross-process localStorage read can
 * be a moment behind, so the value adopted above may already be stale — seen when
 * the other tab CLOSED: this tab had just saved a tap, the closing tab's write
 * woke it, and the read handed back the older total. The stored number was right;
 * only the ring was a tap behind, and nothing woke it again. One delayed re-read
 * settles it, and costs nothing when the value has not moved. */

/* Every control inside the counter acts on the latest saved state: this capture
   listener runs before the control's own click handler. */
on(R, 'click', function(){ adoptIfChanged(); }, true);

/* The sidebar's Library and Settings are sheets this widget owns rather than
   pages of their own — somebody changing their target mid-mala should not have
   to leave the mala to do it. Those links carry a hash, and this is what opens
   it, whether the link was followed from here or from another page.

   The hash is removed once the sheet is up. It described an action, not a
   place; leaving it in the URL would reopen the sheet on every refresh and on
   every step back through history. */
var HASH_SHEETS = { '#library': 'name', '#settings': 'more' };

function openFromHash(){
  var want = HASH_SHEETS[location.hash];
  if(!want) return;
  sheet(want, true);
  try{
    // The router's own state is kept, so it still recognises this entry.
    history.replaceState(history.state, '', location.pathname + location.search);
  }catch(e){ /* a browser that refuses; the sheet is open either way */ }
}

openFromHash();
on(window, 'hashchange', openFromHash);

/* #41: Back closes an open sheet instead of leaving the page. */
on(window, 'popstate', function(){
  if(!openSheet) return;
  sheetInHistory = false;
  closeSheet(true);
});

/* A free counter keeps its practice in this browser and nowhere else. Clearing
   site data, a lost phone, or iOS deciding the origin is stale all end the same
   way, and the user finds out afterwards. So: once there is something worth
   losing, and only if it has been a while, offer the file.

   Shown at most once a month, and never twice in a day — a nag about backups is
   how people learn to dismiss notices without reading them. */
var NUDGE_AFTER_CHANTS = 1000;
var NUDGE_EVERY_DAYS = 30;
/* Where the browser may delete this site's storage on its own: one mala in, and weekly. */
var NUDGE_AFTER_CHANTS_SAFARI = 108;
var NUDGE_EVERY_DAYS_SAFARI = 7;

/* Safari's seven-day storage cap applies to iOS and iPadOS browsers (all of them
   are Safari underneath) and to Safari on the Mac, but not to a site opened from
   the Home Screen. */
function safariMayEvict(){
  try{
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var macSafari = /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
    var standalone = navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return (ios || macSafari) && !standalone;
  }catch(e){ return false; }
}

function daysSince(key){
  if(!key) return Infinity;
  var then = new Date(key + 'T00:00:00');
  if(isNaN(then)) return Infinity;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function maybeNudgeBackup(){
  adoptIfChanged();
  /* #24: a signed-in Premium device syncs; telling it the jap "lives only in this
     browser" would be false. Its own copy is still one tap away in Settings. */
  if(S.owner) return;
  /* Never cover a message the reader is still looking at — an import summary, say. */
  if(noticeEl) return;
  /* #23: Safari on iPhone and iPad deletes a site's storage after about a week
     without a visit, unless the site is on the Home Screen. There the first
     backup is worth asking for after one mala, not after a thousand chants. */
  var evictable = safariMayEvict();
  if((S.lifetime || 0) < (evictable ? NUDGE_AFTER_CHANTS_SAFARI : NUDGE_AFTER_CHANTS)) return;
  if(daysSince(S.lastBackup) < (evictable ? NUDGE_EVERY_DAYS_SAFARI : NUDGE_EVERY_DAYS)) return;
  if(daysSince(S.nudgedOn) < (evictable ? NUDGE_EVERY_DAYS_SAFARI : NUDGE_EVERY_DAYS)) return;

  S.nudgedOn = todayKey();
  save();
  notice(t(evictable ? 'nudgeSafari' : 'nudge'), {
    actionLabel: t('backup'),
    onAction: function(){ $('#njcExport').click(); }
  });
}

/* After the first paint, so the counter is on screen before anything asks for
   the user's attention. */
var nudgeTimer = setTimeout(maybeNudgeBackup, 1200);
teardowns.push(function(){ clearTimeout(nudgeTimer); });

/* Called by React when the widget unmounts. Everything global this engine
   attached comes off, in reverse order. */
return function teardown(){
  if(sync){ sync.stop(); sync = null; }
  stopAuto();
  stopTimer();
  wake(false);
  dismissNotice();
  disarm();
  releaseInert();
  document.documentElement.lang = pageLang;
  for(var i = teardowns.length - 1; i >= 0; i--){
    try{ teardowns[i](); }catch(e){ /* already gone */ }
  }
  teardowns = [];
};
}
