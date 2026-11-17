from pathlib import Path
import hashlib,json,os,re,subprocess,zipfile
root=Path.cwd()
apk=root/'dist/BitLess-Android-Test-2026-11-15-T275.apk'
meta=apk.with_suffix('.json')
sdk=Path(os.environ['ANDROID_HOME'])
tools=sdk/'build-tools/37.0.0'
def run(args):
 return subprocess.check_output([str(x) for x in args],text=True,stderr=subprocess.STDOUT)
badging=run([tools/'aapt.exe','dump','badging',apk])
signature=run([tools/'apksigner.bat','verify','--verbose','--print-certs',apk])
old=run([tools/'apksigner.bat','verify','--print-certs',root/'dist/BitLess-Android-Test-2026-11-14-T272.apk'])
cert=lambda s: re.search(r'certificate SHA-256 digest: (\w+)',s).group(1)
assert cert(signature)==cert(old),'Signing identity changed'
package=re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'",badging)
assert package and package.groups()==('com.debtfree.nativetest','2','0.1.1'), 'Unexpected package/version'
abis=re.search(r"native-code: (.+)",badging).group(1).replace("'","").split()
assert 'arm64-v8a' in abis and 'armeabi-v7a' in abis
with zipfile.ZipFile(apk) as z:
 bundle=z.read('assets/index.android.bundle')
 assert b'bitepxsdujceoszbldhd' in bundle, 'Sandbox project missing'
 assert b'debtfree_upsert_household_loan_atomic' in bundle, 'Updated loan save missing'
paths=run(['git','ls-files','--cached','--others','--exclude-standard']).splitlines()
rootfiles={'App.tsx','index.ts','app.json','app.config.ts','package.json','package-lock.json','tsconfig.json','babel.config.js','metro.config.js'}
paths=sorted(set(p for p in paths if p.startswith(('src/','assets/','plugins/')) or p in rootfiles or p in {'android/app/build.gradle','android/gradle.properties','android/app/src/main/AndroidManifest.xml'}))
digest=hashlib.sha256()
for p in paths:
 file=root/p
 digest.update(p.encode()+b'\0')
 digest.update(hashlib.sha256(file.read_bytes()).digest() if file.is_file() else b'DELETED')
data=json.loads(meta.read_text())
data.update(package=package[1],versionCode=2,versionName='0.1.1',minSdk=int(re.search(r"sdkVersion:'(\d+)'",badging)[1]),abis=abis,sizeBytes=apk.stat().st_size,bundleSizeBytes=len(bundle),signerCertificateSha256=cert(signature),signature='APK signature verified; same debug certificate as delivered T-272 preview',sourceDirty=True,sourceDigestSha256=digest.hexdigest(),sourceDigestPathCount=len(paths),sourceDigestMethod='Sorted tracked/unignored app source/config/assets/plugins + native app Gradle/manifest paths; UTF-8 path + NUL + binary SHA256 content or DELETED. Environment files excluded.',sandboxProjectReferencePresentInBundle=True,unifiedLoanRpcPresentInBundle=True,backendProject='bitepxsdujceoszbldhd',backendMigrationVersion='20261115230945',buildCommand="assemblePreview --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a; version 0.1.1 (2)")
meta.write_text(json.dumps(data,indent=2)+'\n')
(root/'scratch/unified-loans-2026-11-14/apk-signature.txt').write_text(signature)
print(json.dumps(data,indent=2))

