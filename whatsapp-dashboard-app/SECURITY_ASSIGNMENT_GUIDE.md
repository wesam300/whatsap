# دليل تنفيذ واجب أمان البرمجيات
# Security Assignment Implementation Guide

## نظرة عامة / Overview
هذا الدليل يشرح كيفية تطبيق جميع عمليات أمان البرمجيات المطلوبة على مشروع `whatsapp-dashboard-app`:
- SAST (Static Application Security Testing)
- DAST (Dynamic Application Security Testing)  
- SCA (Software Composition Analysis)
- Triaging (DefectDojo)
- كتابة تقرير الثغرات

---

## 1. SAST - Static Application Security Testing

### 1.1 استخدام SemGrep

#### التثبيت:
```bash
# Windows (PowerShell)
pip install semgrep

# أو باستخدام pipx (موصى به)
pipx install semgrep
```

#### التشغيل:

**✅ الحل المضمون (استخدم هذا أولاً - لا يحتاج encoding):**

```powershell
# ⚠️ إذا ظهرت رسالة "lexing: empty token" أو "Scanning 0 files":
# استخدم الحل المباشر بتحديد الملفات (يعمل دائماً)

# الحل المباشر - تحديد الملفات الأساسية (✅ موصى به - يعمل دائماً):
semgrep --config="p/javascript" server.js api-routes.js db.js api-key-manager.js session-manager.js notification-system.js cleanup-chrome-processes.js emailService.js firebase-config.js multi-email-service.js package-manager.js sendgrid-service.js update-server.js --json -o semgrep-results.json

# أو الحل السريع (بدون security-audit - أسرع):
semgrep --config="p/javascript" --no-git-ignore --exclude="node_modules/**" --exclude="public/**" --exclude="sessions/**" . --json -o semgrep-results.json

# الحل الكامل (مع security-audit - أبطأ لكن أشمل):
semgrep --config="p/javascript" --config="p/security-audit" --no-git-ignore --exclude="node_modules/**" --exclude="public/**" --exclude="sessions/**" . --json -o semgrep-results.json
```

**💡 نصيحة:** إذا كان التحميل بطيئاً أو ظهرت أخطاء، استخدم الحل المباشر (تحديد الملفات) - سيعطيك نتائج فورية.

**⚠️ حل مشكلة Encoding في Windows (إذا ظهرت خطأ Unicode مع --config=auto):**

```powershell
# الحل 1: تغيير encoding في PowerShell إلى UTF-8
$env:PYTHONIOENCODING="utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001

# ثم شغّل SemGrep (لكن هذا قد لا يعمل بسبب مشكلة في SemGrep نفسه)
semgrep --config=auto . --json -o semgrep-results.json
```

**أو الحل 2: استبعاد الملفات التي تحتوي على نصوص عربية:**

```bash
# فحص مع استبعاد ملفات HTML و JS العامة (التي تحتوي على نصوص عربية)
semgrep --config=auto . --exclude="public/**" --json -o semgrep-results.json

# أو فحص ملفات JavaScript فقط
semgrep --config=auto --include="*.js" --exclude="node_modules/**" --exclude="public/**" . --json -o semgrep-results.json
```

**أو الحل 3: استخدام config محدد بدلاً من auto (✅ موصى به - يعمل دائماً):**

```powershell
# هذا الحل يتجنب تحميل القواعد من السجل (الذي يسبب مشكلة encoding)
# استخدم config محدد من القواعد المدمجة
semgrep --config="p/javascript" --exclude="node_modules/**" --exclude="public/**" --exclude="sessions/**" . --json -o semgrep-results.json

# أو مع قواعد أمان محددة
semgrep --config="p/javascript" --config="p/security-audit" --exclude="node_modules/**" --exclude="public/**" . --json -o semgrep-results.json
```

**✅ الحل الأفضل والأسرع (استخدام .semgrepignore):**

تم إنشاء ملف `.semgrepignore` في المشروع. الآن استخدم:

```powershell
# هذا سيعمل بدون مشاكل encoding
semgrep --config="p/javascript" --config="p/security-audit" . --json -o semgrep-results.json
```

**أو الحل 4: استخدام CMD بدلاً من PowerShell:**

```cmd
chcp 65001
set PYTHONIOENCODING=utf-8
semgrep --config=auto . --json -o semgrep-results.json
```

#### تحليل النتائج:

**ملاحظة:** الإصدارات الحديثة من SemGrep لا تدعم `--html`. استخدم JSON ثم حوّله:

