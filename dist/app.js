/**
 * PNS — Pegawai Negeri Strava – app.js
 * Generator file TCX simulasi berbasis rute GPX
 * Data performa adalah simulasi, bukan rekaman perangkat nyata.
 */

'use strict';

/* ============================================================
   STATE GLOBAL
   ============================================================ */
const state = {
  gpx: null,          // { segments, totalDist, points } parsed GPX
  sim: null,          // hasil simulasi terakhir
  varianceSeed: Math.random(),
  map: null,
  routeLayer: null,
  mapLoaded: false,
  chartPace: null,
  chartHr: null,
};

/* ============================================================
   UTILITAS
   ============================================================ */

/** Haversine distance antara dua koordinat [lat, lon] dalam meter */
function haversine([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Format menit:detik dari detik total */
function fmtPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  const secs = Math.round(secPerKm);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** Format durasi HH:MM:SS dari detik */
function fmtDur(secs) {
  secs = Math.round(secs);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format tanggal WIB untuk tampilan */
function fmtDateWIB(utcMs) {
  return new Date(utcMs).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'short', year: 'numeric',
    hour12: false,
  });
}

/** Format waktu WIB singkat HH:MM WIB */
function fmtTimeWIB(utcMs) {
  const t = new Date(utcMs).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const d = new Date(utcMs).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: 'short',
  });
  return `${t} WIB, ${d}`;
}

/** Escape XML */
function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** PRNG sederhana berdasarkan seed untuk reprodusibilitas */
function seededRng(seed) {
  let x=((Math.floor(seed*1e6)^0x9e3779b9)>>>0)||0x6d2b79f5;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};
}

/** Clamp nilai */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ============================================================
   PARSER GPX
   ============================================================ */
function parseGPX(text) {
  const errors = [];

  // Validasi XML
  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(text, 'application/xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) throw new Error('XML tidak valid');
  } catch (e) {
    return { ok: false, error: 'File bukan XML yang valid.' };
  }

  // Namespace
  const ns = doc.documentElement.namespaceURI || '';
  const nsMap = ns ? { ns: ns } : null;

  function qs(el, sel) {
    // coba dengan namespace dan tanpa
    return el.querySelector(sel) ||
      el.getElementsByTagNameNS(ns, sel.replace(/^[^:]+:/, '').replace(/\[.*\]/, '')) ||
      el.getElementsByTagName(sel.split(':').pop())[0];
  }

  function qsAll(el, tag) {
    if (ns) {
      const r = Array.from(el.getElementsByTagNameNS(ns, tag));
      if (r.length) return r;
    }
    return Array.from(el.getElementsByTagName(tag));
  }

  // Ambil semua trkseg
  const segs = qsAll(doc, 'trkseg');
  if (!segs.length) {
    // Coba wpt
    const wpts = qsAll(doc, 'wpt');
    if (!wpts.length) return { ok: false, error: 'File GPX tidak mengandung data rute (trkseg/trkpt).' };
    // Jadikan satu segmen dari wpt
    segs.push({ _wpts: wpts });
  }

  const segments = [];
  let totalDist = 0;
  let totalPts = 0;

  for (const seg of segs) {
    const trkpts = seg._wpts
      ? seg._wpts
      : qsAll(seg, 'trkpt');

    if (!trkpts.length) continue;

    const pts = [];
    for (const tp of trkpts) {
      const lat = parseFloat(tp.getAttribute('lat'));
      const lon = parseFloat(tp.getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

      // Elevasi opsional
      const eleEl = tp.getElementsByTagName('ele')[0];
      const ele = eleEl ? parseFloat(eleEl.textContent) : null;

      pts.push({ lat, lon, ele: (ele !== null && !isNaN(ele)) ? ele : null });
    }

    if (pts.length < 2) continue;

    // Hitung jarak segmen (skip titik duplikat persis)
    let segDist = 0;
    const ptsWithDist = [{ ...pts[0], cumDist: 0 }];
    for (let i = 1; i < pts.length; i++) {
      const d = haversine([pts[i - 1].lat, pts[i - 1].lon], [pts[i].lat, pts[i].lon]);
      if (d < 0.01 && i > 0) continue; // skip duplikat <1cm
      segDist += d;
      ptsWithDist.push({ ...pts[i], cumDist: segDist });
    }

    segments.push({ pts: ptsWithDist, dist: segDist });
    totalDist += segDist;
    totalPts += ptsWithDist.length;
  }

  if (!segments.length) return { ok: false, error: 'Tidak ada data koordinat yang valid dalam file GPX.' };
  if (totalDist < 10) return { ok: false, error: 'Jarak rute terlalu pendek (< 10 meter). Periksa file GPX.' };
  if (totalDist > 500000) return { ok: false, error: 'Jarak rute terlalu jauh (> 500 km). Periksa file GPX.' };

  // Flatten semua titik dengan cumDist absolut
  const allPts = [];
  let baseD = 0;
  for (const [segmentIndex, seg] of segments.entries()) {
    for (const p of seg.pts) {
      allPts.push({ ...p, segmentIndex, cumDist: baseD + p.cumDist });
    }
    baseD += seg.dist;
  }

  return {
    ok: true,
    segments,
    totalDist,
    totalPts,
    allPts,
    segmentCount: segments.length,
  };
}

/* ============================================================
   SIMULASI AKTIVITAS
   ============================================================ */

/**
 * Buat array kecepatan per-meter (m/s) sepanjang rute,
 * dengan variasi acak bertahap dan tren split.
 *
 * Prinsip:
 * - targetSpeed = basePace dalam m/s
 * - split: kecepatan di awal vs akhir berbeda berdasar splitPct
 *   splitPct negatif → akhir lebih cepat (negative split)
 * - variance: perubahan bertahap via noise Perlin-sederhana
 * - rata-rata akhir = targetSpeed dijaga
 */
function simulateSpeeds(totalDist, avgPaceSecPerKm, variancePct, splitPct, seed) {
  const targetSpeed = 1000 / avgPaceSecPerKm; // m/s
  const rng = seededRng(seed * 1e9 | 0);

  // Jumlah sampel: satu per ~5 meter
  const N = Math.max(50, Math.ceil(totalDist / 5));
  const speeds = new Float64Array(N);

  // Buat noise bertahap (moving-average dari random)
  const noiseRaw = new Float64Array(N);
  for (let i = 0; i < N; i++) noiseRaw[i] = rng() * 2 - 1;

  // Smooth noise dengan window
  const winSize = Math.max(10, Math.round(N * 0.04));
  const noise = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - winSize); j <= Math.min(N - 1, i + winSize); j++) {
      sum += noiseRaw[j]; cnt++;
    }
    noise[i] = sum / cnt;
  }

  // Normalisasi noise ke [-1, 1]
  let noiseMax = 0;
  for (let i = 0; i < N; i++) noiseMax = Math.max(noiseMax, Math.abs(noise[i]));
  if (noiseMax > 0) for (let i = 0; i < N; i++) noise[i] /= noiseMax;

  // Faktor split: linier dari (1 + splitHalf) di awal ke (1 - splitHalf) di akhir
  // splitPct negatif → akhir lebih cepat
  const splitHalf = splitPct / 100 * 0.5;

  // Hitung speeds raw
  let sumW = 0;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1); // 0..1
    const splitFactor = 1 + splitHalf * (1 - 2 * t); // awal lebih lambat jika split<0
    // Note: negatif split → akhir lebih cepat → faktor kecepatan lebih besar di akhir
    const varFactor = 1 + (variancePct / 100) * noise[i];
    speeds[i] = targetSpeed * splitFactor * varFactor;
    sumW += speeds[i];
  }

  // Normalisasi untuk mempertahankan rata-rata
  const avgActual = sumW / N;
  const scale = targetSpeed / avgActual;
  let sum2 = 0;
  for (let i = 0; i < N; i++) {
    speeds[i] = Math.max(0.5, speeds[i] * scale); // min 0.5 m/s
    sum2 += speeds[i];
  }
  // Normalisasi kedua (karena clamp)
  const avg2 = sum2 / N;
  const scale2 = targetSpeed / avg2;
  for (let i = 0; i < N; i++) speeds[i] *= scale2;

  return speeds; // per-indeks, bukan per-meter
}

