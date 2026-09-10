const express=require('express');
const {pool}=require('../db');
const {requireAuth,requireAdmin,requirePermission}=require('../middleware/auth');
const {allowed,validate,bulk}=require('../unifiedValidation');
const model=require('../../../client/shared');
const {RESOURCES}=require('./records');
const {logActivity}=require('../activityLogger');
const router=express.Router();router.use(requireAuth);
function fail(res,e){console.error('Workspace request:',e.message);return res.status(e.status||400).json({error:e.message});}
router.get('/settings',async(req,res)=>{try{let row=(await pool.query('SELECT * FROM board_settings WHERE id=1')).rows[0];if(!row){await pool.query('INSERT INTO board_settings(id,data) VALUES(1,$1) ON CONFLICT DO NOTHING',[model.defaults()]);row=(await pool.query('SELECT * FROM board_settings WHERE id=1')).rows[0];}res.json(row);}catch(e){fail(res,e);}});
router.put('/settings',requireAdmin,async(req,res)=>{try{const {data,revision}=req.body;const defaults=model.defaults();if(!data||!Number.isInteger(revision))throw Error('Invalid settings.');for(const key of Object.keys(defaults)){if(!Array.isArray(data[key])||data[key].length>300||(key!=='coreRecipients'&&!data[key].length))throw Error(`Invalid ${key} list.`);if(key==='colors'){if(data[key].some(x=>!x||typeof x.name!=='string'||!x.name.trim()||x.name.length>120||!/^#[0-9a-f]{6}$/i.test(x.color)))throw Error('Invalid card color.');}else if(data[key].some(x=>typeof x!=='string'||!x.trim()||x.length>120))throw Error('Invalid setting value.');}
 const result=await pool.query('UPDATE board_settings SET data=$1,revision=revision+1,updated_at=now() WHERE id=1 AND revision=$2 RETURNING *',[data,revision]);if(!result.rows.length)return res.status(409).json({error:'Settings changed in another window. Refresh and try again.'});await logActivity({req,resource:'settings',action:'update',after:data,summary:'Updated shared board settings'});res.json(result.rows[0]);}catch(e){fail(res,e);}});
router.get('/notifications',async(req,res)=>{try{res.json((await pool.query('SELECT id,title,message,read_at,created_at FROM employee_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id])).rows);}catch(e){fail(res,e);}});
router.put('/notifications/:id/read',async(req,res)=>{try{res.json((await pool.query('UPDATE employee_notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at',[req.params.id,req.user.id])).rows[0]||{});}catch(e){fail(res,e);}});
router.get('/appointments',requirePermission('daily','list'),async(req,res)=>{try{res.json((await pool.query('SELECT * FROM appointments ORDER BY appointment_date,appointment_time')).rows);}catch(e){fail(res,e);}});
const apptCols=['job_id','title','appointment_type','appointment_date','appointment_time','duration','location','notes'];
function validateAppointment(b){if(!b.title?.trim()||b.title.length>300||!b.appointment_type?.trim()||!b.location?.trim())throw Error('Title, appointment type and location are required.');if(!/^\d{4}-\d{2}-\d{2}$/.test(b.appointment_date)||!/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(b.appointment_time))throw Error('A valid date and time are required.');if(!Number.isInteger(b.duration)||b.duration<5||b.duration>1440)throw Error('Duration must be 5–1,440 minutes.');}
router.post('/appointments',requirePermission('daily','create'),async(req,res)=>{try{validateAppointment(req.body);const values=apptCols.map(k=>req.body[k]||null);const who=req.user.fullName||req.user.username;const r=await pool.query(`INSERT INTO appointments(${apptCols.join(',')},created_by,updated_by) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')},$9,$9) RETURNING *`,[...values,who]);await logActivity({req,resource:'appointments',recordId:r.rows[0].id,action:'create',after:r.rows[0],summary:'Created linked appointment'});res.status(201).json(r.rows[0]);}catch(e){fail(res,e);}});
router.put('/appointments/:id',requirePermission('daily','update'),async(req,res)=>{try{validateAppointment(req.body);if(!req.body.expected_updated_at)throw Error('Refresh the appointment before saving.');const values=apptCols.map(k=>req.body[k]||null);const r=await pool.query(`UPDATE appointments SET ${apptCols.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=now(),updated_by=$9 WHERE id=$10 AND date_trunc('milliseconds',updated_at)=$11 RETURNING *`,[...values,req.user.fullName||req.user.username,req.params.id,req.body.expected_updated_at]);if(!r.rows.length)return res.status(409).json({error:'This appointment changed. Reopen it before saving.'});await logActivity({req,resource:'appointments',recordId:r.rows[0].id,action:'update',after:r.rows[0],summary:'Updated appointment'});res.json(r.rows[0]);}catch(e){fail(res,e);}});
router.delete('/appointments/:id',requirePermission('daily','delete'),async(req,res)=>{try{const result=await pool.query('DELETE FROM appointments WHERE id=$1 RETURNING *',[req.params.id]);if(!result.rows.length)return res.status(404).json({error:'Appointment not found.'});await logActivity({req,resource:'appointments',recordId:req.params.id,action:'delete',before:result.rows[0],summary:'Deleted appointment'});res.json({deleted:true});}catch(e){fail(res,e);}});
router.post('/parts/bulk',async(req,res,next)=>{const action=req.body.action==='delete'?'delete':'update';return requirePermission('parts',action)(req,res,next);},async(req,res)=>{
 let db;
 try{
  const body=bulk(req.body);if(!['update','delete'].includes(body.action))throw Error('Choose edit or delete.');
  db=await pool.connect();await db.query('BEGIN');
  const rows=(await db.query('SELECT * FROM parts WHERE id=ANY($1::uuid[]) AND btrim(parts_ro_number)=btrim($2) FOR UPDATE',[body.ids,body.ro_number])).rows;
  if(rows.length!==body.ids.length)throw Error('Some selected parts changed or belong to another RO. Refresh the group. No changes saved.');
  if(body.action==='delete')await db.query('DELETE FROM parts WHERE id=ANY($1::uuid[])',[body.ids]);
  else{validate('parts',body.patch);const columns=[...new Set([...RESOURCES.parts.columns,...allowed.parts])].filter(k=>Object.hasOwn(body.patch,k));if(!columns.length)throw Error('Choose at least one field to update.');const forbidden=['parts_ro_number','parts_customer_name','parts_vehicle'];if(columns.some(k=>forbidden.includes(k)))throw Error('Group edits cannot change vehicle identity.');const values=columns.map(k=>body.patch[k]===''?null:body.patch[k]);await db.query(`UPDATE parts SET ${columns.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=now(),updated_by=$${values.length+1} WHERE id=ANY($${values.length+2}::uuid[])`,[...values,req.user.fullName||req.user.username,body.ids]);}
  await db.query(`INSERT INTO activity_log(user_id,username,full_name,resource,action,summary,changes) VALUES($1,$2,$3,'parts',$4,$5,$6)`,[req.user.id,req.user.username,req.user.fullName,body.action,`Bulk ${body.action}: ${rows.length} parts for RO ${body.ro_number}`,JSON.stringify({before:rows,patch:body.patch||null})]);
  await db.query('COMMIT');res.json({count:rows.length});
 }catch(e){if(db)await db.query('ROLLBACK');fail(res,e);}finally{if(db)db.release();}
});
router.post('/import-board',requireAdmin,async(req,res)=>{
 let db;
 try{
  const {validateState}=await import('../../lib/legacyBoard.mjs');const data=validateState(req.body.data);if(data.demo)throw Error('Import real records, not a sample workspace.');
  const {prepareLegacy,revision}=require('../legacyImport');const prepared=prepareLegacy(data);db=await pool.connect();await db.query('BEGIN');
  await db.query('LOCK TABLE daily_go_list,appointments,board_settings IN SHARE ROW EXCLUSIVE MODE');const beforeRevision=await revision(db);
  const existing=(await db.query('SELECT * FROM daily_go_list')).rows;let create=0,update=0;const matches=new Map();
  for(const job of prepared.jobs){const found=existing.filter(j=>j.legacy_board_id===job.legacyId||String(j.ro_number||'').trim()===job.fields.ro_number);if(found.length>1)throw Error(`RO ${job.fields.ro_number} matches multiple records. Resolve that duplicate first.`);matches.set(job.legacyId,found[0]);found.length?update++:create++;}
  if(req.body.dryRun===true){await db.query('ROLLBACK');return res.json({create,update,appointments:prepared.appointments.length,revision:beforeRevision});}
  if(req.body.dryRun!==false||req.body.expectedRevision!==beforeRevision){const e=Error('The workspace changed. Review this import again before applying it.');e.status=409;throw e;}
  const ids=new Map(),who=req.user.fullName||req.user.username;
  for(const job of prepared.jobs){
   const existingJob=matches.get(job.legacyId);const fields={...job.fields};const keys=Object.keys(fields),values=Object.values(fields).map(v=>v===''?null:v);let result;
   if(existingJob){result=await db.query(`UPDATE daily_go_list SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_by=$${keys.length+1},updated_at=now() WHERE id=$${keys.length+2} RETURNING id`,[...values,who,existingJob.id]);}
   else{result=await db.query(`INSERT INTO daily_go_list(${keys.join(',')},created_by,updated_by,onsite) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')},$${keys.length+1},$${keys.length+1},false) RETURNING id`,[...values,who]);}
   ids.set(job.legacyId,result.rows[0].id);
  }
  for(const a of prepared.appointments){const fields={...a,job_id:ids.get(a.jobLegacyId)||null};delete fields.jobLegacyId;const keys=Object.keys(fields),values=Object.values(fields);await db.query(`INSERT INTO appointments(${keys.join(',')},created_by,updated_by) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')},$${keys.length+1},$${keys.length+1}) ON CONFLICT(legacy_board_id) WHERE legacy_board_id IS NOT NULL DO UPDATE SET ${keys.filter(k=>k!=='legacy_board_id').map(k=>k+'=EXCLUDED.'+k).join(',')},updated_at=now(),updated_by=EXCLUDED.updated_by`,[...values,who]);}
  const settingsRow=(await db.query('SELECT data FROM board_settings WHERE id=1')).rows[0];const settings=settingsRow?.data||model.defaults();
  for(const key of ['insurance','technicians','estimators','payTypes','locations','appointmentTypes','flags'])settings[key]=[...new Set([...settings[key],...data.settings[key].map(x=>x.name)])];
  for(const color of data.settings.colors)if(!settings.colors.some(c=>c.color===color.color))settings.colors.push({name:color.name,color:color.color});
  await db.query('INSERT INTO board_settings(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=$1,revision=board_settings.revision+1,updated_at=now()',[settings]);
  await db.query(`INSERT INTO activity_log(user_id,username,full_name,resource,action,summary) VALUES($1,$2,$3,'daily','import',$4)`,[req.user.id,req.user.username,req.user.fullName,`Imported Production Board: ${create} new jobs, ${update} updated; ${prepared.appointments.length} appointments.`]);
  await db.query('COMMIT');res.json({create,update,appointments:prepared.appointments.length});
 }catch(e){if(db)await db.query('ROLLBACK');fail(res,e);}finally{if(db)db.release();}
});
module.exports=router;