```powershell
# 1. إنشاء ملف JSON (الأساسي)
semgrep --config="p/javascript" --exclude="node_modules/**" --exclude="public/**" . --json -o semgrep-results.json

# 2. عرض النتائج في Terminal (بسيط)
semgrep --config="p/javascript" --exclude="node_modules/**" --exclude="public/**" .

# 3. إنشاء تقرير نصي
semgrep --config="p/javascript" --exclude="node_modules/**" --exclude="public/**" . > semgrep-results.txt
```

**لإنشاء تقرير HTML (اختياري):**
- استخدم أداة خارجية مثل `semgrep-sarif` أو حوّل JSON يدوياً
- أو استخدم DefectDojo لاستيراد JSON وإنشاء تقرير HTML

**تحليل النتائج:**
- راجع الملف: `semgrep-results.json` (استخدم محرر JSON أو أداة online)
- ركز على: SQL Injection, XSS, Authentication Issues, Hardcoded Secrets

---

### 1.2 استخدام SonarQube

#### التثبيت (Docker - الأسهل):
```bash
# تشغيل SonarQube
docker run -d --name sonarqube -e SONAR_ES_BOOTSTRAP_CHECKS=1 -p 9000:9000 sonarqube:latest

# أو استخدام SonarCloud (مجاني للـ Open Source)
# سجل على https://sonarcloud.io
```

#### إعداد المشروع:
1. أنشئ ملف `sonar-project.properties` في `whatsapp-dashboard-app/`:
```properties
sonar.projectKey=whatsapp-dashboard-app
sonar.sources=.
sonar.exclusions=node_modules/**,public/**,sessions/**,.wwebjs_cache/**
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.sourceEncoding=UTF-8
```

2. تثبيت SonarScanner:
```bash
# Windows
# تحميل من: https://docs.sonarqube.org/latest/analysis/scan/sonarscanner/
# أو استخدام npm
npm install -g sonarqube-scanner
```

#### التشغيل:
```bash
cd whatsapp-dashboard-app
sonar-scanner
```

#### الوصول للنتائج:
- افتح: http://localhost:9000
- الافتراضي: admin/admin (يطلب تغيير كلمة المرور)

---

## 2. DAST - Dynamic Application Security Testing

### 2.1 استخدام OWASP ZAP

#### التثبيت:
```bash
# Windows - تحميل من:
# https://www.zaproxy.org/download/

# أو استخدام Docker
docker run -d -p 8080:8080 -p 8090:8090 owasp/zap2docker-stable zap.sh -daemon -host 0.0.0.0 -port 8080 -config api.disablekey=true
```

#### التشغيل:
1. **تشغيل السيرفر أولاً:**
```bash
cd whatsapp-dashboard-app
npm start
# السيرفر يعمل على http://localhost:3000 (افتراضي)
```

2. **تشغيل ZAP:**
```bash
# طريقة 1: واجهة رسومية
# شغّل zap.bat أو zap.sh

# طريقة 2: سطر الأوامر
zap-cli quick-scan --self-contained --start-options '-config api.disablekey=true' http://localhost:3000

# طريقة 3: Docker
docker run -t owasp/zap2docker-stable zap-baseline.py -t http://host.docker.internal:3000
```

3. **حفظ النتائج:**
```bash
zap-cli report -o zap-report.html -f html
zap-cli report -o zap-report.json -f json
```

---

### 2.2 استخدام SQLMap

#### التثبيت:
```bash
# Windows
# تحميل من: https://github.com/sqlmapproject/sqlmap/zipball/master
# أو استخدام pip
pip install sqlmap
```

#### التشغيل:
```bash
# فحص نقطة API معينة
sqlmap -u "http://localhost:3000/api/login" --data="email=test@test.com&password=test" --batch

# فحص مع cookies
sqlmap -u "http://localhost:3000/api/users" --cookie="session=xxx" --batch

# حفظ النتائج
sqlmap -u "http://localhost:3000/api/login" --batch -o sqlmap-results.txt
```

**ملاحظة:** تأكد أن السيرفر يعمل قبل الفحص.

---

### 2.3 استخدام Sn1per

#### التثبيت:
```bash
# Linux/WSL
git clone https://github.com/1N3/Sn1per.git
cd Sn1per
./install.sh

# Windows - استخدام WSL أو Docker
docker run -it --rm -v $(pwd):/results xerosecurity/sn1per
```