// Smoothed grades stay within continuous GPX runs; missing elevations and segment gaps stay unknown.
const terrainModels=new WeakMap();
function buildTerrainModel(gpx) {
  if(!gpx)return {runs:[],hasElevation:false,complete:false};
  if(terrainModels.has(gpx))return terrainModels.get(gpx);
  const runs=[];let run=null,covered=0;
  for(const point of gpx.allPts){
    if(!Number.isFinite(point.ele)){run=null;continue;}
    const last=run&&run.at(-1);
    if(!last||point.segmentIndex!==last.segmentIndex||point.cumDist<=last.cumDist){run=[];runs.push(run);}
    if(run.length)covered+=point.cumDist-run.at(-1).cumDist;
    run.push(point);
  }
  const model={runs:runs.filter(r=>r.length>=2),hasElevation:covered>0,complete:covered>=gpx.totalDist-.01};
  terrainModels.set(gpx,model);return model;
}
function terrainGradeAtDistance(model,distance) {
  if(!model||!model.runs.length)return null;
  const runs=model.runs;let lo=0,hi=runs.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(runs[mid][0].cumDist<=distance)lo=mid+1;else hi=mid;}
  const run=runs[Math.max(0,lo-1)];
  if(distance<run[0].cumDist||distance>run.at(-1).cumDist)return null;
  const from=Math.max(run[0].cumDist,distance-30),to=Math.min(run.at(-1).cumDist,distance+30);
  if(to-from<1)return null;
  function elevation(d){
    let l=0,h=run.length-1;while(l<h-1){const m=(l+h)>>1;if(run[m].cumDist<=d)l=m;else h=m;}
    const a=run[l],b=run[h],t=(d-a.cumDist)/(b.cumDist-a.cumDist);return a.ele+(b.ele-a.ele)*t;
  }
  return clamp((elevation(to)-elevation(from))/(to-from),-.25,.25);
}
function applyTerrainToSpeeds(speeds,totalDist,avgPaceSecPerKm,terrain) {
  if(!terrain.hasElevation)return speeds;
  const result=new Float64Array(speeds.length);let inverseSum=0;
  for(let i=0;i<speeds.length;i++){
    const grade=terrainGradeAtDistance(terrain,(i+.5)*totalDist/speeds.length);
    const factor=grade===null?1:clamp(Math.exp(-3.5*grade),.65,1.3);
    result[i]=Math.max(.3,speeds[i]*factor);inverseSum+=1/result[i];
  }
  // Equal-distance samples use the harmonic mean: preserve the user's total duration and average pace.
  const scale=(1000/avgPaceSecPerKm)*inverseSum/result.length;
  for(let i=0;i<result.length;i++)result[i]*=scale;
  return result;
}
function syncTerrainOptions() {
  const terrain=buildTerrainModel(state.gpx),available=terrain.hasElevation;
  document.getElementById('paceFollowElevation').disabled=!available;
  document.getElementById('hrFollowElevation').disabled=!available;
  const message=!state.gpx?'Unggah GPX dengan elevasi untuk mengaktifkan opsi elevasi.':
    !available?'GPX ini tidak memiliki data elevasi yang dapat digunakan. Pengaturan biasa tetap berlaku.':
    !terrain.complete?'Data elevasi tersedia sebagian. Opsi hanya bekerja pada bagian yang memiliki data.':
    'Data elevasi tersedia. Opsi mengikuti elevasi bisa diaktifkan.';
  document.getElementById('terrainAvailability').textContent=message;
}

// Seeded synthetic signals: shared effort, lagged HR, and cadence with local rhythm variation.
// These curves are an illustration, not a physiological measurement model.
function calibrateSignal(values,target,min,max,weights,timeWeights) {
  const mean=offset=>{
    let sum=0,time=0;
    for(let i=0;i<values.length;i++){const w=timeWeights[i];sum+=clamp(values[i]+offset*weights[i],min,max)*w;time+=w;}
    return sum/Math.max(time,1e-9);
  };
  let lo=-1000,hi=1000;
  for(let j=0;j<40;j++){const mid=(lo+hi)/2;if(mean(mid)<target)lo=mid;else hi=mid;}
  const offset=(lo+hi)/2;
  return values.map((v,i)=>Math.round(clamp(v+offset*weights[i],min,max)));
}
function generateSensorSignals(points,settings,terrain) {
  const followPace=settings.hrFollowPace===true,followElevation=settings.hrFollowElevation===true&&!!terrain?.hasElevation;
  const hrOn=settings.hrEnabled!==false,cadOn=settings.cadEnabled!==false;
  if(!hrOn&&!cadOn)return;
  const rng=seededRng(settings.seed+17.031),rngCad=seededRng(settings.seed+39.127);
  const duration=points.at(-1).sec||1,baseSpeed=1000/settings.avgPaceSecPerKm;
  const range=Math.max(0,settings.hrMax-settings.hrMin),warmTime=Math.min(85,Math.max(15,duration*.14));
  const hrRaw=[],cadRaw=[],weights=[],timeWeights=[];
  let hr=settings.hrMin+range*.07,hrSlow=0,hrShort=0,cadSlow=0,cadShort=0,slope=0,hrSlope=0,effort=0;
  let regime=0,cadRegime=0,nextRegime=0,nextCadRegime=0;
  const noise=random=>(random()+random()+random()-1.5)*1.4;
  for(let i=0;i<points.length;i++){
    const p=points[i],prev=points[Math.max(0,i-1)],dt=i?Math.max(.001,p.sec-prev.sec):1;
    const next=points[Math.min(points.length-1,i+1)];
    timeWeights.push(Math.max(.0001,(next.sec-prev.sec)/2));
    if(p.sec>=nextRegime){regime=(rng()*2-1);nextRegime=p.sec+35+rng()*80;}
    if(p.sec>=nextCadRegime){cadRegime=(rngCad()*2-1)*2.8;nextCadRegime=p.sec+20+rngCad()*60;}
    const rawGrade=Number.isFinite(p.ele)&&Number.isFinite(prev.ele)&&p.dist>prev.dist
      ?clamp((p.ele-prev.ele)/(p.dist-prev.dist),-.12,.12):0;
    slope+=(rawGrade-slope)*(1-Math.exp(-dt/12));
    effort+=((p.speed/baseSpeed-1)-effort)*(1-Math.exp(-dt/8));
    const hrGrade=followElevation?(terrainGradeAtDistance(terrain,p.dist)??0):0;
    hrSlope+=(hrGrade-hrSlope)*(1-Math.exp(-dt/12));
    const hs=Math.exp(-dt/20),hf=Math.exp(-dt/2.5),cs=Math.exp(-dt/13),cf=Math.exp(-dt/1.8);
    hrSlow=hs*hrSlow+Math.sqrt(1-hs*hs)*noise(rng);
    hrShort=hf*hrShort+Math.sqrt(1-hf*hf)*noise(rng);
    cadSlow=cs*cadSlow+Math.sqrt(1-cs*cs)*noise(rngCad);
    cadShort=cf*cadShort+Math.sqrt(1-cf*cf)*noise(rngCad);
    const drift=range*.07*(p.sec/duration-.4);
    const target=settings.hrAvg+(followPace?effort*23:0)+(followElevation?hrSlope*160:0)+regime*range*.12+hrSlow*range*.09+drift;
    hr+=(target-hr)*(1-Math.exp(-dt/(24+warmTime*.15)));
    hrRaw.push(clamp(hr+hrShort*range*.045,settings.hrMin,settings.hrMax));
    cadRaw.push(settings.cadAvg+(p.speed/baseSpeed-1)*24+slope*38+cadRegime+cadSlow*1.9+cadShort*1.8);
    weights.push(.2+.8*(1-Math.exp(-p.sec/warmTime)));
  }
  const hrs=hrOn?calibrateSignal(hrRaw,settings.hrAvg,settings.hrMin,settings.hrMax,weights,timeWeights):null;
  const cads=cadOn?calibrateSignal(cadRaw,settings.cadAvg,Math.max(60,settings.cadAvg*.83),Math.min(300,settings.cadAvg*1.17),points.map(()=>1),timeWeights):null;
  points.forEach((p,i)=>{p.hr=hrOn?hrs[i]:null;p.cad=cadOn?cads[i]:null;});
}
function timeWeightedMean(points,key) {
  let sum=0,time=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dt=b.sec-a.sec;
    if(Number.isFinite(a[key])&&Number.isFinite(b[key])){sum+=(a[key]+b[key])/2*dt;time+=dt;}
  }
  return time>0?sum/time:0;
}

