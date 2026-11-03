/**
 * Clinical Document Engine Module (Deep Module)
 * ระบบรวมศูนย์สร้างและพิมพ์เอกสารเวชระเบียนผู้ป่วยใน (IPD Paperless)
 * โรงพยาบาลโคกศรีสุพรรณ
 */
(function (global) {
  'use strict';

  /**
   * สร้างบล็อกส่วนหัวเอกสารและกล่องข้อมูลผู้ป่วยมาตรฐาน A4
   */
  function generatePatientHeaderHtml(p, title, subTitle = '') {
    const admitStr = `${new Date(p.regdate).toLocaleDateString('th-TH')} ${p.regtime ? p.regtime.slice(0, 5) : ''}`;
    const dchStr = p.dchdate 
      ? `${new Date(p.dchdate).toLocaleDateString('th-TH')} ${p.dchtime ? p.dchtime.slice(0, 5) : ''}` 
      : '...................................................';
    const docName = p.approval?.assigned_doctor_name || p.doctor_name || '-';

    return `
      <div class="doc-header-block">
        <h2>โรงพยาบาลโคกศรีสุพรรณ (Khok Si Suphan Hospital)</h2>
        <h3>${title}</h3>
        ${subTitle ? `<div class="doc-sub">${subTitle}</div>` : ''}
      </div>

      <div class="doc-patient-box">
        <div class="pt-item"><strong>ชื่อ-สกุล:</strong> ${p.patient_name}</div>
        <div class="pt-item"><strong>HN:</strong> ${p.hn} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>AN:</strong> ${p.an}</div>
        <div class="pt-item"><strong>เพศ:</strong> ${p.sex === '1' ? 'ชาย' : 'หญิง'} &nbsp;&nbsp; <strong>อายุ:</strong> ${p.age || '-'} ปี</div>
        <div class="pt-item"><strong>สิทธิการรักษา:</strong> ${p.pttype_name || p.pttype || '-'}</div>
        <div class="pt-item"><strong>หอผู้ป่วย:</strong> ${p.ward_name} &nbsp;&nbsp; <strong>เตียง:</strong> ${p.bedno || p.bedname || 'รอจัดเตียง'}</div>
        <div class="pt-item"><strong>แพทย์เจ้าของไข้:</strong> ${docName}</div>
        <div class="pt-item"><strong>วันที่รับ (Admit):</strong> ${admitStr}</div>
        <div class="pt-item"><strong>วันที่จำหน่าย (Discharge):</strong> <span style="font-weight: 700;">${dchStr}</span> &nbsp;&nbsp; (<strong>LOS:</strong> ${p.los_days || 1} วัน)</div>
        <div class="pt-item" style="grid-column: 1 / -1;"><strong>ประวัติแพ้ยา:</strong> <span style="color: red; font-weight: 600;">${p.drugallergy || 'ปฏิเสธประวัติแพ้ยา'}</span></div>
      </div>
    `;
  }

  /**
   * แสดงลายเซ็นดิจิทัลและชื่อผู้ลงนามตามบทบาท
   */
  function renderSignatureStamp(roleType, defaultName, subLabel, p, currentUser) {
    const user = currentUser || {};
    const ap = p?.approval || {};
    let hasSig = false;
    let sigUrl = null;
    let signerName = defaultName || '...................................................';
    let extraLic = '';

    if (roleType === 'doctor') {
      signerName = ap.assigned_doctor_name || p?.doctor_name || defaultName || '...................................................';
      if (ap.attending_doctor_license) {
        extraLic = `(ว. ${ap.attending_doctor_license})`;
      } else if (p?.doctor_licenseno) {
        extraLic = `(ว. ${p.doctor_licenseno})`;
      }

      if (user && (user.doctorcode === (ap.assigned_doctor_code || p?.doctor_code) || user.is_doctor) && user.signature_url) {
        hasSig = true;
        sigUrl = user.signature_url;
      }
    } else if (roleType === 'nurse') {
      signerName = ap.assigned_nurse_name || (ap.is_locked ? (ap.assigned_nurse_name || 'พยาบาลประจำตึก') : (user?.name || defaultName || '...................................................'));
      if (user && user.signature_url && (!ap.is_locked || !ap.assigned_nurse_login || ap.assigned_nurse_login === user.loginname)) {
        hasSig = true;
        sigUrl = user.signature_url;
      }
    } else if (user?.signature_url) {
      hasSig = true;
      sigUrl = user.signature_url;
      signerName = user.name;
    }

    return `
      <div class="doc-sig-box" style="width: 240px; text-align: center; display: inline-block;">
        ${hasSig && sigUrl ? `
          <div style="height: 52px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 2px;">
            <img src="${sigUrl}" style="max-height: 48px; max-width: 190px; object-fit: contain;" alt="Digital Signature" />
          </div>
        ` : `
          <div style="height: 38px;"></div>
        `}
        <div class="doc-sig-line"></div>
        <div style="font-weight: 600; font-size: 11.5px;">( ${signerName} )</div>
        <div style="color: #64748b; font-size: 11px;">${subLabel} ${extraLic}</div>
      </div>
    `;
  }

  /**
   * 1. ใบสรุปการรักษาพยาบาลผู้ป่วยใน (Discharge Summary)
   */
  function generateDischargeSummaryHtml(p, d, currentUser) {
    const diags = d?.diagnoses || [];
    const meds = d?.home_medications || [];
    const ap = p.approval || {};
    const docName = ap.assigned_doctor_name || p.doctor_name || 'แพทย์เจ้าของไข้';
    const nurseName = ap.assigned_nurse_name || (ap.is_locked ? (ap.assigned_nurse_name || 'พยาบาลประจำตึก') : (currentUser?.name || 'พยาบาลประจำตึก'));

    const admitStr = `${new Date(p.regdate).toLocaleDateString('th-TH')} ${p.regtime ? p.regtime.slice(0, 5) : ''}`;
    const dchStr = p.dchdate 
      ? `${new Date(p.dchdate).toLocaleDateString('th-TH')} ${p.dchtime ? p.dchtime.slice(0, 5) : ''}` 
      : '-';
    const dchStatusStr = ap.dchstts_name || p.dchstts_name || 'Improved (ทุเลา)';
    const dchTypeStr = ap.dchtype_name || p.dchtype_name || 'With Approval (แพทย์อนุญาต)';

    return `
      ${generatePatientHeaderHtml(p, 'ใบสรุปการรักษาพยาบาลผู้ป่วยใน (Inpatient Discharge Summary)', 'กลุ่มงานการแพทย์และเวชระเบียน')}

      <div class="doc-section-title">1. ข้อมูลการรับและจำหน่ายผู้ป่วย (Admission & Discharge Details)</div>
      <table class="doc-table" style="margin-bottom: 12px;">
        <tbody>
          <tr>
            <td style="width: 25%; background: #f8fafc;"><strong>วันที่รับรักษา (Admit):</strong></td>
            <td style="width: 25%;">${admitStr}</td>
            <td style="width: 25%; background: #f8fafc;"><strong>วันที่จำหน่าย (Discharge):</strong></td>
            <td style="width: 25%;"><strong style="color: #059669;">${dchStr}</strong></td>
          </tr>
          <tr>
            <td style="background: #f8fafc;"><strong>สถานะการจำหน่าย (Status):</strong></td>
            <td>${dchStatusStr}</td>
            <td style="background: #f8fafc;"><strong>ประเภทการจำหน่าย (Type):</strong></td>
            <td>${dchTypeStr}</td>
          </tr>
          <tr>
            <td style="background: #f8fafc;"><strong>ระยะเวลานอน (LOS):</strong></td>
            <td><strong>${p.los_days || 1} วัน</strong></td>
            <td style="background: #f8fafc;"><strong>แพทย์ผู้สรุปจำหน่าย:</strong></td>
            <td><strong>${docName}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="doc-section-title">2. การวินิจฉัยโรค (Diagnoses & ICD-10 Coding)</div>
      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 28%;">ประเภทการวินิจฉัย</th>
            <th style="width: 18%;">ICD-10 Code</th>
            <th>ชื่อโรค / คำอธิบายการวินิจฉัย</th>
            <th style="width: 24%;">แพทย์ผู้วินิจฉัย</th>
          </tr>
        </thead>
        <tbody>
          ${diags.length > 0 ? diags.map(dg => {
            let typeLabel = 'Other';
            if (dg.diagtype === '1') typeLabel = 'Principal Diagnosis (โรคหลัก)';
            else if (dg.diagtype === '2') typeLabel = 'Comorbidity (โรคร่วม)';
            else if (dg.diagtype === '3') typeLabel = 'Complication (โรคแทรก)';
            return `
              <tr>
                <td><strong>${typeLabel}</strong></td>
                <td><span style="font-family: monospace; font-weight: 700; font-size: 13px;">${dg.icd10}</span></td>
                <td>${dg.icd_name || '-'}</td>
                <td>${dg.doctor_name || '-'}</td>
              </tr>
            `;
          }).join('') : `
            <tr><td colspan="4" style="text-align: center; color: #888;">ยังไม่มีการบันทึกการวินิจฉัยโรค</td></tr>
          `}
        </tbody>
      </table>

      <div class="doc-section-title">3. รายการยากลับบ้าน (Home Medications / Discharge Prescriptions)</div>
      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 35%;">ชื่อยาและความแรง</th>
            <th style="width: 15%;">จำนวน</th>
            <th>วิธีรับประทาน / คำสั่งใช้ยา (Signa)</th>
          </tr>
        </thead>
        <tbody>
          ${meds.length > 0 ? meds.map(m => `
            <tr>
              <td><strong>${m.drug_name}</strong> ${m.strength ? `(${m.strength})` : ''}</td>
              <td>${m.qty} ${m.units || ''}</td>
              <td>${m.usage_text || '-'}</td>
            </tr>
          `).join('') : `
            <tr><td colspan="3" style="text-align: center; color: #888;">ไม่มีรายการยากลับบ้าน</td></tr>
          `}
        </tbody>
      </table>

      <div class="doc-signature-row">
        ${renderSignatureStamp('doctor', docName, 'แพทย์ผู้สรุปเวชระเบียน / ผู้จำหน่าย', p, currentUser)}
        ${renderSignatureStamp('nurse', nurseName, 'พยาบาลหัวหน้าหอผู้ป่วย / ผู้ตรวจสอบ', p, currentUser)}
      </div>
    `;
  }

  /**
   * 2. ใบสั่งการรักษาและแผนการใช้ยาของแพทย์ (Doctor Order Sheet)
   */
  function generateOrdersSheetHtml(p, orders = [], currentUser) {
    const orderList = Array.isArray(orders) ? orders : (orders?.orders || orders?.data || []);
    return `
      ${generatePatientHeaderHtml(p, 'ใบสั่งการรักษาและแผนการใช้ยาของแพทย์ (Doctor Order Sheet)')}

      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 18%;">วัน-เวลาที่สั่ง</th>
            <th style="width: 12%;">ประเภท</th>
            <th style="width: 42%;">รายการยา / คำสั่งการรักษา</th>
            <th style="width: 10%;">จำนวน</th>
            <th style="width: 18%;">แพทย์ผู้สั่ง</th>
          </tr>
        </thead>
        <tbody>
          ${orderList.length > 0 ? orderList.map(o => `
            <tr>
              <td>${o.orderdate ? new Date(o.orderdate).toLocaleDateString('th-TH') : '-'} ${o.ordertime ? o.ordertime.slice(0, 5) : ''}</td>
              <td>
                <span class="badge-tag" style="background: ${o.item_type === 'DRUG' ? '#e0f2fe' : '#f1f5f9'}; color: ${o.item_type === 'DRUG' ? '#0369a1' : '#475569'};">
                  ${o.item_type === 'DRUG' ? '💊 ยา' : '🔬 ตรวจ/หัตถการ'}
                </span>
              </td>
              <td>
                <strong>${o.item_name || o.drug_name || o.order_item || o.icode || '-'}</strong> ${o.strength ? `(${o.strength})` : ''}
                ${o.usage_text ? `<div style="font-size: 11.5px; color: #334155; margin-top: 2px;">วิธีใช้: ${o.usage_text}</div>` : ''}
                ${o.doctor_note ? `<div style="font-size: 11px; color: #b45309;">Note: ${o.doctor_note}</div>` : ''}
              </td>
              <td>${o.qty || '-'} ${o.units || ''}</td>
              <td>${o.doctor_name || '-'}</td>
            </tr>
          `).join('') : `
            <tr><td colspan="5" style="text-align: center; color: #888; padding: 2rem;">ไม่มีรายการคำสั่งแพทย์ / แผนการใช้ยา</td></tr>
          `}
        </tbody>
      </table>

      <div class="doc-signature-row">
        ${renderSignatureStamp('doctor', p.approval?.assigned_doctor_name || p.doctor_name, 'แพทย์ผู้สั่งการรักษา', p, currentUser)}
        ${renderSignatureStamp('nurse', p.approval?.assigned_nurse_name || (currentUser?.name || ''), 'พยาบาลผู้รับคำสั่งการรักษา', p, currentUser)}
      </div>
    `;
  }

  /**
   * 3. ใบบันทึกความก้าวหน้าทางการพยาบาล (Nurse Progress Note)
   */
  function generateNurseNotesSheetHtml(p, notes = [], currentUser) {
    const noteList = Array.isArray(notes) ? notes : [];
    return `
      ${generatePatientHeaderHtml(p, 'ใบบันทึกความก้าวหน้าทางการพยาบาล (Nurse Progress Note)')}

      <table class="doc-table">
        <thead>
          <tr>
            <th style="width: 18%;">วัน-เวลา</th>
            <th style="width: 22%;">Focus / อาการสำคัญ</th>
            <th>บันทึกทางการพยาบาล (Data, Action, Response)</th>
            <th style="width: 20%;">พยาบาลผู้บันทึก</th>
          </tr>
        </thead>
        <tbody>
          ${noteList.length > 0 ? noteList.map(n => `
            <tr>
              <td>${n.note_date ? new Date(n.note_date).toLocaleDateString('th-TH') : '-'} ${n.note_time ? n.note_time.slice(0, 5) : ''}</td>
              <td><strong>${n.focus_name || 'การพยาบาลทั่วไป'}</strong></td>
              <td>${n.note || '-'}</td>
              <td>${n.staff || '-'}</td>
            </tr>
          `).join('') : `
            <tr><td colspan="4" style="text-align: center; color: #888; padding: 2rem;">ยังไม่มีบันทึกทางการพยาบาล</td></tr>
          `}
        </tbody>
      </table>

      <div class="doc-signature-row" style="justify-content: flex-end;">
        ${renderSignatureStamp('nurse', (noteList[0] ? noteList[0].staff : (currentUser?.name || '')), 'พยาบาลผู้บันทึก / หัวหน้าเวร', p, currentUser)}
      </div>
    `;
  }

  /**
   * 4. ใบประเมินแรกรับและตรวจร่างกาย (Admission Note & PE 7 Systems)
   */
  function generateAdmissionPeSheetHtml(p, pe = {}, currentUser) {
    return `
      ${generatePatientHeaderHtml(p, 'ใบประเมินแรกรับและตรวจร่างกาย (Admission Note & PE 7 Systems)')}

      <div class="doc-section-title">1. ประวัติการเจ็บป่วย (Medical History)</div>
      <div style="font-size: 12.5px; line-height: 1.6; margin-bottom: 10px;">
        <div><strong>อาการสำคัญ (CC):</strong> ${pe.cc || p.prediag || '-'}</div>
        <div><strong>ประวัติปัจจุบัน (HPI):</strong> ${pe.hpi || '-'}</div>
        <div><strong>ประวัติอดีตและโรคประจำตัว (PMH):</strong> ${pe.pmh || '-'}</div>
        <div><strong>ประวัติครอบครัว (FH):</strong> ${pe.fh || '-'}</div>
      </div>

      <div class="doc-section-title">2. การตรวจร่างกายแรกรับ (Physical Examination 7 Systems)</div>
      <table class="doc-table">
        <tbody>
          <tr><td style="width: 30%; font-weight: 600;">General Appearance (GA)</td><td>${pe.pe_ga || 'Normal consciousness, not pale, no jaundice'}</td></tr>
          <tr><td style="font-weight: 600;">HEENT</td><td>${pe.pe_heent || 'Normal pharynx, not injected'}</td></tr>
          <tr><td style="font-weight: 600;">Heart / Cardiovascular</td><td>${pe.pe_heart || 'Normal S1 S2, no murmur'}</td></tr>
          <tr><td style="font-weight: 600;">Lungs / Respiratory</td><td>${pe.pe_lung || 'Clear, normal breath sounds bilaterally'}</td></tr>
          <tr><td style="font-weight: 600;">Abdomen</td><td>${pe.pe_ab || 'Soft, not tender, no distension'}</td></tr>
          <tr><td style="font-weight: 600;">Extremities</td><td>${pe.pe_ext || 'No edema, good capillary refill'}</td></tr>
          <tr><td style="font-weight: 600;">Neurological Exam</td><td>${pe.pe_neuro || 'E4V5M6, Motor power grade V all'}</td></tr>
        </tbody>
      </table>

      <div class="doc-signature-row">
        ${renderSignatureStamp('doctor', p.approval?.assigned_doctor_name || p.doctor_name, 'แพทย์ผู้ตรวจแรกรับ', p, currentUser)}
        ${renderSignatureStamp('nurse', p.approval?.assigned_nurse_name || (currentUser?.name || ''), 'พยาบาลผู้รับใหม่', p, currentUser)}
      </div>
    `;
  }

  /**
   * 5. ใบบันทึกสารน้ำเข้า-ออก (Fluid Balance - Intake / Output Sheet)
   */
  function generateIoSheetHtml(p, records = []) {
    let sumOral = 0, sumIv = 0, sumUrine = 0, sumEmesis = 0;
    records.forEach(r => {
      sumOral += Number(r.oral_in) || 0;
      sumIv += Number(r.parenteral_in) || 0;
      sumUrine += Number(r.urine_out) || 0;
      sumEmesis += (Number(r.emesis_out) || 0) + (Number(r.drainage_out) || 0);
    });
    const totalIn = sumOral + sumIv;
    const totalOut = sumUrine + sumEmesis;
    const balance = totalIn - totalOut;

    return `
      ${generatePatientHeaderHtml(p, 'ใบบันทึกสารน้ำเข้า-ออก (Fluid Balance - Intake / Output Sheet)')}

      <div style="display: flex; gap: 10px; margin-bottom: 12px;">
        <div style="flex: 1; border: 1px solid #cbd5e1; padding: 8px; text-align: center; border-radius: 4px;">
          <div style="font-size: 11px; color: #64748b;">รวมสารน้ำเข้า (Total Intake)</div>
          <div style="font-size: 15px; font-weight: 700; color: #0369a1;">${totalIn} ml</div>
        </div>
        <div style="flex: 1; border: 1px solid #cbd5e1; padding: 8px; text-align: center; border-radius: 4px;">
          <div style="font-size: 11px; color: #64748b;">รวมสารน้ำออก (Total Output)</div>
          <div style="font-size: 15px; font-weight: 700; color: #d97706;">${totalOut} ml</div>
        </div>
        <div style="flex: 1; border: 1px solid #cbd5e1; padding: 8px; text-align: center; border-radius: 4px;">
          <div style="font-size: 11px; color: #64748b;">สมดุลสารน้ำ (Fluid Balance)</div>
          <div style="font-size: 15px; font-weight: 700; color: ${balance >= 0 ? '#059669' : '#e11d48'};">${balance > 0 ? `+${balance}` : balance} ml</div>
        </div>
      </div>

      <table class="doc-table">
        <thead>
          <tr>
            <th>วัน-เวลา</th>
            <th>Oral In</th>
            <th>IV In</th>
            <th>รวม In</th>
            <th>Urine Out</th>
            <th>Drain/Emesis</th>
            <th>รวม Out</th>
            <th>ผู้บันทึก</th>
          </tr>
        </thead>
        <tbody>
          ${records.length > 0 ? records.map(r => `
            <tr>
              <td>${new Date(r.note_date).toLocaleDateString('th-TH')} ${r.note_time ? r.note_time.slice(0, 5) : ''}</td>
              <td>${r.oral_in || 0} ml</td>
              <td>${r.parenteral_in || 0} ml</td>
              <td><strong>${r.total_in} ml</strong></td>
              <td>${r.urine_out || 0} ml</td>
              <td>${(Number(r.emesis_out) + Number(r.drainage_out)) || 0} ml</td>
              <td><strong>${r.total_out} ml</strong></td>
              <td>${r.staff || '-'}</td>
            </tr>
          `).join('') : `
            <tr><td colspan="8" style="text-align: center; color: #888;">ยังไม่มีบันทึกสารน้ำ</td></tr>
          `}
        </tbody>
      </table>

      <div class="doc-signature-row">
        <div class="doc-sig-box">
          <div class="doc-sig-line"></div>
          <div>( ................................................... )</div>
          <div style="color: #64748b; font-size: 11px;">พยาบาลผู้รับผิดชอบ</div>
        </div>
      </div>
    `;
  }

  /**
   * สร้าง HTML เอกสารตามประเภท (Unified Document Generator)
   */
  function generateHtml(type, patient, data, currentUser) {
    if (!patient) return '';
    switch (type) {
      case 'dch':
        return generateDischargeSummaryHtml(patient, data, currentUser);
      case 'orders':
        return generateOrdersSheetHtml(patient, data, currentUser);
      case 'nurse':
        return generateNurseNotesSheetHtml(patient, data, currentUser);
      case 'pe':
        return generateAdmissionPeSheetHtml(patient, data, currentUser);
      case 'io':
        return generateIoSheetHtml(patient, data);
      default:
        return `<div style="padding: 2rem; color: red;">ไม่พบประเภทเอกสารที่ระบุ: ${type}</div>`;
    }
  }

  /**
   * สั่งพิมพ์เอกสารผ่าน Isolated Iframe
   */
  function print(contentHtml, patient) {
    if (!contentHtml) return;

    const printIframe = document.createElement('iframe');
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    document.body.appendChild(printIframe);

    const doc = printIframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>พิมพ์เอกสารเวชระเบียนผู้ป่วยใน - ${patient ? patient.patient_name : ''}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="/css/style.css">
        <style>
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            box-sizing: border-box !important;
          }
          @page {
            size: A4 portrait;
            margin: 8mm 10mm 8mm 10mm;
          }
          body {
            font-family: 'Sarabun', 'Prompt', 'TH Sarabun New', 'Leelawadee UI', Tahoma, sans-serif;
            color: #0f172a;
            background: #fff;
            margin: 0;
            padding: 0;
            font-size: 12px;
            line-height: 1.45;
          }
          .a4-paper-sheet {
            width: 100% !important;
            min-height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            background: white !important;
            color: #0f172a !important;
          }
          .doc-header-block {
            text-align: center;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 10px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .doc-header-block h2 {
            font-size: 17px;
            font-weight: 700;
            margin: 0 0 2px 0;
            color: #0f172a;
          }
          .doc-header-block h3 {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 3px 0;
            color: #334155;
          }
          .doc-header-block .doc-sub {
            font-size: 11.5px;
            color: #64748b;
          }
          .doc-patient-box {
            border: 1.5px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 10px;
            background: #f8fafc;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 4px 16px;
            font-size: 12px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .doc-section-title {
            font-size: 13px;
            font-weight: 700;
            border-bottom: 1.5px solid #cbd5e1;
            padding-bottom: 4px;
            margin-top: 10px;
            margin-bottom: 6px;
            color: #0f172a;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .doc-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            font-size: 11.5px;
            page-break-inside: auto;
          }
          .doc-table th {
            background: #f1f5f9;
            color: #0f172a;
            border: 1px solid #cbd5e1;
            padding: 5px 7px;
            text-align: left;
            font-weight: 700;
          }
          .doc-table td {
            border: 1px solid #e2e8f0;
            padding: 4px 7px;
            vertical-align: top;
            color: #1e293b;
          }
          .doc-table tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
          .doc-table thead {
            display: table-header-group;
          }
          .doc-table tfoot {
            display: table-footer-group;
          }
          .doc-signature-row {
            margin-top: 20px;
            display: flex;
            justify-content: space-between;
            text-align: center;
            font-size: 11.5px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .doc-sig-box {
            width: 220px;
          }
          .doc-sig-line {
            border-bottom: 1px dotted #64748b;
            margin-bottom: 4px;
            height: 32px;
          }
          .badge-tag {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10.5px;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        <div class="a4-paper-sheet">
          ${contentHtml}
        </div>
      </body>
      </html>
    `);
    doc.close();

    const triggerPrint = () => {
      try {
        printIframe.contentWindow.focus();
        printIframe.contentWindow.print();
      } catch (e) {
        console.error('Print trigger error:', e);
      }
      setTimeout(() => {
        if (document.body.contains(printIframe)) {
          document.body.removeChild(printIframe);
        }
      }, 2000);
    };

    const imgs = Array.from(doc.images || []);
    if (imgs.length === 0) {
      setTimeout(triggerPrint, 350);
    } else {
      let completedCount = 0;
      const checkAllLoaded = () => {
        completedCount++;
        if (completedCount >= imgs.length) {
          setTimeout(triggerPrint, 250);
        }
      };
      imgs.forEach(img => {
        if (img.complete) {
          checkAllLoaded();
        } else {
          img.onload = checkAllLoaded;
          img.onerror = checkAllLoaded;
        }
      });
      setTimeout(triggerPrint, 1500);
    }
  }

  /**
   * ส่งออกเป็นไฟล์ PDF คุณภาพสูง
   */
  async function downloadPdf(element, patient, docType = 'doc') {
    if (!element || !patient) return false;

    const opt = {
      margin: [6, 8, 6, 8],
      filename: `${docType.toUpperCase()}_AN${patient.an}_HN${patient.hn}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        letterRendering: true,
        scrollY: 0,
        backgroundColor: '#ffffff'
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    if (typeof global.html2pdf !== 'undefined') {
      await global.html2pdf().set(opt).from(element).save();
      return true;
    } else {
      print(element.innerHTML, patient);
      return true;
    }
  }

  // ส่งออก Public Interface
  global.ClinicalDocEngine = {
    generateHtml,
    generateDischargeSummaryHtml,
    generateOrdersSheetHtml,
    generateNurseNotesSheetHtml,
    generateAdmissionPeSheetHtml,
    generateIoSheetHtml,
    renderSignatureStamp,
    print,
    downloadPdf
  };

})(typeof window !== 'undefined' ? window : this);
