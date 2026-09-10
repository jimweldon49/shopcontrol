const model=require('../../client/shared');
const {allowed,validate}=require('./unifiedValidation');
const oldStages=['Check-In','Tear Down','Repair Plan','Waiting Approval','Waiting on Parts','Body','Paint','On Hold','Assembly','Sublet','Detail','QC','Ready for Delivery'];
function prepareLegacy(data){
 const name=(cat,id)=>data.settings[cat].find(x=>x.id===id)?.name||'';
 const jobs=data.jobs.filter(j=>!j.id.startsWith('sample-')).map(j=>{
  const index=Number(j.productionStage.replace('prod-',''));const stage=oldStages[index];if(!stage)throw Error(`RO ${j.ro}: custom production stages must be mapped before importing.`);
  let delivery='';if(j.deliveryStage){const n=Number(j.deliveryStage.replace('del-',''));delivery=model.delivery[n];if(!delivery)throw Error(`RO ${j.ro}: unknown delivery stage.`);}
  const fields={ro_number:j.ro.trim(),customer_name:j.customer,vehicle:j.vehicle,ro_amount:j.amount,current_stage:stage,insurance:name('insurance',j.insurance),pay_type:name('payTypes',j.payType),location:name('locations',j.location)||'Ceres',estimator:name('estimators',j.estimator),body_hours:j.bodyHours,paint_hours:j.paintHours,other_hours:j.otherHours,body_techs:j.bodyTechs.map(id=>name('technicians',id)),painters:j.painters.map(id=>name('technicians',id)),support_techs:j.supportTechs.map(id=>name('technicians',id)),board_flags:j.flags.map(id=>name('flags',id)),card_color:data.settings.colors.find(c=>c.id===j.color)?.color||'#cfedf2',planning_bucket:j.planning,delivery_stage:delivery||null,in_date:j.inDate||null,target_delivery_date:j.targetDate||null,dropoff_date:j.dropoffDate||null,pickup_date:j.pickupDate||null,actual_delivered_date:j.deliveredDate||null,commercial:j.commercial,parts_status:j.partsStatus,supplement_needed:j.supplementStatus==='None'?'No':'Yes',supplement_approved:j.supplementStatus==='Approved'?'Yes':'No',end_of_day_notes:j.notes,legacy_board_id:j.id};validate('daily',fields);return {legacyId:j.id,fields};
 });
 const appointments=data.appointments.filter(a=>!a.id.startsWith('sample-')).map(a=>({legacy_board_id:a.id,jobLegacyId:a.jobId,title:a.title,appointment_type:name('appointmentTypes',a.type),appointment_date:a.date,appointment_time:a.time,duration:a.duration,location:name('locations',a.location),notes:a.notes}));
 return {jobs,appointments};
}
async function revision(db){return (await db.query(`SELECT md5(coalesce((SELECT string_agg(id::text||updated_at::text,',' ORDER BY id) FROM daily_go_list),'')||coalesce((SELECT string_agg(id::text||updated_at::text,',' ORDER BY id) FROM appointments),'')) AS revision`)).rows[0].revision;}
module.exports={prepareLegacy,revision};