// Elevation always comes from GPX. Null values and segment gaps stay unknown.
function positionAtDistance(gpx, distance) {
  const pts = gpx.allPts;
  const dist = clamp(distance, 0, gpx.totalDist);
  let lo = 0, hi = pts.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (pts[m].cumDist <= dist) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], span = b.cumDist - a.cumDist;
  if (Math.abs(dist - a.cumDist) < 1e-7) return {lat:a.lat, lon:a.lon, ele:Number.isFinite(a.ele)?a.ele:null};
  if (Math.abs(dist - b.cumDist) < 1e-7) return {lat:b.lat, lon:b.lon, ele:Number.isFinite(b.ele)?b.ele:null};
  const t = span > 0 ? clamp((dist - a.cumDist) / span, 0, 1) : 0;
  const sameSegment = a.segmentIndex === b.segmentIndex;
  return {lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t,
    ele:sameSegment && Number.isFinite(a.ele) && Number.isFinite(b.ele) ? a.ele+(b.ele-a.ele)*t : null};
}
function elevationStats(gpx, start=0, end=gpx.totalDist) {
  let gain=0,loss=0,covered=0;
  const pts=gpx.allPts;
  for(let i=1;i<pts.length;i++) {
    const a=pts[i-1],b=pts[i],span=b.cumDist-a.cumDist;
    if(a.segmentIndex!==b.segmentIndex || span<=0 || !Number.isFinite(a.ele) || !Number.isFinite(b.ele)) continue;
    const overlap=Math.max(0,Math.min(end,b.cumDist)-Math.max(start,a.cumDist));
    const delta=(b.ele-a.ele)*overlap/span;
    covered+=overlap; if(delta>0)gain+=delta;else loss-=delta;
  }
  const length=Math.max(0,end-start),hasElevation=covered>0;
  const a=positionAtDistance(gpx,start).ele,b=positionAtDistance(gpx,end).ele;
  return {gain:hasElevation?gain:null,loss:hasElevation?loss:null,hasElevation,
    complete:hasElevation && covered>=length-0.01,
    delta:hasElevation && Number.isFinite(a)&&Number.isFinite(b)?b-a:null};
}
// Speed anchors: 2024 Adult Compendium, level running. Interpolate between anchors.
function runningMET(paceSecPerKm) {
  const mph=3600/paceSecPerKm/1.609344;
  const anchors=[[3.15,3.3],[4.1,6.5],[4.55,7.8],[5.1,8.5],[5.65,9],[6.15,9.3],[6.7,10.5],[7,11],[7.5,11.8],[8,12],[8.6,12.5],[9,13],[9.45,14.8],[10,14.8],[11,16.8],[12,18.5],[13,19.8],[14,23]];
  if(mph<=anchors[0][0])return anchors[0][1];
  for(let i=1;i<anchors.length;i++){const [speed,met]=anchors[i],[prev,prevMet]=anchors[i-1];if(mph<=speed)return prevMet+(met-prevMet)*(mph-prev)/(speed-prev);}
  return anchors[anchors.length-1][1];
}
function estimateActivityCalories(stats,settings) {
  const kg=Number.isFinite(settings.weightKg)?settings.weightKg:70;
  const age=Number.isFinite(settings.age)?settings.age:30;
  if(settings.hrEnabled!==false && ['m','f'].includes(settings.sex) && Number.isFinite(stats.avgHr)) {
    const kcal=estimateCalories(stats.avgHr,stats.totalDurSec/60,kg,settings.sex,age);
    if(kcal>0)return {kcal,method:'HR + profil (Keytel)'};
  }
  const kcal=Math.max(1,Math.round(runningMET(stats.avgPaceSecPerKm)*3.5*kg/200*stats.totalDurSec/60));
  return {kcal,method:'MET · pace, berat & durasi'};
}

