const model=require('../../client/shared');
const allowed={daily:['onsite','insurance','pay_type','estimator','body_hours','paint_hours','other_hours','body_techs','painters','support_techs','board_flags','card_color','delivery_stage','planning_bucket','in_date','dropoff_date','pickup_date','follow_up_date','follow_up_notes','parts_status','commercial'],parts:['has_core','core_returned']};
function validate(resource,body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Expected an object.');
 if(resource==='daily'){
  if(body.current_stage!==undefined&&!model.stages.includes(body.current_stage))throw Error('Choose a valid current stage.');
  if(body.delivery_stage&&!model.delivery.includes(body.delivery_stage))throw Error('Choose a valid delivery stage.');
  if(body.planning_bucket!==undefined&&!model.planning.includes(body.planning_bucket))throw Error('Choose a valid planning week.');
  for(const k of ['ro_amount','body_hours','paint_hours','other_hours'])if(body[k]!==undefined&&body[k]!==null&&body[k]!==''&&(!Number.isFinite(Number(body[k]))||Number(body[k])<0))throw Error('Value and labor hours must be nonnegative numbers.');
  for(const k of ['body_techs','painters','support_techs','board_flags'])if(body[k]!==undefined&&(!Array.isArray(body[k])||body[k].length>100||body[k].some(x=>typeof x!=='string'||x.length>120)))throw Error('Invalid staff or flag list.');
  if(body.card_color&&!/^#[0-9a-f]{6}$/i.test(body.card_color))throw Error('Choose a valid card color.');
 }
 for(const k of ['onsite','commercial','has_core','core_returned'])if(body[k]!==undefined&&typeof body[k]!=='boolean')throw Error('Checkbox values must be true or false.');
 for(const k of ['in_date','dropoff_date','pickup_date','follow_up_date','target_delivery_date','actual_delivered_date'])if(body[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(body[k]))throw Error('Use a valid date.');
 return body;
}
function bulk(body){if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>2000||new Set(body.ids).size!==body.ids.length||body.ids.some(x=>!/^[-0-9a-f]{36}$/i.test(x)))throw Error('Select 1–2,000 unique parts.');if(typeof body.ro_number!=='string'||!body.ro_number.trim())throw Error('An RO number is required for group actions.');return body;}
module.exports={allowed,validate,bulk};
