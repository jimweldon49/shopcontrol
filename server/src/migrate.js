require('dotenv').config();
const fs=require('fs');const path=require('path');const {pool}=require('./db');
async function main(){
 if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL in server/.env before applying migrations.');
 if(process.argv.includes('--new'))await pool.query(fs.readFileSync(path.join(__dirname,'..','schema.sql'),'utf8'));
 const dir=path.join(__dirname,'..','migrations');
 for(const file of fs.readdirSync(dir).filter(f=>/^\d+.*\.sql$/.test(f)).sort()){await pool.query(fs.readFileSync(path.join(dir,file),'utf8'));console.log('Applied '+file);}
}
main().catch(e=>{console.error('Migration failed:',e.message);process.exitCode=1;}).finally(()=>pool.end());