function runSimulation(gpx, settings) {
  const {
    avgPaceSecPerKm, variancePct, splitPct,
    hrMin, hrAvg, hrMax, cadAvg,
    startUtcMs, seed,
  } = settings;

  const totalDist = gpx.totalDist;
  const allPts = gpx.allPts;

  // Buat fungsi interpolasi posisi berdasarkan jarak kumulatif
  // Input: dist 0..totalDist → {lat, lon}
  function interpolatePos(dist) { return positionAtDistance(gpx,dist); }
  const hrEnabled=settings.hrEnabled!==false,cadEnabled=settings.cadEnabled!==false;

  // Simulasikan kecepatan
  const terrain=buildTerrainModel(gpx);
  let speedProfile = simulateSpeeds(totalDist, avgPaceSecPerKm, variancePct, splitPct, seed);
  if(settings.paceFollowElevation===true) speedProfile=applyTerrainToSpeeds(speedProfile,totalDist,avgPaceSecPerKm,terrain);
  const N = speedProfile.length;

  // Simulasikan HR & cadence
  // HR and cadence are generated after time-based trackpoints exist.

  // Bangun trackpoints per-detik
  // Mapping indeks N → jarak via kecepatan kumulatif
  // Total durasi = totalDist / targetSpeed = totalDist * avgPaceSecPerKm / 1000
  const totalDurSec = totalDist * avgPaceSecPerKm / 1000;

  // Hitung timestamp per sampel (sampel berbasis jarak)
  // Setiap sampel i mewakili segmen jarak = totalDist/N
  const distPerSample = totalDist / N;

  // Konversi kecepatan ke waktu per sampel
  const timePerSample = new Float64Array(N);
  let totalTime = 0;
  for (let i = 0; i < N; i++) {
    timePerSample[i] = distPerSample / speedProfile[i];
    totalTime += timePerSample[i];
  }

  // Skala agar total waktu tepat
  const timeScale = totalDurSec / totalTime;

  // Buat trackpoints pada interval waktu 1 detik
  const totalSecs = totalDurSec;
  const trackpoints = [];

  // Buat kurva waktu→jarak
  // cumTime[i] = waktu kumulatif pada akhir sampel i
  const cumTime = new Float64Array(N + 1);
  cumTime[0] = 0;
  for (let i = 0; i < N; i++) {
    cumTime[i + 1] = cumTime[i] + timePerSample[i] * timeScale;
  }

  // Untuk setiap detik, interpolasi posisi & atribut
  function sampleAtTime(tSec) {
    tSec = clamp(tSec, 0, totalDurSec);
    // Binary search indeks sampel
    let lo = 0, hi = N;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cumTime[mid] <= tSec) lo = mid;
      else hi = mid;
    }
    const lo2 = clamp(lo, 0, N - 1);
    const t = cumTime[lo2 + 1] > cumTime[lo2]
      ? (tSec - cumTime[lo2]) / (cumTime[lo2 + 1] - cumTime[lo2])
      : 0;
    const idx = clamp(Math.floor(lo2 + t), 0, N - 1);

    const dist = tSec >= totalDurSec - 1e-9 ? totalDist : clamp(lo2 * distPerSample + t * distPerSample, 0, totalDist);
    const pos = interpolatePos(dist);
    const speed = speedProfile[idx];
    const hr = null;
    const cad = null;
    return { dist, pos, speed, hr, cad };
  }

  // Buat titik per detik (atau setiap N detik untuk rute panjang)
  // Max ~6000 trackpoint untuk performa & ukuran file
  const stepSec = Math.max(1, Math.ceil(totalSecs / 5000));

  for (let sec = 0; sec <= totalSecs; sec += stepSec) {
    const s = Math.min(sec, totalSecs);
    const { dist, pos, speed, hr, cad } = sampleAtTime(s);
    const utcMs = startUtcMs + s * 1000;
    trackpoints.push({ sec: s, utcMs, dist, lat: pos.lat, lon: pos.lon, ele: pos.ele, speed, hr, cad });
  }

  // Pastikan titik terakhir ada persis di akhir
  if (trackpoints[trackpoints.length - 1].sec < totalSecs) {
    const { dist, pos, speed, hr, cad } = sampleAtTime(totalSecs);
    trackpoints.push({ sec: totalSecs, utcMs: startUtcMs + totalSecs * 1000, dist, lat: pos.lat, lon: pos.lon, ele: pos.ele, speed, hr, cad });
  }

  generateSensorSignals(trackpoints,settings,terrain);

  // Hitung split per km
  const splits = [];
  const kmStep = 1000; // 1 km per split
  let kmIdx = 1;
  let prevSplitSec = 0;
  let prevSplitDist = 0;

  for (const tp of trackpoints) {
    while (tp.dist >= kmIdx * kmStep && kmIdx * kmStep <= totalDist) {
      // Interpolasi waktu persis di batas km
      const targetDist = kmIdx * kmStep;
      // Sudah melewati, interpolasi
      const prevTp = trackpoints[trackpoints.indexOf(tp) - 1] || tp;
      const frac = prevTp.dist < tp.dist
        ? (targetDist - prevTp.dist) / (tp.dist - prevTp.dist)
        : 0;
      const splitSec = prevTp.sec + (tp.sec - prevTp.sec) * frac;
      const durSec = splitSec - prevSplitSec;
      const distKm = (targetDist - prevSplitDist) / 1000;
      const paceSecPerKm = durSec / distKm;

      splits.push({
        km: kmIdx,
        distM: targetDist - prevSplitDist,
        durSec,
        paceSecPerKm,
      });

      prevSplitSec = splitSec;
      prevSplitDist = targetDist;
      kmIdx++;
    }
  }

  // Sisa setelah km terakhir
  const lastDist = totalDist;
  if (lastDist > prevSplitDist + 1) {
    const durSec = totalSecs - prevSplitSec;
    const distKm = (lastDist - prevSplitDist) / 1000;
    const paceSecPerKm = distKm > 0 ? durSec / distKm : 0;
    splits.push({
      km: `${(prevSplitDist / 1000).toFixed(1)}–${(lastDist / 1000).toFixed(2)}`,
      distM: lastDist - prevSplitDist,
      durSec,
      paceSecPerKm,
      isPartial: true,
    });
  }

  // Statistik aktual
  let hrSum = 0, hrMin2 = Infinity, hrMax2 = -Infinity, cadSum = 0;
  for (const tp of trackpoints) {
    hrSum += tp.hr; hrMin2 = Math.min(hrMin2, tp.hr); hrMax2 = Math.max(hrMax2, tp.hr);
    cadSum += tp.cad;
  }
  const stats = {
    totalDist,
    totalDurSec,
    avgPaceSecPerKm,
    avgHr: hrEnabled ? Math.round(timeWeightedMean(trackpoints,'hr')) : null,
    minHr: hrEnabled ? hrMin2 : null,
    maxHr: hrEnabled ? hrMax2 : null,
    avgCad: cadEnabled ? Math.round(timeWeightedMean(trackpoints,'cad')) : null,
    maxCad: cadEnabled ? Math.max(...trackpoints.map(p=>p.cad)) : null,
    hrEnabled,cadEnabled,
    elevation: elevationStats(gpx),
  };

  stats.calories=estimateActivityCalories(stats,settings);
  let from=0;
  for(const split of splits){
    split.elevation=elevationStats(gpx,from,from+split.distM);
    const points=trackpoints.filter(p=>p.dist>=from && p.dist<=from+split.distM);
    split.avgHr=hrEnabled && points.length ? Math.round(points.reduce((n,p)=>n+p.hr,0)/points.length) : null;
    from+=split.distM;
  }
  return { trackpoints, splits, stats };
}


/**
 * Estimasi kalori menggunakan formula berbasis HR (Keytel et al., 2005).
 * Laki-laki:   kcal/min = (-55.0969 + 0.6309×HR + 0.1988×BB + 0.2017×usia) / 4.184
 * Perempuan:   kcal/min = (-20.4022 + 0.4472×HR − 0.1263×BB + 0.0740×usia) / 4.184
 */
function estimateCalories(avgHr, durationMin, weightKg, sex, age = 30) {
  let kcalPerMin;
  if (sex === 'f') {
    kcalPerMin = (-20.4022 + 0.4472 * avgHr - 0.1263 * weightKg + 0.0740 * age) / 4.184;
  } else {
    kcalPerMin = (-55.0969 + 0.6309 * avgHr + 0.1988 * weightKg + 0.2017 * age) / 4.184;
  }
  return Math.round(Math.max(0, kcalPerMin) * durationMin);
}
/* ============================================================
   GENERATOR TCX
   ============================================================ */
function generateTCX(sim, settings) {
  const {trackpoints,stats}=sim;
  const hrEnabled=settings.hrEnabled!==false && stats.hrEnabled!==false;
  const cadEnabled=settings.cadEnabled!==false && stats.cadEnabled!==false;
  const startIso=new Date(settings.startUtcMs).toISOString();
  const calories=stats.calories || estimateActivityCalories(stats,settings);
  if(calories.kcal>65535)throw new Error('Estimasi kalori melebihi batas format TCX (65.535 kcal). Kurangi jarak atau periksa berat badan.');
  const version='<Version><VersionMajor>0</VersionMajor><VersionMinor>0</VersionMinor></Version>';
  const lines=[`<?xml version="1.0" encoding="UTF-8"?>`,
    '<!-- PNS — Pegawai Negeri Strava. Data simulasi, bukan rekaman perangkat nyata. -->',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ae="http://www.garmin.com/xmlschemas/ActivityExtension/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<Activities><Activity Sport="Running">',`<Id>${startIso}</Id>`,`<Lap StartTime="${startIso}">`,
    `<TotalTimeSeconds>${stats.totalDurSec.toFixed(3)}</TotalTimeSeconds>`,
    `<DistanceMeters>${stats.totalDist.toFixed(3)}</DistanceMeters>`,
    `<MaximumSpeed>${Math.max(...trackpoints.map(p=>p.speed)).toFixed(6)}</MaximumSpeed>`,
    `<Calories>${calories.kcal}</Calories>`];
  if(hrEnabled)lines.push(`<AverageHeartRateBpm><Value>${stats.avgHr}</Value></AverageHeartRateBpm>`,`<MaximumHeartRateBpm><Value>${stats.maxHr}</Value></MaximumHeartRateBpm>`);
  lines.push('<Intensity>Active</Intensity>');
  if(cadEnabled)lines.push(`<Cadence>${Math.round(stats.avgCad/2)}</Cadence>`);
  lines.push('<TriggerMethod>Manual</TriggerMethod>','<Track>');
  for(const tp of trackpoints){
    lines.push('<Trackpoint>',`<Time>${new Date(tp.utcMs).toISOString()}</Time>`,
      `<Position><LatitudeDegrees>${tp.lat.toFixed(8)}</LatitudeDegrees><LongitudeDegrees>${tp.lon.toFixed(8)}</LongitudeDegrees></Position>`);
    if(Number.isFinite(tp.ele))lines.push(`<AltitudeMeters>${tp.ele.toFixed(3)}</AltitudeMeters>`);
    lines.push(`<DistanceMeters>${tp.dist.toFixed(3)}</DistanceMeters>`);
    if(hrEnabled)lines.push(`<HeartRateBpm><Value>${tp.hr}</Value></HeartRateBpm>`);
    if(cadEnabled)lines.push(`<Cadence>${Math.round(tp.cad/2)}</Cadence>`);
    lines.push(`<Extensions><ae:TPX><ae:Speed>${tp.speed.toFixed(6)}</ae:Speed>`);
    if(cadEnabled)lines.push(`<ae:RunCadence>${Math.round(tp.cad/2)}</ae:RunCadence>`);
    lines.push('</ae:TPX></Extensions>','</Trackpoint>');
  }
  lines.push('</Track>',`<Extensions><ae:LX><ae:AvgSpeed>${(1000/settings.avgPaceSecPerKm).toFixed(6)}</ae:AvgSpeed>`);
  if(cadEnabled)lines.push(`<ae:AvgRunCadence>${Math.round(stats.avgCad/2)}</ae:AvgRunCadence>`);
  lines.push('</ae:LX></Extensions>','</Lap>',`<Notes>${xmlEsc(settings.runName||'Lari Pagi')}${settings.runDesc?' — '+xmlEsc(settings.runDesc):''} | Data simulasi PNS; bukan rekaman perangkat nyata.</Notes>`,
    `<Creator xsi:type="Device_t"><Name>Amazfit Active Edge</Name><UnitId>0</UnitId><ProductID>0</ProductID>${version}</Creator>`,
    '</Activity></Activities>',
    '<Author xsi:type="Application_t"><Name>PNS — Pegawai Negeri Strava – Simulated Activity Generator</Name><Build><Version><VersionMajor>2</VersionMajor><VersionMinor>0</VersionMinor></Version></Build><LangID>ID</LangID><PartNumber>PNS-00000-02</PartNumber></Author>',
    '</TrainingCenterDatabase>');
  return lines.join('\n');
}

