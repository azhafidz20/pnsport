const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8');
const context={document:{getElementById(){return{addEventListener(){}}},addEventListener(){}},window:{addEventListener(){}},console,Math,Date,Float64Array,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(source,context);
const settings={device:'amazfit',runName:'Uji & Lari',runDesc:'Simulasi <PNS>',startUtcMs:Date.UTC(2026,10,25,0,30),avgPaceSecPerKm:420,variancePct:8,splitPct:-10,hrMin:142,hrAvg:158,hrMax:175,cadAvg:165,seed:.5};
const gpx={totalDist:1000,allPts:[{lat:-6.2,lon:106.8,cumDist:0},{lat:-6.19,lon:106.8,cumDist:1000}]};
const sim=context.runSimulation(gpx,settings);assert.equal(sim.stats.totalDurSec,420);assert.equal(sim.trackpoints[0].utcMs,settings.startUtcMs);
for(const device of ['amazfit','garmin',undefined]){const tcx=context.generateTCX(sim,{...settings,device},'route.gpx');assert(tcx.includes('<Name>Amazfit Active Edge</Name>'));assert(!tcx.includes('Forerunner'));assert(tcx.includes('<ProductID>0</ProductID>'));assert(tcx.includes('Uji &amp; Lari'));assert(tcx.includes('Simulasi &lt;PNS&gt;'));assert(tcx.includes('PNS — Pegawai Negeri Strava'));assert(tcx.includes('2026-11-25T00:30:00.000Z'));assert(tcx.includes('garmin.com/xmlschemas'));}
const html=fs.readFileSync('dist/pelayanan.html','utf8');assert(!html.includes('devGarmin'));assert(!html.includes('Forerunner'));assert.equal((html.match(/name="device"/g)||[]).length,1);
console.log('PASS: actual simulation, duration, UTC timestamp, Amazfit-only TCX creator, escaped XML, PNS author, TCX namespaces and single device UI.');
const path=require('node:path');
const outputs=process.env.PNS_TEST_OUTPUT;
if(outputs)fs.mkdirSync(outputs,{recursive:true});
const profile={...settings,weightKg:70,age:30,sex:'',hrEnabled:true,cadEnabled:true};
const elevated={totalDist:1250.5,allPts:[{lat:-6.2,lon:106.8,ele:10,cumDist:0,segmentIndex:0},{lat:-6.195,lon:106.8,ele:30,cumDist:500,segmentIndex:0},{lat:-6.19,lon:106.8,ele:15,cumDist:1000,segmentIndex:0},{lat:-6.188,lon:106.8,ele:20,cumDist:1250.5,segmentIndex:0}]};
for(const hrEnabled of [false,true])for(const cadEnabled of [false,true]){
 const opts={...profile,hrEnabled,cadEnabled},result=context.runSimulation(elevated,opts),xml=context.generateTCX(result,opts);
 assert(result.stats.calories.kcal>0);assert.equal(result.trackpoints.at(-1).dist,elevated.totalDist);assert.equal(result.trackpoints.at(-1).sec,result.stats.totalDurSec);
 assert.equal(result.stats.elevation.gain,25);assert.equal(result.stats.elevation.loss,15);assert(result.stats.elevation.complete);
 assert.equal(xml.includes('<HeartRateBpm>'),hrEnabled);assert.equal(xml.includes('<AverageHeartRateBpm>'),hrEnabled);assert.equal(xml.includes('<Cadence>'),cadEnabled);assert.equal(xml.includes('<ae:RunCadence>'),cadEnabled);assert.equal(xml.includes('<ae:AvgRunCadence>'),cadEnabled);assert(xml.includes('<AltitudeMeters>10.000</AltitudeMeters>'));assert(xml.includes('<Calories>'+result.stats.calories.kcal+'</Calories>'));assert(!xml.includes('NaN'));assert(!xml.includes('Infinity'));
 assert.equal(result.splits.length,2);assert(result.splits.at(-1).isPartial);assert.equal(result.splits[0].elevation.delta,5);assert.equal(result.splits.at(-1).elevation.delta,5);
 if(outputs)fs.writeFileSync(path.join(outputs,`hr-${hrEnabled}-cad-${cadEnabled}.tcx`),xml);
}
const stat={totalDurSec:1800,avgPaceSecPerKm:360,avgHr:150};
const met=context.estimateActivityCalories(stat,{...profile,hrEnabled:false});assert(met.kcal>0);assert.equal(context.estimateActivityCalories(stat,{...profile,weightKg:140,hrEnabled:false}).kcal,met.kcal*2);
const male=context.estimateActivityCalories(stat,{...profile,sex:'m'}),female=context.estimateActivityCalories(stat,{...profile,sex:'f'});assert(male.method.startsWith('HR'));assert(female.method.startsWith('HR'));assert.notEqual(male.kcal,female.kcal);
assert.equal(context.estimateActivityCalories(stat,{...profile,sex:'m',hrEnabled:false}).method,met.method);
const missing={...elevated,allPts:elevated.allPts.map(p=>({...p,ele:null}))};const noEle=context.runSimulation(missing,{...profile,hrEnabled:false,cadEnabled:false});assert.equal(noEle.stats.elevation.gain,null);assert(!context.generateTCX(noEle,profile).includes('<AltitudeMeters>'));
const gap={totalDist:1000,allPts:[{lat:0,lon:0,ele:0,cumDist:0,segmentIndex:0},{lat:.001,lon:0,ele:10,cumDist:500,segmentIndex:0},{lat:1,lon:1,ele:1000,cumDist:500,segmentIndex:1},{lat:1.001,lon:1,ele:1010,cumDist:1000,segmentIndex:1}]};assert.equal(context.elevationStats(gap).gain,20);
assert.equal(context.positionAtDistance(elevated,250).ele,20);
assert.equal(context.validateSettings({...profile,hrEnabled:false,cadEnabled:false,hrMin:NaN,cadAvg:NaN}).length,0);
assert(context.validateSettings({...profile,weightKg:0}).length);assert(context.validateSettings({...profile,hrMin:200,hrAvg:150}).length);
const tiny=context.runSimulation({totalDist:10.5,allPts:[{lat:0,lon:0,cumDist:0},{lat:.0001,lon:0,cumDist:10.5}]},profile);assert.equal(tiny.trackpoints.at(-1).dist,10.5);assert.equal(tiny.splits.length,1);assert(tiny.splits[0].isPartial);
console.log('PASS: all sensor combinations; nonzero calories with HR off; weight/sex formulas; real, missing and discontinuous elevations; interpolated meter detail; exact fractional endpoint; disabled-field validation; partial and short splits.');
// Sensor shape and repeatability use the production generator, including time-based sampling.
const longRoute={totalDist:5000,allPts:[{lat:0,lon:0,ele:0,cumDist:0,segmentIndex:0},{lat:.02,lon:0,ele:40,cumDist:2500,segmentIndex:0},{lat:.04,lon:0,ele:10,cumDist:5000,segmentIndex:0}]};
const variance=values=>{const avg=values.reduce((s,v)=>s+v,0)/values.length;return values.reduce((s,v)=>s+(v-avg)**2,0)/values.length;};
for(const seed of [.1,.45,.9]){
 const opts={...profile,seed},r=context.runSimulation(longRoute,opts),again=context.runSimulation(longRoute,opts);
 assert.deepEqual(r.trackpoints,again.trackpoints);assert(Math.abs(r.stats.avgHr-profile.hrAvg)<=1);assert(Math.abs(r.stats.avgCad-profile.cadAvg)<=1);
 assert(new Set(r.trackpoints.map(p=>p.hr)).size>=12);assert(new Set(r.trackpoints.map(p=>p.cad)).size>=12);assert(variance(r.trackpoints.map(p=>p.hr))>4);assert(variance(r.trackpoints.map(p=>p.cad))>3);
 assert(r.trackpoints.every(p=>p.hr>=profile.hrMin&&p.hr<=profile.hrMax&&p.cad>=60&&p.cad<=300));
 assert(r.trackpoints.slice(1).every((p,i)=>Math.abs(p.hr-r.trackpoints[i].hr)<=6));
 const faster=context.runSimulation(longRoute,{...opts,variancePct:20});assert.notDeepEqual(r.trackpoints.map(p=>p.hr),faster.trackpoints.map(p=>p.hr));assert.notDeepEqual(r.trackpoints.map(p=>p.cad),faster.trackpoints.map(p=>p.cad));
}
const markup=fs.readFileSync('dist/pelayanan.html','utf8');assert(markup.indexOf('id="activityDetails"')>markup.indexOf('class="col-right"'));assert(markup.indexOf('id="activityDetails"')<markup.indexOf('id="summaryCard"'));assert(markup.includes('aria-controls="previewBody"'));assert(markup.includes('class="chart-tooltip"'));assert((fs.readFileSync('dist/index.html','utf8').match(/https:\/\/onthegomap.com\/#\/create/g)||[]).length>=2);
console.log('PASS: varied reproducible HR/cadence, stable means and bounds, response to pace changes, detail above collapsible preview, tooltip containers, route-planner links.');
