(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ShopModel=factory();})(typeof globalThis==='undefined'?this:globalThis,function(){
  const production=['Check-In','Tear Down','Repair Plan','Waiting Approval','Waiting on Supplement','Waiting on Parts','Body','Prep','Paint','On Hold','Assembly','Sublet','Detail','QC','Ready for Delivery'];
  const delivery=['Ready for Delivery','Pre-close','Contact Customer / Confirm Payment','Delivery Scheduled','Confirmed Total Loss Waiting for Pickup','Completed Waiting for Payment','Delivered Waiting for Payment','Delivered / Paid'];
  const planning=['Unscheduled','This Week','Next Week','2 Weeks Out','3 Weeks Out','Future / Holding'];
  const stages=[...production,'Scheduled','On the Road','No Show','Delivered','Total Loss'];
  const jobKind=ro=>/^\d{5}$/.test(String(ro||'').trim())?'active':'opportunity';
  const isOnsite=j=>jobKind(j.roNumber)==='active'&&j.onsite===true&&!j.mergedInto&&production.includes(j.currentStage);
  const openOpportunity=j=>jobKind(j.roNumber)==='opportunity'&&!j.mergedInto&&!['No Show','Delivered','Total Loss'].includes(j.currentStage);
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
  const defaults=()=>({insurance:['Allstate','State Farm','GEICO','Progressive','CSAA','Farmers','Other'],technicians:['Travis','Cesar','Jairo','Doro','Tony'],estimators:['Marc','Mickey','Bubba'],payTypes:['Insurance pay','Customer pay','Self pay','Warranty','Commercial'],locations:['Ceres','Modesto','Commercial','Off-Site','Sublet'],appointmentTypes:['Drop-off','Estimate appointment','Pickup / delivery','Tow-in','Sublet','Calibration','Customer meeting','Internal reminder'],colors:[{name:'Insurance pay',color:'#cfedf2'},{name:'Customer pay',color:'#d8f2da'},{name:'Must go',color:'#fff0a9'},{name:'Problem job',color:'#ffd5db'},{name:'Commercial',color:'#e8dcf7'},{name:'Waiting',color:'#ffe2c2'}],flags:['Parts issue','Supplement pending','Customer update needed','Final QC needed','Detail needed','ADAS / calibration','Sublet','Delivery today','Management attention','Structural repair','Customer contacted','Payment confirmed','Deductible owed','Waiting insurance payment','Storage concern','Total loss pickup','Delivered but unpaid','Paid'],coreRecipients:[],missedCallEscalation:[]});

  // Inline Lucide icon markup (MIT licensed, https://lucide.dev) so board cards render real icons
  // without a network/CDN dependency. Each value is the inner <path>/<circle>/etc markup for a
  // 24x24 viewBox icon; svgIcon() wraps it with sizing + stroke attributes.
  const LUCIDE_ICONS={
    Package:'<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /><path d="M12 22V12" /><polyline points="3.29 7 12 12 20.71 7" /><path d="m7.5 4.27 9 5.15" />',
    FileClock:'<path d="M16 22h2a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v2.85" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M8 14v2.2l1.6 1" /><circle cx="8" cy="16" r="6" />',
    Phone:'<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />',
    ClipboardCheck:'<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" />',
    Sparkles:'<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" /><path d="M20 2v4" /><path d="M22 4h-4" /><circle cx="4" cy="20" r="2" />',
    ScanLine:'<path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" />',
    Wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" />',
    Truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" />',
    Flag:'<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />',
    Hammer:'<path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" /><path d="m18 15 4-4" /><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />',
    PhoneCall:'<path d="M13 2a9 9 0 0 1 9 9" /><path d="M13 6a5 5 0 0 1 5 5" /><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" />',
    BadgeCheck:'<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" /><path d="m16 9-5.5 5.5L8 12" />',
    CircleDollarSign:'<circle cx="12" cy="12" r="10" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 18V6" />',
    Clock:'<circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />',
    Warehouse:'<path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11" /><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z" /><path d="M6 13h12" /><path d="M6 17h12" />',
    CircleAlert:'<circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />',
    Check:'<path d="M20 6 9 17l-5-5" />',
    Users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><path d="M16 3.128a4 4 0 0 1 0 7.744" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><circle cx="9" cy="7" r="4" />',
    MapPin:'<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" />',
    CalendarDays:'<path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M8 13h.01" /><path d="M12 13h.01" /><path d="M16 13h.01" /><path d="M8 17h.01" /><path d="M12 17h.01" /><path d="M16 17h.01" />',
  };
  // Fixed label -> icon mapping for the shop's standard flags. A flag renamed or added in
  // Settings that isn't in this list falls back to the Flag icon, matching the original design.
  const FLAG_ICON_MAP={
    'Parts issue':'Package','Supplement pending':'FileClock','Customer update needed':'Phone',
    'Final QC needed':'ClipboardCheck','Detail needed':'Sparkles','ADAS / calibration':'ScanLine',
    'Sublet':'Wrench','Delivery today':'Truck','Management attention':'Flag','Structural repair':'Hammer',
    'Customer contacted':'PhoneCall','Payment confirmed':'BadgeCheck','Deductible owed':'CircleDollarSign',
    'Waiting insurance payment':'Clock','Storage concern':'Warehouse','Total loss pickup':'Truck',
    'Delivered but unpaid':'CircleAlert','Paid':'Check',
  };
  function svgIcon(name,size=14){const inner=LUCIDE_ICONS[name]||LUCIDE_ICONS.Flag;return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;}
  function flagIconName(label){return FLAG_ICON_MAP[label]||'Flag';}
  function totals(jobs){return jobs.reduce((t,j)=>({count:t.count+1,value:t.value+Number(j.roAmount||0),body:t.body+Number(j.bodyHours||0),paint:t.paint+Number(j.paintHours||0),total:t.total+Number(j.bodyHours||0)+Number(j.paintHours||0)+Number(j.otherHours||0)}),{count:0,value:0,body:0,paint:0,total:0});}
  function boardPatch(board,destination){if(board==='production'){if(!production.includes(destination))throw Error('Unknown production stage.');return {currentStage:destination,onsite:true};}if(board==='delivery'){if(!delivery.includes(destination))throw Error('Unknown delivery stage.');return {deliveryStage:destination};}if(board==='planning'){if(!planning.includes(destination))throw Error('Unknown planning week.');return {planningBucket:destination};}throw Error('Unknown board.');}
  function sameOpportunity(a,b){const norm=x=>String(x||'').trim().toLowerCase();return jobKind(a.roNumber)==='opportunity'&&jobKind(b.roNumber)==='active'&&Number(a.roAmount)>0&&Number(a.roAmount)===Number(b.roAmount)&&norm(a.customerName)!==''&&norm(a.customerName)===norm(b.customerName)&&norm(a.vehicle)!==''&&norm(a.vehicle)!=='vehicle from ccc'&&norm(a.vehicle)===norm(b.vehicle);}
  // When the next customer update is due. Keep in sync with customer_update_due_at()
  // in server/migrations/018: first call 24h after going onsite, then every 2 days
  // (RO under ,000) or 3 days (,000+ or Structural repair).
  function customerUpdateDueAt(j){if(!j||!j.onsiteAt)return null;const onsite=new Date(j.onsiteAt).getTime(),last=j.customerUpdatedAt?new Date(j.customerUpdatedAt).getTime():null;if(last===null||last<onsite)return new Date(onsite+24*36e5);const big=Number(j.roAmount||0)>=4000||(j.boardFlags||[]).includes('Structural repair');return new Date(last+(big?3:2)*24*36e5);}
  // Vehicle picture library (client/img/vehicles/<type>-<color>.jpg): 12 generic body
  // types x 10 base colors, used on production cards. A job's vehicleType/vehicleColor
  // are picked in the job editor; until then they're guessed from the CCC vehicle text.
  const vehicleTypes=[
    {id:'compact-sedan',label:'Compact Sedan'},{id:'midsize-sedan',label:'Midsize Sedan'},{id:'full-size-sedan',label:'Full Size Sedan'},
    {id:'hatchback',label:'Hatchback'},{id:'sports-coupe',label:'Sports Coupe'},{id:'station-wagon',label:'Station Wagon'},
    {id:'compact-crossover',label:'Compact Crossover'},{id:'midsize-suv',label:'Midsize SUV'},{id:'full-size-suv',label:'Full Size SUV'},
    {id:'crew-cab-pickup',label:'Pickup Truck'},{id:'minivan',label:'Minivan'},{id:'cargo-van',label:'Cargo Van'}];
  const vehicleColors=[
    {id:'white',label:'White',hex:'#f4f4f2'},{id:'black',label:'Black',hex:'#16181b'},{id:'silver',label:'Silver',hex:'#c3c7cc'},
    {id:'gray',label:'Gray',hex:'#6b7077'},{id:'blue',label:'Blue',hex:'#2458b8'},{id:'red',label:'Red',hex:'#c3202f'},
    {id:'green',label:'Green',hex:'#1f6b45'},{id:'brown',label:'Brown',hex:'#6b4a33'},{id:'beige',label:'Beige',hex:'#cdbd98'},
    {id:'orange',label:'Orange',hex:'#e2701f'}];
  // Keyword -> type, checked in order (most specific first). Matched against the
  // year/make/model part of the vehicle text.
  const typeHints=[
    ['cargo-van',/\b(transit(?! connect)|promaster|sprinter|express (cargo|commercial|passenger|[0-9]{4}|van)|cutaway|bus|savana|nv[0-9]{3,4}|metris|e-?series|econoline|cargo van)\b/],
    ['minivan',/\b(sienna|odyssey|pacifica|carnival|sedona|grand caravan|town (&|and) country|quest|voyager|minivan|transit connect)\b/],
    ['crew-cab-pickup',/\b(pickup|f-?150|f-?250|f-?350|super duty|silverado|sierra|ram (1500|2500|3500)|tundra|tacoma|colorado|canyon|gladiator|frontier|titan|ranger|ridgeline|maverick|santa cruz|crew cab|double cab|quad cab|regular cab|extended cab|king cab|supercrew|supercab)\b/],
    ['full-size-suv',/\b(tahoe|suburban|yukon|escalade|expedition|navigator|sequoia|armada|land cruiser|wagoneer|qx80|lx ?[0-9]{3}|gx ?[0-9]{3})\b/],
    ['midsize-suv',/\b(explorer|highlander|pilot|4runner|durango|grand cherokee|traverse|telluride|palisade|atlas(?! cross)|ascent|pathfinder|santa fe|sorento|mdx|rx ?[0-9]{3}|xc90|model x|x5|gle|q7|blazer|edge|murano|wrangler|bronco(?! sport)|passport|acadia|enclave|cx-?9|cx-?90|aviator|grand highlander)\b/],
    ['compact-crossover',/\b(rav4|cr-?v|escape|rogue|equinox|tucson|sportage|cx-?30|cx-?5|cx-?50|forester|crosstrek|compass|cherokee|renegade|hr-?v|kona|seltos|trax|trailblazer|encore|terrain|tiguan|taos|kicks|corolla cross|bronco sport|model y|rdx|nx ?[0-9]{3}|x3|q5|glc|ecosport|venue|niro|mach-?e|ioniq 5|c-?hr|outlander|eclipse cross|atlas cross)\b/],
    ['station-wagon',/\b(outback|wagon|v60|v90|alltrack|sportwagen)\b/],
    ['sports-coupe',/\b(mustang|camaro|corvette|challenger|brz|gr ?86|miata|mx-?5|supra|370z|nissan z|coupe|911|boxster|cayman|z4|tt)\b/],
    ['hatchback',/\b(hatchback|hatch|fit|yaris|golf|gti|prius|bolt|leaf|versa note|spark|sonic|fiesta|mini cooper|veloster|i3|5-?door)\b/],
    ['full-size-sedan',/\b(charger|chrysler 300|impala|avalon|newport|maxima|k900|cadenza|g80|g90|s-?class|7 series|a8|lacrosse|taurus|model s|xts|ct6)\b/],
    ['midsize-sedan',/\b(camry|accord|altima|malibu|sonata|k5|optima|fusion|mazda ?6|legacy|passat|model 3|tlx|3 series|c-?class|a4|g70|es ?[0-9]{3}|mkz|continental)\b/],
    ['compact-sedan',/\b(civic|corolla|sentra|elantra|forte|mazda ?3|jetta|impreza|cruze|focus|versa|rio|ilx|a3|cla|integra|sedan)\b/],
  ];
  const colorHints=[
    ['white',/\b(white|pearl white|snow|frost|ivory|glacier|alpine|blizzard|iridescent)\b/],['black',/\b(black|ebony|onyx|obsidian|midnight black|jet)\b/],
    ['silver',/\b(silver|platinum|sterling|ice|metallic silver)\b/],['gray',/\b(gray|grey|graphite|charcoal|gunmetal|steel|slate|magnetic|granite|lunar|meteor)\b/],
    ['blue',/\b(blue|navy|cobalt|sapphire|indigo|azure|aqua|teal)\b/],['red',/\b(red|burgundy|maroon|crimson|ruby|cherry|delmonico|garnet|scarlet|cardinal)\b/],
    ['green',/\b(green|olive|emerald|forest|jade|sage)\b/],['brown',/\b(brown|bronze|copper|mocha|espresso|chestnut|cocoa|walnut)\b/],
    ['beige',/\b(beige|tan|champagne|gold|sand|cream|khaki|desert|cashmere)\b/],['orange',/\b(orange|yellow|amber|sunset|inferno)\b/],
  ];
  function guessVehicle(text){
    const parts=String(text||'').toLowerCase().split(' / ');
    const model=parts[0]||'',rest=parts.slice(1).filter(p=>!/^vin /.test(p)&&!/^plate /.test(p)).join(' ');
    const type=(typeHints.find(([,re])=>re.test(model))||[])[0]||null;
    const color=(colorHints.find(([,re])=>re.test(rest))||colorHints.find(([,re])=>re.test(model))||[])[0]||null;
    return {type,color};
  }
  // Picture for a job, or null. Saved choices win over the guess.
  function vehicleImage(j){
    if(!j)return null;const g=guessVehicle(j.vehicle);
    const type=vehicleTypes.some(t=>t.id===j.vehicleType)?j.vehicleType:g.type,color=vehicleColors.some(c=>c.id===j.vehicleColor)?j.vehicleColor:(g.color||'silver');
    return type?{type,color,src:`img/vehicles/${type}-${color}.jpg`,guessed:!j.vehicleType||!j.vehicleColor}:null;
  }
  return {production,delivery,planning,stages,jobKind,isOnsite,openOpportunity,money,defaults,totals,boardPatch,sameOpportunity,svgIcon,flagIconName,customerUpdateDueAt,vehicleTypes,vehicleColors,guessVehicle,vehicleImage};
});