/* ============================================================
   UI – TEMA
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('pns-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('pns-theme', theme);
  const sun = document.getElementById('iconSun');
  const moon = document.getElementById('iconMoon');
  if (theme === 'dark') {
    sun.style.display = 'block';
    moon.style.display = 'none';
  } else {
    sun.style.display = 'none';
    moon.style.display = 'block';
  }
  // Update slider warna setelah tema ganti
  updateSliderBg(document.getElementById('paceVar'));
  updateSliderBg(document.getElementById('paceSplit'));
  if(state.sim)drawCharts(state.sim);
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

function updateSliderBg(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const val = Number(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, #F36C21 0%, #F36C21 ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

/* ============================================================
   UI – SLIDER
   ============================================================ */
function initSliders() {
  const paceVar = document.getElementById('paceVar');
  const paceSplit = document.getElementById('paceSplit');
  const varLabel = document.getElementById('varLabel');
  const splitLabel = document.getElementById('splitLabel');

  function updateVar() {
    varLabel.textContent = `${paceVar.value}%`;
    updateSliderBg(paceVar);
    scheduleUpdate();
  }
  function updateSplit() {
    const v = Number(paceSplit.value);
    splitLabel.textContent = v === 0 ? '0%' : (v < 0 ? `−${Math.abs(v)}%` : `+${v}%`);
    updateSliderBg(paceSplit);
    scheduleUpdate();
  }

  paceVar.addEventListener('input', updateVar);
  paceSplit.addEventListener('input', updateSplit);
  updateVar(); updateSplit();
}

/* ============================================================
   UI – DEVICE SELECTOR
   ============================================================ */
function initDeviceSelector() {
  const radios = document.querySelectorAll('input[name="device"]');
  radios.forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('devAmazfit').classList.toggle('active', document.getElementById('radioAmazfit').checked);
    });
  });
}

/* ============================================================
   UI – DEFAULT DATE
   ============================================================ */
function initDefaults() {
  const today = new Date();
  // Format YYYY-MM-DD
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('runDate').value = `${yyyy}-${mm}-${dd}`;
}

/* ============================================================
   UI – GPX UPLOAD
   ============================================================ */
function initGpxUpload() {
  const dropZone = document.getElementById('dropZone');
  const gpxInput = document.getElementById('gpxInput');
  const btnChange = document.getElementById('btnChangeGpx');

  dropZone.addEventListener('click', () => gpxInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') gpxInput.click(); });
  gpxInput.addEventListener('change', e => {
    if (e.target.files[0]) loadGpxFile(e.target.files[0]);
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) loadGpxFile(f);
  });

  btnChange.addEventListener('click', e => {
    e.stopPropagation();
    gpxInput.value = '';
    gpxInput.click();
  });
}

function loadGpxFile(file) {
  const errEl = document.getElementById('gpxError');
  errEl.style.display = 'none';

  if (!file.name.toLowerCase().endsWith('.gpx')) {
    showGpxError('File harus berekstensi .gpx'); return;
  }
  if (file.size === 0) {
    showGpxError('File kosong.'); return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showGpxError('File terlalu besar (maks 10 MB).'); return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const result = parseGPX(text);
    if (!result.ok) {
      showGpxError(result.error);
      return;
    }
    state.gpx = result;
    showGpxInfo(file.name, result);
    window.PNSPortal?.saveRoute({filename:file.name,distance:result.totalDist,points:result.allPts.length}).catch(error=>{const message=document.getElementById('downloadStatus');message.textContent='Rute siap, tetapi riwayat belum tersimpan: '+error.message;message.hidden=false;});
    renderMap(result);
    state.varianceSeed = Math.random();
    scheduleUpdate();
  };
  reader.onerror = () => showGpxError('Gagal membaca file.');
  reader.readAsText(file);
}

function showGpxError(msg) {
  const errEl = document.getElementById('gpxError');
  errEl.textContent = `⚠ ${msg}`;
  errEl.style.display = 'block';
  document.getElementById('gpxInfo').style.display = 'none';
  state.gpx = null;state.sim=null;
  document.getElementById('summaryContent').style.display='none';document.getElementById('summaryEmpty').style.display='block';
  document.querySelector('#summaryEmpty p').textContent='Unggah GPX yang valid untuk melihat pratinjau.';
  document.getElementById('map').style.display='none';document.getElementById('mapFallback').style.display='none';document.getElementById('mapEmpty').style.display='flex';
  updateActionButtons();
}

function showGpxInfo(filename, gpx) {
  document.getElementById('gpxFileName').textContent = filename;
  document.getElementById('gpxPoints').textContent = gpx.totalPts.toLocaleString('id-ID');
  document.getElementById('gpxDist').textContent = (gpx.totalDist / 1000).toFixed(3);
  document.getElementById('gpxSegs').textContent = gpx.segmentCount;
  document.getElementById('gpxInfo').style.display = 'block';
  document.getElementById('gpxError').style.display = 'none';
}

/* ============================================================
   PETA
   ============================================================ */
