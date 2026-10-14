const {pool}=require('./db');
const {sendTaskEmail,smtpConfigured}=require('./mailer');
const OVERDUE_DAYS=3;
// Shop display / board screens are logins, not people.
const KIOSK_ROLES="'display','shopboard'";
async function processCoreNotifications(){
 const db=await pool.connect();let locked=false;
 try {
  locked=(await db.query('SELECT pg_try_advisory_lock(840219) AS locked')).rows[0].locked;if(!locked)return;
  const events=(await db.query('SELECT * FROM core_events WHERE recipients_created=false ORDER BY created_at LIMIT 100')).rows;
  for(const event of events){
   await db.query('BEGIN');
   try {
    // Every staff member hears about every core (not just Settings -> recipients).
    const users=(await db.query(`SELECT id FROM users WHERE active=true AND receives_notifications=true AND role NOT IN (${KIOSK_ROLES})`)).rows;
    if(!users.length){await db.query('ROLLBACK');continue;}
    const part=(await db.query('SELECT parts_vehicle,parts_customer_name FROM parts WHERE id=$1',[event.part_id])).rows[0]||{};
    const car=[part.parts_vehicle,part.parts_customer_name].filter(Boolean).join(' · ');
    for(const user of users)await db.query(`INSERT INTO employee_notifications(event_id,user_id,title,message,link) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,user_id) DO NOTHING`,[event.id,user.id,`Core return required · RO ${event.ro_number||'unassigned'}`,`${event.description||'Part'} has a core${car?` (${car})`:''}. Keep the old part and return it within ${OVERDUE_DAYS} days.`,{type:'core',ro:event.ro_number,partId:event.part_id}]);
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
// A core still not returned OVERDUE_DAYS after the part was marked Has a core: one urgent
// email to all staff, listing every newly overdue core. Sent once per core; unticking Core
// returned or re-ticking Has a core restarts the clock (migrations/033).
async function checkOverdueCores(){
 if(!smtpConfigured())return {sent:0};
 // Claim the cores first so a restart or second server can't email them twice.
 const cores=(await pool.query(`UPDATE parts SET core_overdue_alerted_at=now()
   WHERE has_core AND NOT core_returned AND core_flagged_at<=now()-make_interval(days=>$1)
     AND (core_overdue_alerted_at IS NULL OR core_overdue_alerted_at<core_flagged_at)
   RETURNING parts_ro_number,parts_customer_name,parts_vehicle,part_description,part_assigned_to,core_flagged_at`,[OVERDUE_DAYS])).rows;
 if(!cores.length)return {sent:0};
 const users=(await pool.query(`SELECT email FROM users WHERE active=true AND receives_notifications=true AND email IS NOT NULL AND email<>'' AND role NOT IN (${KIOSK_ROLES})`)).rows;
 const n=cores.length;
 const subject=`URGENT: core${n===1?'':'s'} not returned in ${OVERDUE_DAYS} days · ${cores.map(c=>`RO ${c.parts_ro_number||'unassigned'}`).join(', ')}`;
 const bodyLines=[`${n===1?'This core has':'These cores have'} not been returned ${OVERDUE_DAYS} days after the part was marked Has a core. This needs to be addressed immediately.`,'',
  ...cores.flatMap(c=>[`RO ${c.parts_ro_number||'unassigned'} · ${c.part_description||'Part'}`,`   ${[c.parts_vehicle,c.parts_customer_name].filter(Boolean).join(' · ')}${c.part_assigned_to?` · Assigned to ${c.part_assigned_to}`:''} · Core since ${new Date(c.core_flagged_at).toLocaleDateString('en-US',{timeZone:process.env.BUSINESS_TIMEZONE||'America/Los_Angeles'})}`,'']),
  'Return the core, then tick Core returned on the part in ShopControl → Parts.'];
 let sent=0;
 for(const u of users){try{if((await sendTaskEmail({to:u.email,subject,title:subject,bodyLines})).sent)sent++;}catch(e){console.error('Overdue core email failed:',e.message);}}
 console.log(`Cores: ${n} not returned in ${OVERDUE_DAYS} days, emailed ${sent} of ${users.length} staff.`);
 return {sent,cores:n};
}
function startCoreNotifications(){if(process.env.CORE_NOTIFICATIONS_ENABLED==='false')return;const run=()=>processCoreNotifications().then(()=>checkOverdueCores()).catch(e=>console.error('Core notifications:',e.message));run();const timer=setInterval(run,30000);timer.unref();}
module.exports={processCoreNotifications,checkOverdueCores,startCoreNotifications,OVERDUE_DAYS};