#### التشغيل:
```bash
# فحص شامل
sniper -t http://localhost:3000 -m full

# فحص سريع
sniper -t http://localhost:3000 -m quick
```

---

## 3. SCA - Software Composition Analysis

### 3.1 استخدام Trivy

#### التثبيت:
```bash
# Windows
scoop install trivy
# أو تحميل من: https://github.com/aquasecurity/trivy/releases
```

#### التشغيل:
```bash
cd whatsapp-dashboard-app

# فحص الحزم
trivy fs .

# فحص package.json
trivy fs --scanners vuln,secret,config .

# حفظ النتائج
trivy fs . -f json -o trivy-results.json
trivy fs . -f table -o trivy-results.txt
```

---

### 3.2 استخدام DependencyTrack

#### التثبيت (Docker):
```bash
# تشغيل DependencyTrack
docker run -d -p 8080:8080 --name dependency-track -v dependency-track:/data owasp/dependency-track

# الوصول: http://localhost:8080
# الافتراضي: admin/admin
```

#### الاستخدام:
1. أنشئ مشروع جديد في DependencyTrack
2. ارفع ملف `package-lock.json`:
```bash
# تصدير package-lock.json
cd whatsapp-dashboard-app
cp package-lock.json dependency-track-upload.json

# أو استخدام API
curl -X "POST" "http://localhost:8080/api/v1/bom" \
  -H "X-Api-Key: YOUR_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "project=YOUR_PROJECT_UUID" \
  -F "bom=@package-lock.json"
```

---

### 3.3 استخدام GitHub Dependabot

#### الإعداد:
1. أنشئ ملف `.github/dependabot.yml` في المجلد الرئيسي:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/whatsapp-dashboard-app"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

2. ارفع المشروع إلى GitHub (إن لم يكن موجوداً)

3. Dependabot سيعمل تلقائياً ويرسل Pull Requests للثغرات

#### عرض النتائج:
- اذهب إلى: GitHub Repository → Security → Dependabot alerts

---

## 4. Triaging - DefectDojo

### 4.1 تثبيت DefectDojo

#### باستخدام Docker (الأسهل):
```bash
# Clone المشروع
git clone https://github.com/DefectDojo/django-DefectDojo.git
cd django-DefectDojo

# تشغيل
docker-compose up -d

# الوصول: http://localhost:8080
# الافتراضي: admin/admin
```

### 4.2 استيراد النتائج

#### خطوات الاستيراد:
1. **من SemGrep:**
   - Products → Add Product → "WhatsApp Dashboard"
   - Engagements → Add Engagement
   - Import Scan Results → SemGrep JSON → ارفع `semgrep-results.json`

2. **من OWASP ZAP:**
   - Import Scan Results → OWASP ZAP XML → ارفع `zap-report.xml`

3. **من Trivy:**
   - Import Scan Results → Trivy JSON → ارفع `trivy-results.json`

4. **من SonarQube:**
   - Import Scan Results → SonarQube JSON → ارفع نتائج SonarQube

### 4.3 Triaging (تصنيف الثغرات)

1. **اذهب إلى Findings**
2. **صنّف كل ثغرة:**
   - **Severity:** Critical, High, Medium, Low, Info
   - **Status:** Active, Verified, Mitigated, False Positive
   - **Assignee:** حدد المسؤول
   - **Tags:** أضف tags مثل "SQL Injection", "XSS", etc.

3. **أنشئ تقرير:**
   - Reports → Generate Report
   - اختر Template → Executive Summary أو Detailed Report

---

## 5. كتابة تقرير الثغرات

### 5.1 هيكل التقرير الموصى به:

```markdown
# تقرير أمان البرمجيات - WhatsApp Dashboard App
# Security Assessment Report

## 1. Executive Summary
- نظرة عامة على المشروع
- ملخص النتائج
- إحصائيات الثغرات

## 2. Methodology
- الأدوات المستخدمة (SAST, DAST, SCA)
- نطاق الفحص
- التواريخ

## 3. Findings

### 3.1 Critical Vulnerabilities
- [ID] SQL Injection in /api/login
- [ID] Hardcoded API Keys
- ...

### 3.2 High Vulnerabilities
- [ID] XSS in user input
- [ID] Weak session management
- ...

### 3.3 Medium Vulnerabilities
- [ID] Missing security headers
- [ID] Weak password policy
- ...

### 3.4 Low Vulnerabilities
- [ID] Information disclosure
- [ID] Missing rate limiting on some endpoints
- ...

## 4. Recommendations
- إصلاحات مقترحة لكل ثغرة
- أفضل الممارسات

## 5. Appendix
- نتائج الأدوات (Screenshots)
- Logs
- Configuration files
```