function renderMap(gpx) {
  const mapEl = document.getElementById('map');
  const mapEmpty = document.getElementById('mapEmpty');
  const mapFallback = document.getElementById('mapFallback');

  mapEmpty.style.display = 'none';

  // Ambil semua koordinat
  const latlngs = gpx.allPts.map(p => [p.lat, p.lon]);

  if (typeof L === 'undefined') {
    // Leaflet tidak tersedia, gambar SVG fallback
    renderFallbackMap(gpx, latlngs);
    return;
  }

  mapEl.style.display = 'block';
  mapFallback.style.display = 'none';

  if (state.map) {
    // Reset peta yang sudah ada
    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    state.routeLayer = L.polyline(latlngs, {
      color: '#F36C21', weight: 4, opacity: .9,
    }).addTo(state.map);
    state.map.fitBounds(state.routeLayer.getBounds(), { padding: [20, 20] });
    return;
  }

  try {
    state.map = L.map('map', { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(state.map);

    state.routeLayer = L.polyline(latlngs, {
      color: '#F36C21', weight: 4, opacity: .9,
    }).addTo(state.map);
    state.map.fitBounds(state.routeLayer.getBounds(), { padding: [20, 20] });
    state.mapLoaded = true;
  } catch (err) {
    console.warn('Leaflet error, fallback ke canvas:', err);
    renderFallbackMap(gpx, latlngs);
  }
}

function renderFallbackMap(gpx, latlngs) {
  document.getElementById('map').style.display = 'none';
  const fb = document.getElementById('mapFallback');
  fb.style.display = 'block';
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const W = fb.clientWidth || 400;
  const H = 280;
  canvas.width = W;
  canvas.height = H;

  const lats = latlngs.map(p => p[0]);
  const lons = latlngs.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const pad = 20;

  function toXY([lat, lon]) {
    const x = pad + (lon - minLon) / (maxLon - minLon + 1e-9) * (W - pad * 2);
    const y = H - pad - (lat - minLat) / (maxLat - minLat + 1e-9) * (H - pad * 2);
    return [x, y];
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  ctx.fillStyle = isDark ? '#2A2D2A' : '#E8EAE8';
  ctx.fillRect(0, 0, W, H);

  ctx.beginPath();
  for (let i = 0; i < latlngs.length; i++) {
    const [x, y] = toXY(latlngs[i]);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#F36C21';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Titik awal
  const [sx, sy] = toXY(latlngs[0]);
  ctx.beginPath();
  ctx.arc(sx, sy, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#F36C21';
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ============================================================
   GRAFIK
   ============================================================ */
function sampleTrackpointAtDistance(sim,distance) {
  const pts=sim.trackpoints,d=clamp(distance,0,sim.stats.totalDist);
  let lo=0,hi=pts.length-1;
  while(lo<hi-1){const m=(lo+hi)>>1;if(pts[m].dist<=d)lo=m;else hi=m;}
  const a=pts[lo],b=pts[hi],t=b.dist>a.dist?clamp((d-a.dist)/(b.dist-a.dist),0,1):0;
  const lerp=k=>Number.isFinite(a[k])&&Number.isFinite(b[k])?a[k]+(b[k]-a[k])*t:null;
  return {dist:d,sec:lerp('sec'),speed:lerp('speed'),hr:lerp('hr'),cad:lerp('cad')};
}
function drawCharts(sim) {
  const pts=sim.trackpoints;
  drawActivityChart('chartPace',pts,p=>p.speed>0?1000/p.speed:null,'#f36c21',fmtPace,true);
  drawActivityChart('chartElevation',pts,p=>p.ele,'#c9a74e',v=>`${Math.round(v)} m`);
  if(sim.stats.hrEnabled)drawActivityChart('chartHr',pts,p=>p.hr,'#ef6268',v=>`${Math.round(v)}`);
  if(sim.stats.cadEnabled)drawActivityChart('chartCadence',pts,p=>p.cad,'#e589ba',v=>`${Math.round(v)}`);
  updateChartOverlays();
}
function drawActivityChart(id,points,value,color,format,invert=false) {
  const canvas=document.getElementById(id);
  if(!canvas||canvas.closest('[hidden]'))return;
  const ctx=canvas.getContext('2d'),W=Math.max(240,canvas.clientWidth||400),H=150;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.scale(dpr,dpr);
  const pad={l:37,r:10,t:12,b:25},cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
  const style=getComputedStyle(canvas.closest('.activity-preview'));
  const grid=style.getPropertyValue('--plot-grid').trim(),muted=style.getPropertyValue('--preview-muted').trim();
  const valid=points.map(value).filter(Number.isFinite);
  ctx.clearRect(0,0,W,H);
  if(!valid.length){canvas._plotGeometry=null;ctx.fillStyle=muted;ctx.font='10px Arial';ctx.textAlign='center';ctx.fillText('GPX tanpa data elevasi',W/2,H/2);return;}
  const low=Math.min(...valid),high=Math.max(...valid),margin=Math.max((high-low)*.12,invert?4:2);
  const min=low-margin,max=high+margin,total=points[points.length-1].dist||1;
  const x=d=>pad.l+d/total*cW;
  const y=v=>pad.t+(invert?(v-min)/(max-min):1-(v-min)/(max-min))*cH;
  ctx.lineWidth=1;ctx.font='10px Arial';ctx.textAlign='right';
  for(let i=0;i<=3;i++){
    const v=min+(max-min)*i/3,yy=y(v);
    ctx.strokeStyle=grid;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(W-pad.r,yy);ctx.stroke();
    ctx.fillStyle=muted;ctx.fillText(format(v),pad.l-7,yy+4);
  }
  const stride=Math.max(1,Math.ceil(points.length/650));
  const sampled=points.filter((p,i)=>i%stride===0||i===points.length-1);
  let group=[];
  function paintGroup(){
    if(!group.length)return;
    ctx.beginPath();group.forEach((p,i)=>i?ctx.lineTo(x(p.dist),y(value(p))):ctx.moveTo(x(p.dist),y(value(p))));
    ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.stroke();
    ctx.lineTo(x(group[group.length-1].dist),H-pad.b);ctx.lineTo(x(group[0].dist),H-pad.b);ctx.closePath();
    ctx.globalAlpha=.17;ctx.fillStyle=color;ctx.fill();ctx.globalAlpha=1;group=[];
  }
  for(const p of sampled){if(Number.isFinite(value(p)))group.push(p);else paintGroup();}paintGroup();
  ctx.fillStyle=muted;ctx.font='10px Arial';
  const ticks=W<340?3:4;
  for(let i=0;i<=ticks;i++){
    const d=total*i/ticks;ctx.textAlign=i===0?'left':i===ticks?'right':'center';
    ctx.fillText(total<1000?`${Math.round(d)} m`:`${(d/1000).toFixed(1)} km`,x(d),H-7);
  }
  canvas._plotGeometry={pad,W,H,min,max,total,invert,color};
}
let chartDistance=0;
function setChartDistance(distance) {
  if(!state.sim)return;
  chartDistance=clamp(Number(distance)||0,0,state.sim.stats.totalDist);
}
let chartHover=null;
let chartSelectionActive=false;
const chartIds=['chartPace','chartElevation','chartHr','chartCadence'];
function updateChartOverlays() {
  if(!state.sim||!state.gpx)return;
  const distance=chartDistance;
  const point=sampleTrackpointAtDistance(state.sim,distance),ele=positionAtDistance(state.gpx,distance).ele;
  const series={chartPace:{name:'Pace',value:1000/point.speed,text:`${fmtPace(1000/point.speed)} /km`},
    chartElevation:{name:'Elevasi',value:ele,text:Number.isFinite(ele)?`${ele.toFixed(1)} m`:'Tidak tersedia'},
    chartHr:{name:'Heart rate',value:point.hr,text:`${Math.round(point.hr)} bpm`},
    chartCadence:{name:'Cadence',value:point.cad,text:`${Math.round(point.cad)} spm`}};
  for(const id of chartIds){
    const canvas=document.getElementById(id),frame=canvas.parentElement,geometry=canvas._plotGeometry;
    const cursor=frame.querySelector('.chart-crosshair'),tooltip=frame.querySelector('.chart-tooltip');
    const active=!!chartHover && chartHover.id===id;
    if(!geometry||canvas.closest('[hidden]')||(!chartSelectionActive&&!chartHover)){cursor.hidden=true;tooltip.hidden=true;continue;}
    const {pad,W,H,min,max,total,invert,color}=geometry;
    const x=pad.l+clamp(distance/total,0,1)*(W-pad.l-pad.r);
    const data=series[id],hasValue=Number.isFinite(data.value);
    const y=hasValue?pad.t+(invert?(data.value-min)/(max-min):1-(data.value-min)/(max-min))*(H-pad.t-pad.b):pad.t+35;
    cursor.hidden=false;cursor.style.left=`${x}px`;cursor.style.setProperty('--series-color',color);
    const dot=cursor.querySelector('i');dot.hidden=!hasValue;dot.style.top=`${clamp(y-pad.t,0,H-pad.t-pad.b)}px`;
    tooltip.hidden=!active;
    if(active){
      const distText=state.sim.stats.totalDist<1000?`${Math.round(distance)} m`:`${(distance/1000).toFixed(2)} km`;
      tooltip.innerHTML=`<span>${data.name}</span><strong>${data.text}</strong><small>${distText} · ${fmtDur(point.sec)}</small>`;
      const tipWidth=tooltip.offsetWidth||130;
      tooltip.style.left=`${clamp(x-tipWidth/2,2,W-tipWidth-2)}px`;
      tooltip.style.top=`${clamp(y-72,3,H-70)}px`;
    }
  }
}
function initPreviewControls() {
  const syncSensors=()=>{
    document.getElementById('hrFields').disabled=!document.getElementById('hrEnabled').checked;
    document.getElementById('cadFields').disabled=!document.getElementById('cadEnabled').checked;
    syncTerrainOptions();
    scheduleUpdate();
  };
  ['hrEnabled','cadEnabled'].forEach(id=>document.getElementById(id).addEventListener('change',syncSensors));syncSensors();
  ['paceFollowElevation','hrFollowPace','hrFollowElevation'].forEach(id=>document.getElementById(id).addEventListener('change',scheduleUpdate));
  let frame=null,pending=null;
  const fromPointer=(id,e)=>{
    if(!state.sim)return;
    pending={id,x:e.clientX};
    if(frame!==null)return;
    frame=requestAnimationFrame(()=>{
      frame=null;if(!pending||!state.sim)return;
      const {id,x}=pending;pending=null;
      const canvas=document.getElementById(id),rect=canvas.getBoundingClientRect(),g=canvas._plotGeometry;
      if(!g)return;
      const fraction=clamp((x-rect.left-g.pad.l)/(rect.width-g.pad.l-g.pad.r),0,1);
      chartHover={id};chartSelectionActive=true;
      setChartDistance(Math.round(fraction*state.sim.stats.totalDist));updateChartOverlays();
    });
  };
  for(const id of chartIds){
    const canvas=document.getElementById(id);canvas.setAttribute('aria-describedby',id+'Tooltip');
    canvas.addEventListener('pointermove',e=>fromPointer(id,e));
    canvas.addEventListener('pointerdown',e=>fromPointer(id,e));
    const leave=()=>{pending=null;chartHover=null;chartSelectionActive=false;updateChartOverlays();};
    canvas.addEventListener('pointerleave',leave);canvas.addEventListener('pointercancel',leave);canvas.addEventListener('blur',leave);
    canvas.addEventListener('keydown',e=>{
      if(!state.sim)return;
      const step=e.shiftKey?100:1;let distance=chartDistance;
      if(e.key==='ArrowRight')distance+=step;else if(e.key==='ArrowLeft')distance-=step;
      else if(e.key==='Home')distance=0;else if(e.key==='End')distance=state.sim.stats.totalDist;else return;
      e.preventDefault();chartHover={id};chartSelectionActive=true;setChartDistance(distance);updateChartOverlays();
    });
  }
  if(typeof ResizeObserver!=='undefined'){
    let previousWidth=-1;
    const observer=new ResizeObserver(entries=>{
      const width=entries[0].contentRect.width;
      if(width===previousWidth)return;previousWidth=width;
      if(width<=0)return;
      requestAnimationFrame(()=>{
        if(document.getElementById('previewBody').hidden)return;
        if(state.map){state.map.invalidateSize();if(state.routeLayer)state.map.fitBounds(state.routeLayer.getBounds(),{padding:[20,20]});}
        if(state.sim)drawCharts(state.sim);
      });
    });
    observer.observe(document.getElementById('previewBody'));
  }
  document.getElementById('previewToggle').addEventListener('click',()=>{
    const button=document.getElementById('previewToggle'),open=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(open));document.getElementById('previewBody').hidden=!open;
    chartHover=null;chartSelectionActive=false;
    if(open)requestAnimationFrame(()=>{if(state.map)state.map.invalidateSize();if(state.gpx)renderMap(state.gpx);if(state.sim)drawCharts(state.sim);});
  });
}

function getSettings() {
  const paceMin = Number(document.getElementById('paceMin').value) || 7;
  const paceSec = Number(document.getElementById('paceSec').value);
  const avgPaceSecPerKm = paceMin * 60 + clamp(paceSec, 0, 59);

  const dateVal = document.getElementById('runDate').value; // YYYY-MM-DD
  const timeVal = document.getElementById('runTime').value || '07:30'; // HH:MM
  const [hh, mm2] = timeVal.split(':').map(Number);

  // Konversi WIB (UTC+7) ke UTC
  let startUtcMs;
  if (dateVal) {
    const [y, mo, d] = dateVal.split('-').map(Number);
    // WIB = UTC+7, jadi UTC = waktu lokal - 7 jam
    const wibMs = Date.UTC(y, mo - 1, d, hh, mm2, 0);
    startUtcMs = wibMs - 7 * 3600 * 1000;
  } else {
    startUtcMs = Date.now() - 7 * 3600 * 1000;
  }

  return {
    avgPaceSecPerKm,
    weightKg: Number(document.getElementById('weightKg').value),
    age: Number(document.getElementById('age').value),
    sex: document.getElementById('sex').value,
    hrEnabled: document.getElementById('hrEnabled').checked,
    hrFollowPace: document.getElementById('hrEnabled').checked && document.getElementById('hrFollowPace').checked,
    hrFollowElevation: document.getElementById('hrEnabled').checked && !document.getElementById('hrFollowElevation').disabled && document.getElementById('hrFollowElevation').checked,
    paceFollowElevation: !document.getElementById('paceFollowElevation').disabled && document.getElementById('paceFollowElevation').checked,
    cadEnabled: document.getElementById('cadEnabled').checked,
    variancePct: Number(document.getElementById('paceVar').value),
    splitPct: Number(document.getElementById('paceSplit').value),
    hrMin: Number(document.getElementById('hrMin').value),
    hrAvg: Number(document.getElementById('hrAvg').value),
    hrMax: Number(document.getElementById('hrMax').value),
    cadAvg: Number(document.getElementById('cadAvg').value),
    device: document.querySelector('input[name="device"]:checked').value,
    runName: document.getElementById('runName').value.trim() || 'Lari Pagi',
    runDesc: document.getElementById('runDesc').value.trim(),
    startUtcMs,
    seed: state.varianceSeed,
  };
}

function validateSettings(settings) {
  const e=[];
  const finite=Number.isFinite;
  if(!finite(settings.weightKg)||settings.weightKg<25||settings.weightKg>300)e.push('Berat badan harus 25–300 kg.');
  if(!finite(settings.age)||settings.age<18||settings.age>100||!Number.isInteger(settings.age))e.push('Usia harus 18–100 tahun.');
  if(!finite(settings.avgPaceSecPerKm)||settings.avgPaceSecPerKm<180||settings.avgPaceSecPerKm>1259)e.push('Pace harus antara 3:00 dan 20:59 /km.');
  if(!finite(settings.startUtcMs))e.push('Tanggal dan waktu mulai harus valid.');
  if(settings.hrEnabled!==false){
    if(![settings.hrMin,settings.hrAvg,settings.hrMax].every(n=>finite(n)&&n>=40&&n<=220))e.push('HR harus 40–220 bpm.');
    if(settings.hrMin>settings.hrAvg||settings.hrAvg>settings.hrMax)e.push('HR minimum ≤ rata-rata ≤ maksimum.');
  }
  if(settings.cadEnabled!==false&&(!finite(settings.cadAvg)||settings.cadAvg<100||settings.cadAvg>250))e.push('Cadence harus 100–250 langkah/menit.');
  return e;
}

let _updateTimer = null;
function scheduleUpdate() {
  clearTimeout(_updateTimer);
  _updateTimer = setTimeout(doUpdate, 150);
}

function doUpdate(keepSeed = true) {
  if (!keepSeed) state.varianceSeed = Math.random();

  syncTerrainOptions();
  const settings = getSettings();
  const hrErr = document.getElementById('hrError');

  const valErrors = validateSettings(settings);
  if (valErrors.length) {
    hrErr.textContent = valErrors.join(' ');
    hrErr.style.display = 'block';
  } else {
    hrErr.style.display = 'none';
  }

  if (!state.gpx || valErrors.length) {
    state.sim=null;
    document.getElementById('summaryContent').style.display='none';
    document.getElementById('summaryEmpty').style.display='block';
    document.querySelector('#summaryEmpty p').textContent=valErrors.length?'Perbaiki isian untuk memperbarui pratinjau.':'Unggah GPX untuk melihat pratinjau aktivitas.';
    updateActionButtons();
    return;
  }

  // Jalankan simulasi
  try {
    const sim = runSimulation(state.gpx, settings);
    if(sim.stats.calories.kcal>65535)throw new Error('Estimasi kalori melebihi batas TCX (65.535 kcal). Periksa jarak atau berat badan.');
    state.sim = sim;

    updateSummary(sim, settings);
    updateSplitTable(sim.splits);
    drawCharts(sim);
    updateActionButtons();
  } catch (e) {
    state.sim=null;hrErr.textContent=e.message;hrErr.style.display='block';document.getElementById('summaryContent').style.display='none';document.getElementById('summaryEmpty').style.display='block';document.querySelector('#summaryEmpty p').textContent='Pratinjau belum tersedia. Periksa isian.';updateActionButtons();console.error('Simulasi gagal:',e);
  }
}

function updateActionButtons() {
  const ok = !!state.gpx && !!state.sim;
  document.getElementById('btnDownload').disabled = !ok;
  document.getElementById('btnReshuffle').disabled = !ok;
}

function updateSummary(sim, settings) {
  const {stats,splits}=sim;
  const put=(id,value)=>document.getElementById(id).textContent=value;
  document.getElementById('summaryContent').style.display='block';
  document.getElementById('summaryEmpty').style.display='none';
  document.querySelectorAll('[data-hr]').forEach(el=>el.hidden=!stats.hrEnabled);
  document.querySelectorAll('[data-cad]').forEach(el=>el.hidden=!stats.cadEnabled);
  put('previewName',settings.runName);put('previewDate',fmtDateWIB(settings.startUtcMs)+' WIB · Simulasi lari');
  put('sumDist',`${(stats.totalDist/1000).toFixed(2)} km`);
  put('sumPace',`${fmtPace(stats.avgPaceSecPerKm)} /km`);
  put('sumDur',fmtDur(stats.totalDurSec));put('sumFinish','Selesai '+fmtTimeWIB(settings.startUtcMs+stats.totalDurSec*1000));
  put('sumCalories',`${stats.calories.kcal} kcal`);put('calorieMethod',`${stats.calories.method} · acuan ${settings.weightKg} kg`);
  const elevation=stats.elevation;
  const gain=elevation.hasElevation?`${Math.round(elevation.gain)} m${elevation.complete?'':'*'}`:'Tidak tersedia';
  const loss=elevation.hasElevation?`${Math.round(elevation.loss)} m${elevation.complete?'':'*'}`:'Tidak tersedia';
  put('sumGain',gain);put('gainDetail',gain);put('lossDetail',loss);
  put('sumHrAvg',stats.hrEnabled?`${stats.avgHr} bpm`:'');put('hrAvgDetail',stats.hrEnabled?`${stats.avgHr} bpm`:'');put('hrMaxDetail',stats.hrEnabled?`${stats.maxHr} bpm`:'');
  put('sumCad',stats.cadEnabled?`${stats.avgCad} spm`:'');put('cadAvgDetail',stats.cadEnabled?`${stats.avgCad} spm`:'');put('cadMaxDetail',stats.cadEnabled?`${stats.maxCad} spm`:'');
  put('paceAvgDetail',`${fmtPace(stats.avgPaceSecPerKm)} /km`);put('movingDetail',fmtDur(stats.totalDurSec));
  const full=splits.filter(s=>!s.isPartial),best=full.length?Math.min(...full.map(s=>s.paceSecPerKm)):null;
  put('fastestSplit',best?`${fmtPace(best)} /km`:'Belum 1 km');
  setChartDistance(chartDistance);
}
function updateSplitTable(splits) {
  const tbody=document.getElementById('splitTableBody');tbody.innerHTML='';
  const speeds=splits.map(s=>1000/s.paceSecPerKm),maxSpeed=Math.max(...speeds);
  splits.forEach((s,i)=>{
    const tr=document.createElement('tr'),delta=s.elevation.delta;
    const label=s.isPartial?`${(s.distM/1000).toFixed(2)}*`:`${s.km}`;
    tr.innerHTML=`<td>${label}</td><td class="split-pace">${fmtPace(s.paceSecPerKm)}</td><td class="split-bar-cell"><span class="split-bar" style="width:${Math.max(15,speeds[i]/maxSpeed*100).toFixed(1)}%"></span></td><td>${Number.isFinite(delta)?`${delta>0?'+':''}${Math.round(delta)}`:'—'}</td><td data-hr ${state.sim.stats.hrEnabled?'':'hidden'}>${s.avgHr===null?'—':s.avgHr}</td>`;
    tbody.appendChild(tr);
  });
  const partial=splits.some(s=>s.isPartial);
  let foot=tbody.parentElement.parentElement.nextElementSibling;
  foot.textContent='Δ elev. = beda ketinggian akhir dan awal split (m).'+(partial?' *Sisa jarak, bukan 1 km penuh.':'');
}

/* ============================================================
   INPUT LISTENERS
   ============================================================ */
function initListeners() {
  const textInputs = ['runDate', 'runTime', 'paceMin', 'paceSec', 'hrMin', 'hrAvg', 'hrMax', 'cadAvg','weightKg','age','sex'];
  textInputs.forEach(id => {
    document.getElementById(id).addEventListener('change', scheduleUpdate);
    document.getElementById(id).addEventListener('input', scheduleUpdate);
  });

  // Nama dan deskripsi TIDAK memicu simulasi ulang (seed tetap sama)
  ['runName', 'runDesc'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      document.getElementById('previewName').textContent=document.getElementById('runName').value.trim()||'Lari Pagi';
    });
  });

  document.querySelectorAll('input[name="device"]').forEach(r => {
    r.addEventListener('change', scheduleUpdate);
  });

  // Pace detik: validasi 0-59
  document.getElementById('paceSec').addEventListener('blur', () => {
    const el = document.getElementById('paceSec');
    let v = parseInt(el.value) || 0;
    if (v < 0) v = 0;
    if (v > 59) v = 59;
    el.value = v;
  });
}

/* ============================================================
   UNDUH TCX
   ============================================================ */
function initDownload() {
  document.getElementById('btnDownload').addEventListener('click', () => {
    clearTimeout(_updateTimer);doUpdate();
    if (!state.sim || !state.gpx) return;
    const settings = getSettings();
    const tcxStr = generateTCX(state.sim, settings);
    const safeName = settings.runName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'PNS — Pegawai Negeri Strava';
    const filename = `${safeName}.tcx`;
    const blob = new Blob([tcxStr], { type: 'application/xml' });
    window.PNSPortal.requestDownload({filename,name:settings.runName,distance:state.sim.stats.totalDist,pace:state.sim.stats.avgPaceSecPerKm,duration:state.sim.stats.totalDurSec,routeName:document.getElementById('gpxFileName').textContent},()=>downloadBlob(blob,filename));
  });

  document.getElementById('btnReshuffle').addEventListener('click', () => {
    doUpdate(false); // false = generate seed baru
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/* ============================================================
   RESIZE – redraw canvas jika ukuran berubah
   ============================================================ */
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (state.sim) {
      drawCharts(state.sim);
      if (state.gpx) {
        const fb = document.getElementById('mapFallback');
        if (fb.style.display !== 'none') {
          renderFallbackMap(state.gpx, state.gpx.allPts.map(p => [p.lat, p.lon]));
        }
      }
    }
  }, 200);
});

/* ============================================================
   INIT
   ============================================================ */
function init() {
  initTheme();
  initDefaults();
  initSliders();
  initDeviceSelector();
  initGpxUpload();
  initListeners();
  initDownload();
  initPreviewControls();
}

document.addEventListener('DOMContentLoaded', init);
