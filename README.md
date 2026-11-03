# 🏥 IPD Paperless System (`v2.6.0`)
**ระบบเวชระเบียนผู้ป่วยในแบบไร้กระดาษ (Smart Inpatient Electronic Medical Record)**  
เชื่อมโยงฐานข้อมูล **HOSxP (`hos` schema)** แบบ Real-time (Two-Way Live Sync) พร้อมระบบประเมินคุณภาพเวชระเบียน **MRA 2026** และรองรับการใช้งานผ่าน **Desktop, iPad, Tablet, iPhone และสมาร์ทโฟน (PWA)**

---

## ✨ คุณสมบัติหลัก (Key Features)

### 1. 🔗 เชื่อมโยงฐานข้อมูล HOSxP แบบไป-กลับ (Two-Way HOSxP Live Sync)
- **Authentication (`opduser` & `doctor`)**: เข้าสู่ระบบด้วย Username/Password จากตาราง `opduser` ของ HOSxP พร้อมระบบจัดการผู้ใช้และรีเซ็ตรหัสผ่านสำหรับ Admin
- **Primary Key Serial Sync (`serial`)**: ซิงค์ลำดับหมายเลข `nurse_note_id`, `ipd_doctor_order_id`, `ipt_diag_id`, และ `med_plan_number` ร่วมกับตาราง `serial` ของ HOSxP ป้องกันข้อมูลชนกับ HOSxP Desktop 100%
- **Vital Signs & TPR Flow Sheet (`ipd_nurse_note`)**: บันทึกสัญญาณชีพ คำนวณ BMI และคะแนนเตือนวิกฤต **SOS / NEWS2 Score** อัตโนมัติแบบ Real-time
- **Nurse Focus Charting - FDAR & Fluid I/O (`ipd_nurse_note`)**: บันทึกทางการพยาบาลแบบ Focus Charting และสารน้ำเข้า-ออก พร้อมปุ่มลัด 1-Tap Clinical Templates
- **Doctor Progress Notes - SOAP (`ipd_doctor_order`)**: บันทึกความก้าวหน้าการรักษาของแพทย์ พร้อมปุ่มดึงสัญญาณชีพล่าสุดใส่ช่อง `O: Objective` อัตโนมัติ
- **Medication & Order Entry (`medplan_ipd`)**: ค้นหายาและเวชภัณฑ์จาก `drugitems` / `nondrugitems` สั่งยาและสั่งหยุดยา (`Off Order`) ซิงค์ตรงเข้า HOSxP
- **e-MAR (`ipd_nurse_note`)**: บันทึกการบริหารยาตามรอบเวลาและการ Hold ยาของพยาบาล
- **ICD-10 Diagnosis Coding (`iptdiag` & `ipt.prediag`)**: ค้นหารหัสโรคจาก `icd101` (ทั้งชื่อไทยและอังกฤษ) บันทึก Principal Diagnosis / Comorbidity / Complication ลงตาราง `iptdiag`
- **Admission & Physical Exam 7 Systems (`opdscreen` & `ipt`)**: บันทึกประวัติและตรวจร่างกายแรกรับครบ 7 ระบบ พร้อมปุ่มลัด `1-Tap Normal PE`
- **Discharge Approval & Delegation (`ipt`)**: ระบบอนุมัติสรุปเวชระเบียนคู่ขนาน (แพทย์และพยาบาล) มอบหมายงานแทน พร้อมซิงค์ `dchdate`, `dchtime`, `dchstts`, `dchtype` เข้าตาราง `ipt`

### 2. 🖨️ ระบบพิมพ์เอกสารเวชระเบียน A4 & ส่งออก PDF (`ClinicalDocEngine`)
- พรีวิวและสั่งพิมพ์เอกสารมาตรฐาน A4 คมชัดตรงตามหน้าเว็บ 100% พร้อมประทับลายเซ็นดิจิทัล:
  1. ใบสรุปการรักษาพยาบาลผู้ป่วยใน (Inpatient Discharge Summary)
  2. ใบสั่งการรักษาและแผนการใช้ยา (Doctor Order Sheet)
  3. ใบบันทึกทางการพยาบาล (Nurse Focus Charting)
  4. ใบประเมินแรกรับและตรวจร่างกาย 7 ระบบ (Admission & PE)
  5. ใบบันทึกสารน้ำเข้า-ออก (Fluid Balance I/O Sheet)

### 3. 📱 รองรับ iPad, Tablet, iPhone และสมาร์ทโฟน (PWA Standalone)
- รองรับ **Add to Home Screen** บน iPadOS / iOS และ Android เปิดใช้งานเต็มจอพร้อมแถบเมนูด่วนด้านล่าง (Quick Action Bottom Bar)

---

## 🚀 การติดตั้งและรันระบบ (Installation)

```bash
npm install
node server.js
```

- **Default Port**: `3508` (`http://localhost:3508`)
