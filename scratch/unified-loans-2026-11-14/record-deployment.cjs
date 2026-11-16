const fs=require('fs'),crypto=require('crypto');
const old='20261115054327_unified_loan_atomic_save.sql', deployed='20261115230945_unified_loan_atomic_save.sql';
const body=fs.readFileSync('supabase/migrations/'+old,'utf8');
const functionBody=body.split('AS $$')[1].split('$$;')[0];
console.log(JSON.stringify({localFunctionMd5:crypto.createHash('md5').update(functionBody).digest('hex'),expectedRemote:'c54d5dc8f75558bb7a56afe6b50bbd89'}));
fs.renameSync('supabase/migrations/'+old,'supabase/migrations/'+deployed);
for(const p of ['APP_PLAN.md','TRACKER.md','scratch/unified-loans-2026-11-14/report.md','scratch/unified-loans-2026-11-14/verify-atomic-sql.cjs','scratch/unified-loans-2026-11-14/verify-integrated-sql.cjs']){
 let s=fs.readFileSync(p,'utf8').split(old).join(deployed);fs.writeFileSync(p,s);
}
const note='> **T-275 LIVE STATE - 2026-11-15:** Approved unified-loan migration APPLIED through Supabase connector to bitepxsdujceoszbldhd as remote version 20261115230945. Local filename aligned to that recorded version. Debts/bills/settings fingerprints unchanged. Anonymous EXECUTE denied; authenticated EXECUTE granted with existing internal owner/admin authority; unauthenticated invocation rejected before writes. APK build/delivery in progress. This supersedes older local-only/unapplied/pending-approval statements for T-275 rollout.\n\n';
for(const p of ['APP_PLAN.md','TRACKER.md'])fs.writeFileSync(p,note+fs.readFileSync(p,'utf8'));