### 5.2 إنشاء التقرير من DefectDojo:

1. اذهب إلى **Reports**
2. اختر **Generate Report**
3. اختر **Executive Summary** أو **Detailed Report**
4. حدد **Engagement**
5. **Export** كـ PDF أو HTML

---

## 6. سكريبتات مساعدة سريعة

### 6.1 سكريبت تشغيل جميع الفحوصات (Windows - PowerShell):

أنشئ ملف `run-all-security-scans.ps1`:

```powershell
# run-all-security-scans.ps1
Write-Host "Starting Security Scans..." -ForegroundColor Green

# 1. SAST - SemGrep
Write-Host "Running SemGrep..." -ForegroundColor Yellow
semgrep --config=auto . --json -o semgrep-results.json

# 2. SCA - Trivy
Write-Host "Running Trivy..." -ForegroundColor Yellow
trivy fs . -f json -o trivy-results.json

# 3. SonarQube (يجب أن يكون SonarQube يعمل)
Write-Host "Running SonarQube Scanner..." -ForegroundColor Yellow
sonar-scanner

Write-Host "Scans completed! Check results files." -ForegroundColor Green
```

### 6.2 سكريبت تشغيل DAST (بعد تشغيل السيرفر):

```powershell
# run-dast-scans.ps1
Write-Host "Starting DAST Scans..." -ForegroundColor Green
Write-Host "Make sure server is running on http://localhost:3000" -ForegroundColor Yellow

# OWASP ZAP
Write-Host "Running OWASP ZAP..." -ForegroundColor Yellow
zap-cli quick-scan --self-contained http://localhost:3000
zap-cli report -o zap-report.html -f html

# SQLMap
Write-Host "Running SQLMap..." -ForegroundColor Yellow
sqlmap -u "http://localhost:3000/api/login" --batch -o sqlmap-results.txt

Write-Host "DAST scans completed!" -ForegroundColor Green
```

---

## 7. ترتيب التنفيذ الموصى به

### اليوم 1: SAST & SCA
1. ✅ تثبيت SemGrep وتشغيله
2. ✅ تثبيت Trivy وتشغيله
3. ✅ تثبيت SonarQube وتشغيله
4. ✅ جمع النتائج

### اليوم 2: DAST
1. ✅ تشغيل السيرفر (`npm start`)
2. ✅ تثبيت وتشغيل OWASP ZAP
3. ✅ تشغيل SQLMap على نقاط API
4. ✅ جمع النتائج

### اليوم 3: Triaging & Reporting
1. ✅ تثبيت DefectDojo
2. ✅ استيراد جميع النتائج
3. ✅ تصنيف الثغرات (Triaging)
4. ✅ إنشاء التقرير النهائي

---

## 8. نصائح مهمة

1. **احفظ جميع النتائج** في مجلد `security-reports/`
2. **وثّق كل خطوة** بـ Screenshots
3. **راجع False Positives** - بعض الأدوات قد تعطي نتائج خاطئة
4. **ركز على Critical & High** أولاً
5. **استخدم DefectDojo** لتوحيد جميع النتائج في مكان واحد

---

## 9. الملفات المطلوبة في التقرير النهائي

- ✅ `semgrep-results.json` + `semgrep-report.html`
- ✅ `sonar-project.properties` + نتائج SonarQube
- ✅ `trivy-results.json` + `trivy-results.txt`
- ✅ `zap-report.html` + `zap-report.json`
- ✅ `sqlmap-results.txt`
- ✅ تقرير DefectDojo (PDF/HTML)
- ✅ التقرير النهائي المنسق (Word/PDF)

---

## 10. روابط مفيدة

- SemGrep: https://semgrep.dev/
- SonarQube: https://www.sonarqube.org/
- OWASP ZAP: https://www.zaproxy.org/
- Trivy: https://aquasecurity.github.io/trivy/
- DefectDojo: https://defectdojo.com/
- SQLMap: https://sqlmap.org/

---

**ملاحظة:** تأكد من الحصول على إذن قبل فحص أي سيرفر في بيئة الإنتاج. استخدم بيئة تطوير محلية فقط.

**Note:** Make sure you have permission before scanning any production server. Use local development environment only.

