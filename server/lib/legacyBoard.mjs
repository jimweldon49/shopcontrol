export const PLANNING = ['Unscheduled', 'This Week', 'Next Week', '2 Weeks Out', '3 Weeks Out', 'Future / Holding'];
export const CATEGORIES = {insurance:'Insurance companies',technicians:'Technicians',estimators:'Estimators',payTypes:'Pay types',colors:'Card colors',flags:'Icons / flags',appointmentTypes:'Appointment types',locations:'Locations',productionStages:'Production stages',deliveryStages:'Delivery stages'};
const options = (names, prefix) => names.map((name,i)=>({id:`${prefix}-${i}`,name}));
export function defaultSettings(){return {
 insurance:options(['Allstate','State Farm','GEICO','Progressive','CSAA','Farmers','Other'],'ins'),
 technicians:options(['Travis','Cesar','Jairo','Doro','Tony'],'tech'),
 estimators:options(['Marc','Mickey','Bubba'],'est'),
 payTypes:options(['Insurance pay','Customer pay','Self pay','Warranty','Commercial'],'pay'),
 colors:[['Insurance pay','#cfedf2'],['Customer pay','#d8f2da'],['Must go','#fff0a9'],['Problem job','#ffd5db'],['Commercial','#e8dcf7'],['Waiting','#ffe2c2']].map(([name,color],i)=>({id:`color-${i}`,name,color})),
 flags:[['Parts issue','Package'],['Supplement pending','FileClock'],['Customer update needed','Phone'],['Final QC needed','ClipboardCheck'],['Detail needed','Sparkles'],['ADAS / calibration','ScanLine'],['Sublet','Wrench'],['Delivery today','Truck'],['Management attention','Flag'],['Structural repair','Hammer'],['Customer contacted','PhoneCall'],['Payment confirmed','BadgeCheck'],['Deductible owed','CircleDollarSign'],['Waiting insurance payment','Clock'],['Storage concern','Warehouse'],['Total loss pickup','Truck'],['Delivered but unpaid','CircleAlert'],['Paid','Check']].map(([name,symbol],i)=>({id:`flag-${i}`,name,symbol})),
 appointmentTypes:options(['Drop-off','Estimate appointment','Pickup / delivery','Tow-in','Sublet','Calibration','Customer meeting','Internal reminder'],'appt'),
 locations:options(['Ceres','Modesto','Commercial','Off-site / Sublet'],'loc'),
 productionStages:options(['Check In','Disassembly','Repair Plan','Waiting Approval','Waiting Parts','Body','Paint','Delay','Reassembly','Sublet','Detail','Final QC','Ready for Delivery'],'prod'),
 deliveryStages:options(['Ready for Delivery','Pre-close','Contact Customer / Confirm Payment','Delivery Scheduled','Confirmed Total Loss Waiting for Pickup','Completed Waiting for Payment','Delivered Waiting for Payment','Delivered / Paid'],'del'),
};}
export function dayKey(date=new Date()){const d=new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function addDays(value,n){const d=new Date(`${value}T12:00:00`);d.setDate(d.getDate()+n);return dayKey(d);}
export const blankState=()=>({schemaVersion:1,revision:0,demo:false,jobs:[],appointments:[],settings:defaultSettings()});
export function blankJob(settings){return {id:crypto.randomUUID(),ro:'',customer:'',vehicle:'',insurance:settings.insurance[0]?.id||'',payType:settings.payTypes[0]?.id||'',amount:0,bodyHours:0,paintHours:0,otherHours:0,estimator:'',bodyTechs:[],painters:[],supportTechs:[],inDate:dayKey(),targetDate:'',dropoffDate:'',pickupDate:'',deliveredDate:'',location:settings.locations[0]?.id||'',flags:[],color:settings.colors[0]?.id||'',productionStage:settings.productionStages[0]?.id||'',deliveryStage:'',planning:'Unscheduled',partsStatus:'Not ordered',supplementStatus:'None',commercial:false,notes:'',history:[]};}
export const totalHours=j=>Number(j.bodyHours)+Number(j.paintHours)+Number(j.otherHours);
export const totals=jobs=>jobs.reduce((a,j)=>({cars:a.cars+1,amount:a.amount+j.amount,body:a.body+j.bodyHours,paint:a.paint+j.paintHours,total:a.total+totalHours(j)}),{cars:0,amount:0,body:0,paint:0,total:0});
export const techIds=j=>[...new Set([...j.bodyTechs,...j.painters,...j.supportTechs])];
export function cycleDays(j,today=dayKey()){if(!j.inDate)return 0;return Math.max(0,Math.round((Date.parse((j.deliveredDate||today)+'T12:00:00')-Date.parse(j.inDate+'T12:00:00'))/86400000));}
export function sampleState(){const state=blankState();state.demo=true;const today=dayKey();
 const samples=[['17960','Avery Morgan','2023 Toyota RAV4',0,0,3245,16,8],['17961','Jordan Lee','2021 Honda Accord',1,1,7840,32,17],['17962','Taylor Brooks','2024 Ford F-150',2,4,12480,48,22],['17963','Casey Wilson','2022 Subaru Outback',3,3,5680,21,13],['17964','Alex Rivera','2020 Chevrolet Silverado',4,3,9650,40,19],['17965','Morgan Ellis','2023 Mazda CX-5',5,0,6845,28,16],['17966','Sam Parker','2022 Toyota Camry',5,2,4380,19,12],['17967','Jamie Reed','2021 Ford Transit',5,4,18360,64,27],['17968','Drew Collins','2024 Kia Sportage',6,0,7890,31,20],['17969','Riley Hayes','2022 Honda CR-V',6,2,5420,24,14],['17970','Cameron Blake','2020 Nissan Frontier',8,5,8840,37,18],['17971','Quinn Carter','2023 Lexus RX',10,0,11290,42,23],['17972','Robin Lane','2021 Tesla Model Y',11,3,13200,52,24],['17973','Dakota Bell','2024 Hyundai Tucson',12,1,6240,25,16],['17974','Skyler Adams','2022 GMC Sierra',12,0,9650,38,19],['17975','Peyton Gray','2020 Jeep Wrangler',12,1,4860,21,13]];
 state.jobs=samples.map(([ro,customer,vehicle,stage,color,amount,bodyHours,paintHours],i)=>({...blankJob(state.settings),id:`sample-${i}`,ro,customer,vehicle,productionStage:`prod-${stage}`,deliveryStage:stage===12?`del-${[0,3,6][i-13]}`:'',color:`color-${color}`,amount,bodyHours,paintHours,otherHours:2,insurance:`ins-${i%6}`,estimator:`est-${i%3}`,bodyTechs:[`tech-${i%4}`,...(i===7?['tech-3']:[])],painters:['tech-4'],inDate:addDays(today,-(i+2)),targetDate:addDays(today,i%5-1),location:`loc-${i===7?2:0}`,planning:PLANNING[i%6],partsStatus:i===4?'Backordered':'Here',supplementStatus:i===3?'Pending':'None',commercial:i===7,flags:i===4?['flag-0']:i===12?['flag-3','flag-5']:i===15?['flag-16']:[],notes:'Sample vehicle for testing. Replace with your own work.'}));
 state.appointments=[{id:'sample-appt-1',jobId:'sample-14',title:'Customer pickup',type:'appt-2',date:today,time:'14:00',duration:30,location:'loc-0',notes:''},{id:'sample-appt-2',jobId:'',title:'Estimate — walk-in slot',type:'appt-1',date:addDays(today,1),time:'09:00',duration:45,location:'loc-1',notes:''}];return state;
}
export function moveJob(job,field,value,today=dayKey()){
 const next={...job,[field]:value,history:[...job.history,{at:new Date().toISOString(),text:`${field==='productionStage'?'Production':field==='deliveryStage'?'Delivery':'Planning'} moved`,from:job[field],to:value}].slice(-100)};
 if(field==='productionStage'&&value==='prod-12'&&!next.deliveryStage)next.deliveryStage='del-0';
 if(field==='deliveryStage'&&(value==='del-6'||value==='del-7'))next.deliveredDate=next.deliveredDate||today;
 if(field==='deliveryStage'&&value!=='del-6'&&value!=='del-7')next.deliveredDate='';
 return next;
}
export const isDelivered=j=>['del-6','del-7'].includes(j.deliveryStage);
export function filterJobs(jobs,filters,settings,today=dayKey()){
 const name=(cat,id)=>settings[cat].find(x=>x.id===id)?.name||'';
 return jobs.filter(j=>{
  if(filters.search&&!`${j.ro} ${j.customer} ${j.vehicle}`.toLowerCase().includes(filters.search.toLowerCase()))return false;
  for(const [f,key] of [['insurance','insurance'],['estimator','estimator'],['payType','payType'],['location','location'],['partsStatus','partsStatus'],['supplementStatus','supplementStatus']])if(filters[f]&&j[key]!==filters[f])return false;
  if(filters.technician&&!techIds(j).includes(filters.technician))return false;
  if(filters.flag&&!j.flags.includes(filters.flag))return false;
  if(filters.commercial&&!j.commercial)return false;
  if(filters.adas&&!j.flags.some(id=>name('flags',id).toLowerCase().includes('calibration')||name('flags',id).toLowerCase().includes('adas')))return false;
  if(filters.due==='past'&&(!j.targetDate||j.targetDate>=today||isDelivered(j)))return false;
  if(filters.due==='today'&&j.targetDate!==today)return false;
  if(filters.due==='tomorrow'&&j.targetDate!==addDays(today,1))return false;
  if(filters.due==='none'&&j.targetDate)return false;
  if(filters.due==='week'&&(!j.targetDate||j.targetDate<today||j.targetDate>addDays(today,7)))return false;
  return true;
 });
}
export function sortJobs(jobs,sort,settings){return [...jobs].sort((a,b)=>{
 if(['amount','bodyHours','paintHours'].includes(sort))return b[sort]-a[sort];
 if(sort==='insurance')return (settings.insurance.find(x=>x.id===a.insurance)?.name||'').localeCompare(settings.insurance.find(x=>x.id===b.insurance)?.name||'');
 if(sort==='technician')return (settings.technicians.find(x=>x.id===techIds(a)[0])?.name||'').localeCompare(settings.technicians.find(x=>x.id===techIds(b)[0])?.name||'');
 return String(a[sort]||'9999').localeCompare(String(b[sort]||'9999'),undefined,{numeric:true});
});}
export function optionInUse(state,cat,id){
 if(['productionStages','deliveryStages'].includes(cat)&&(/^(prod|del)-\d+$/.test(id)))return true;
 const single={insurance:'insurance',estimators:'estimator',payTypes:'payType',colors:'color',locations:'location',productionStages:'productionStage',deliveryStages:'deliveryStage'};
 if(single[cat]&&state.jobs.some(j=>j[single[cat]]===id))return true;
 if(cat==='technicians'&&state.jobs.some(j=>techIds(j).includes(id)))return true;
 if(cat==='flags'&&state.jobs.some(j=>j.flags.includes(id)))return true;
 if(cat==='appointmentTypes'&&state.appointments.some(a=>a.type===id))return true;
 return cat==='locations'&&state.appointments.some(a=>a.location===id);
}
function assert(ok,message){if(!ok)throw new Error(message);}
const str=(v,max=300)=>typeof v==='string'&&v.length<=max;
const date=v=>v===''||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v+'T12:00:00'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v);
export function validateState(s){
 assert(s&&s.schemaVersion===1&&Number.isSafeInteger(s.revision)&&s.revision>=0,'Invalid board format.');
 assert(typeof s.demo==='boolean'&&Array.isArray(s.jobs)&&s.jobs.length<=10000&&Array.isArray(s.appointments)&&s.appointments.length<=20000,'Invalid records.');
 assert(s.settings&&typeof s.settings==='object','Missing settings.');
 for(const cat of Object.keys(CATEGORIES)){
  const list=s.settings[cat];assert(Array.isArray(list)&&list.length>0&&list.length<=300,`${CATEGORIES[cat]} must have 1–300 options.`);
  assert(new Set(list.map(x=>x.id)).size===list.length,`Duplicate ${cat} IDs.`);
  for(const x of list){assert(str(x.id,100)&&x.id&&str(x.name,100)&&x.name.trim(),`Invalid ${cat} option.`);if(cat==='colors')assert(/^#[0-9a-f]{6}$/i.test(x.color),'Use a six-digit hex color.');if(cat==='flags')assert(str(x.symbol,50),'Invalid icon.');}
 }
 for(const [cat,prefix,count] of [['productionStages','prod',13],['deliveryStages','del',8]])for(let i=0;i<count;i++)assert(s.settings[cat].some(x=>x.id===`${prefix}-${i}`),'Built-in stages must be retained; rename or reorder them instead.');
 const ref=(cat,v,optional=true)=>assert((optional&&v==='')||s.settings[cat].some(x=>x.id===v),`Unknown ${CATEGORIES[cat]} selection.`);
 const ids=new Set(),ros=new Set();
 for(const j of s.jobs){
  assert(str(j.id,100)&&j.id&&!ids.has(j.id),'Duplicate or missing vehicle ID.');ids.add(j.id);
  assert(str(j.ro,50)&&j.ro.trim()&&!ros.has(j.ro.trim().toLowerCase()),'RO numbers must be present and unique.');ros.add(j.ro.trim().toLowerCase());
  assert(str(j.customer)&&j.customer.trim()&&str(j.vehicle)&&j.vehicle.trim(),'Customer and vehicle are required.');
  for(const n of ['amount','bodyHours','paintHours','otherHours'])assert(typeof j[n]==='number'&&Number.isFinite(j[n])&&j[n]>=0&&j[n]<=100000000,`Invalid ${n}.`);
  for(const n of ['inDate','targetDate','dropoffDate','pickupDate','deliveredDate'])assert(date(j[n]),`Invalid ${n}.`);
  for(const [cat,key] of [['insurance','insurance'],['payTypes','payType'],['estimators','estimator'],['colors','color'],['locations','location'],['productionStages','productionStage'],['deliveryStages','deliveryStage']])ref(cat,j[key],!['productionStage','color','location','payType'].includes(key));
  for(const key of ['bodyTechs','painters','supportTechs','flags']){assert(Array.isArray(j[key])&&j[key].length<=300,`Invalid ${key}.`);j[key].forEach(id=>ref(key==='flags'?'flags':'technicians',id,false));}
  assert(PLANNING.includes(j.planning)&&['Not ordered','Ordered','Backordered','Partial','Here'].includes(j.partsStatus)&&['None','Needed','Pending','Approved'].includes(j.supplementStatus),'Invalid vehicle status.');
  assert(typeof j.commercial==='boolean'&&str(j.notes,20000)&&Array.isArray(j.history)&&j.history.length<=100,'Invalid vehicle details.');
  for(const h of j.history)assert(str(h.at,100)&&str(h.text)&&str(h.from)&&str(h.to),'Invalid movement history.');
 }
 const apptIds=new Set();
 for(const a of s.appointments){assert(str(a.id,100)&&a.id&&!apptIds.has(a.id),'Duplicate or missing appointment ID.');apptIds.add(a.id);assert(a.jobId===''||ids.has(a.jobId),'Appointment vehicle does not exist.');assert(str(a.title)&&a.title.trim()&&date(a.date)&&a.date&&/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time),'Appointment title, date and valid time are required.');assert(Number.isInteger(a.duration)&&a.duration>=5&&a.duration<=1440,'Duration must be 5–1440 minutes.');ref('appointmentTypes',a.type,false);ref('locations',a.location,false);assert(str(a.notes,10000),'Invalid appointment notes.');}
 return s;
}
