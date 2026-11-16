const fs=require('fs');
for(const p of ['APP_PLAN.md','TRACKER.md']){
 let s=fs.readFileSync(p,'utf8');
 s=s.replaceAll('Local implementation and reviewed migration preparation are authorized; no live financial merges/deletes, hosted migration application, backend deployment or replacement APK is implied.','Owner subsequently approved the reviewed hosted migration and replacement APK/Drive/email delivery on 2026-11-15. The migration is applied; no bulk financial merges/deletes are authorized.');
 s=s.replace('Local migration preparation is authorized, hosted apply is not.','Owner approved hosted apply on 2026-11-15; applied as migration 20261115230945.');
 s=s.replace('Hosted rollout and replacement APK remain separately authorized steps.','Hosted migration applied under owner approval; replacement APK delivery in progress.');
 s=s.replace('LOCAL IMPLEMENTATION COMPLETE; awaiting separately authorized hosted rollout and replacement APK/device acceptance.','BACKEND DEPLOYED; replacement APK build and delivery in progress. Physical-device acceptance pending.');
 s=s.replace('No hosted/device/build operations. CLI live-history check unavailable because project ref is not linked; verify through authorized connection before rollout.','Hosted connector verified target/history, applied migration, matching source hash and privileges. Debts/bills/settings fingerprints unchanged; unauthenticated invocation denied. No device operation. Initial build hit ReadOnly generated BuildConfig directories; attributes backed up and cleared on four exact directories, ACLs unchanged; rebuild in progress.');
 s=s.replace('No live financial mutation or new APK. See','No bulk financial mutation. APK delivery in progress. See');
 fs.writeFileSync(p,s);
}
fs.writeFileSync('scratch/unified-loans-2026-11-14/deployment-evidence.json',JSON.stringify({
 project:'bitepxsdujceoszbldhd',name:'debtfree-native-auth',migration:'20261115230945_unified_loan_atomic_save',applied:true,
 functionMd5:'c54d5dc8f75558bb7a56afe6b50bbd89',localBodyMatches:true,anonymousExecute:false,authenticatedExecute:true,
 unauthenticatedInvocation:'28000 rejection before writes',
 fingerprintsBeforeAndAfter:{debts:{rows:25,md5:'63e7b93613ccb27a639f255a3700a08a'},bills:{rows:15,md5:'3e4c96db26607c754244a997c67862d9'},settings:{rows:4,md5:'add1712ac9d112194c0c6f687e21fb77'}},
 securityAdvisors:'Authenticated SECURITY DEFINER RPC notice expected for this authority-gated entrypoint. Existing RPC notices, five RLS/no-policy informational notices, and leaked-password protection disabled notice remain outside scope.',
 noBulkFinancialMutation:true
},null,2)+'\n');

