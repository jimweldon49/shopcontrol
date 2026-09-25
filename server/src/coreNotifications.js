const {pool}=require('./db');
const {sendTaskEmail,smtpConfigured}=require('./mailer');
async function processCoreNotifications(){
 const db=await pool.connect();let locked=false;
 try {
  locked=(await db.query('SELECT pg_try_advisory_lock(840219) AS locked')).rows[0].locked;if(!locked)return;
  const events=(await db.query('SELECT * FROM core_events WHERE recipients_created=false ORDER BY created_at LIMIT 100')).rows;
  for(const event of events){
   await db.query('BEGIN');
   try {
    const config=(await db.query('SELECT data FROM board_settings WHERE id=1')).rows[0]?.data||{};
    const users=(await db.query(`SELECT id FROM users WHERE active=true AND receives_notifications=true AND
     (id::text=ANY($1::text[]) OR lower(coalesce(full_name,''))=lower($2) OR lower(username)=lower($2)
      OR (cardinality($1::text[])=0 AND role IN ('owner','admin','office','parts')))`,[config.coreRecipients||[],event.assigned_to||'__unassigned__'])).rows;
    if(!users.length){await db.query('ROLLBACK');continue;}
    for(const user of users)await db.query(`INSERT INTO employee_notifications(event_id,user_id,title,message) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,user_id) DO NOTHING`,[event.id,user.id,`Core return required · RO ${event.ro_number||'unassigned'}`,`${event.description||'Part'} has a core. Retain the old part and arrange its return.`]);
    await db.query('UPDATE core_events SET recipients_created=true WHERE id=$1',[event.id]);await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK');throw e;}
  }
  if(!smtpConfigured())return;
  const pending=(await db.query(`SELECT n.*,u.email,u.full_name FROM employee_notifications n JOIN users u ON u.id=n.user_id
    WHERE n.event_id IS NOT NULL AND n.email_sent_at IS NULL AND n.email_attempts<10 AND u.active=true AND u.receives_notifications=true AND u.email IS NOT NULL
    AND (n.email_attempted_at IS NULL OR n.email_attempted_at<now()-interval '5 minutes') ORDER BY n.created_at LIMIT 50`)).rows;
  for(const n of pending){
   await db.query('UPDATE employee_notifications SET email_attempts=email_attempts+1,email_attempted_at=now() WHERE id=$1',[n.id]);
   try{const result=await sendTaskEmail({to:n.email,subject:n.title,title:n.title,bodyLines:[n.message,'Open Parts in Shop Control to mark the core returned.']});if(result.sent)await db.query('UPDATE employee_notifications SET email_sent_at=now() WHERE id=$1',[n.id]);}catch(e){console.error('Core notification email failed:',e.message);}
  }
 }finally{if(locked)await db.query('SELECT pg_advisory_unlock(840219)');db.release();}
}
function startCoreNotifications(){if(process.env.CORE_NOTIFICATIONS_ENABLED==='false')return;const run=()=>processCoreNotifications().catch(e=>console.error('Core notifications:',e.message));run();const timer=setInterval(run,30000);timer.unref();}
module.exports={processCoreNotifications,startCoreNotifications};
