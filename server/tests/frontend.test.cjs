const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function loadClient(){
 const elements=new Map();function el(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',checked:false,dataset:{},classList:{add(){},remove(){},toggle(){}},querySelector(){return el(id+'/child');},querySelectorAll(){return [];},setAttribute(){}});return elements.get(id);}
 const context=vm.createContext({console,Date,Intl,Map,Set,URL,Blob,FormData,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,confirm:()=>true,alert(){},localStorage:{getItem:k=>k==='authUser'?JSON.stringify({id:'user',role:'admin',canDelete:true}):null},document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){},querySelector:()=>null},window:{API_BASE:'/api'}});
 for(const file of ['shared.js','unified.js','app.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../client',file),'utf8'),context,{filename:file});return {context,el,run:s=>vm.runInContext(s,context)};
}
test('all unified views render from the existing Shop Control job cache',()=>{
 const {run,el}=loadClient();run(`cache.daily=[{id:'job1',roNumber:'17892',customerName:'A & B <test>',vehicle:'2023 Honda Accord',onsite:true,currentStage:'Body',roAmount:'1234.56',bodyHours:3,paintHours:2,deliveryStage:'Pre-close',planningBucket:'This Week',updatedAt:'2026-09-10T00:00:00Z',version:4}];workspace.calendarDate='2026-09-10';renderUnified();`);
 assert.match(el('production').innerHTML,/RO #17892/);assert.match(el('production').innerHTML,/A &amp; B &lt;test&gt;/);assert.match(el('deliveryBoard').innerHTML,/RO #17892/);assert.match(el('planningBoard').innerHTML,/RO #17892/);assert.match(el('calendar').innerHTML,/New appointment/);assert.match(el('workspaceSettings').innerHTML,/Insurance companies/);assert.match(el('notifications').innerHTML,/No notifications/);
 run(`cache.daily[0].currentStage='Scheduled';cache.daily[0].onsite=false;renderUnified();`);assert.doesNotMatch(el('production').innerHTML,/RO #17892/);assert.equal(el('metricScheduled').textContent,1);
});
test('board job editor saves the same job identity and its version guard',async()=>{
 const {run,context}=loadClient();run(`cache.daily=[{id:'job1',roNumber:'17892',currentStage:'Body',customerName:'Alex',vehicle:'Honda',onsite:true,updatedAt:'2026-09-10T00:00:00Z',version:7}];openDialog=(title,html,submit)=>{globalThis.editorSubmit=submit;globalThis.editorHtml=html;};upsert=async(key,data)=>{globalThis.saved={key,data};};openBoardJob('job1');`);
 assert.match(context.editorHtml,/shared with Shop Control/);const form=new FormData();for(const [k,v] of Object.entries({roNumber:'17892',customerName:'Alex',vehicle:'Honda',currentStage:'Paint',onsite:'on',roAmount:'100.25',bodyHours:'2',paintHours:'3',otherHours:'1'}))form.set(k,v);form.append('bodyTechs','Jairo');form.append('bodyTechs','Doro');await context.editorSubmit(form);
 assert.equal(context.saved.key,'daily');assert.equal(context.saved.data.id,'job1');assert.equal(context.saved.data.currentStage,'Paint');assert.equal(context.saved.data.expectedVersion,7);assert.equal(context.saved.data.roAmount,100.25);assert.equal(context.saved.data.bodyTechs.length,2);
});
test('opportunity cannot be scheduled with a non-RO file number',async()=>{const {run,context}=loadClient();run(`openDialog=(title,html,submit)=>globalThis.editorSubmit=submit;upsert=async()=>{throw Error('Should not be called');};openBoardJob();`);const form=new FormData();form.set('roNumber','OPP42');form.set('currentStage','Scheduled');await assert.rejects(()=>context.editorSubmit(form),/five-digit RO/);});
test('parts for estimates with no RO number go to "No RO Yet" instead of Parts Problems',()=>{
 const {run}=loadClient();
 const views=run(`(()=>{
  const daily=[
   {id:'j1',roNumber:'17944',cccEstfileId:'0a7fce43',onsite:true,currentStage:'Body'},
   {id:'j2',roNumber:'aeefbda9',cccEstfileId:'aeefbda9',onsite:false,currentStage:'Check-In'},
  ];
  const part=(ro)=>[{partsRoNumber:ro,partStatus:'Need to Order'}];
  const v=(ro,view)=>partsGroupMatchesView(part(ro),view,daily);
  return {
   realOnsite:[v('17944','problems'),v('17944','noRo')],
   placeholderForRealJob:[v('0a7fce43','problems'),v('0a7fce43','noRo')],
   estimateOnly:[v('aeefbda9','problems'),v('aeefbda9','noRo')],
   noJobAtAll:[v('1ee738cc','problems'),v('1ee738cc','noRo')],
  };
 })()`);
 assert.deepEqual(JSON.parse(JSON.stringify(views)),{realOnsite:[true,false],placeholderForRealJob:[true,false],estimateOnly:[false,true],noJobAtAll:[false,true]});
});
test('parts problems are counted per part, late ETAs get their own view, and the dashboard counts vehicles',()=>{
 const {run,el}=loadClient();
 const out=run(`(()=>{
  const past='2020-01-01', future='2999-01-01';
  cache.daily=[{id:'j1',roNumber:'17974',onsite:true,currentStage:'Body'},{id:'j2',roNumber:'17970',onsite:true,currentStage:'Body'}];
  cache.parts=[
   ...Array.from({length:10},(_,i)=>({id:'a'+i,partsRoNumber:'17974',partsCustomerName:'Ollie',partsVehicle:'Car',partStatus:'Ordered',partEta:future})),
   {id:'late',partsRoNumber:'17974',partsCustomerName:'Ollie',partsVehicle:'Car',partStatus:'Ordered',partEta:past},
   {id:'b1',partsRoNumber:'17970',partsCustomerName:'Iz',partsVehicle:'Truck',partStatus:'Need to Order'},
   {id:'b2',partsRoNumber:'17970',partsCustomerName:'Iz',partsVehicle:'Truck',partStatus:'Need to Order'},
  ];
  const ollie=cache.parts.filter(p=>p.partsRoNumber==='17974');
  renderDashboard();
  return {ollieProblems:summarizePartGroup(ollie).problems, reason:partProblemReason(cache.parts[10]), ollieLateView:partsGroupMatchesView(ollie,'late',cache.daily), izLateView:partsGroupMatchesView(cache.parts.slice(11),'late',cache.daily)};
 })()`);
 assert.deepEqual(JSON.parse(JSON.stringify(out)),{ollieProblems:1,reason:'Not arrived by ETA',ollieLateView:true,izLateView:false});
 assert.equal(el('metricPartsProblems').textContent,2,'two vehicles, not 3 parts');
 assert.equal(el('metricPartsLate').textContent,1);
});
