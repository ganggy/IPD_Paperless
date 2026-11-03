/**
 * IPD Paperless Application Logic
 * Supports Desktop, Tablet, and Mobile
 */

let state = {
  wards: [],
  selectedWard: 'ALL',
  searchQuery: '',
  doctorFilter: 'all',
  patients: [],
  currentPatient: null,
  currentTab: 'overview',
  tprChartInstance: null,
  auditGuides: [],
  currentOrders: [],
  orderFilter: 'ALL',
  currentUser: null,
};

// DOM Elements Object (populated on DOMContentLoaded)
const elements = {};

function initElements() {
  elements.wardSelect = document.getElementById('wardSelect');
  elements.searchInput = document.getElementById('searchInput');
  elements.bedGrid = document.getElementById('bedGrid');
  elements.patientCountEl = document.getElementById('patientCount');
  elements.wardNameBadge = document.getElementById('wardNameBadge');
  
  elements.wardView = document.getElementById('wardView');
  elements.emrView = document.getElementById('emrView');
  
  elements.backToWardBtn = document.getElementById('backToWardBtn');
  elements.emrPatientPhoto = document.getElementById('emrPatientPhoto');
  elements.emrPatientName = document.getElementById('emrPatientName');
  elements.emrPatientMeta = document.getElementById('emrPatientMeta');
  elements.emrAllergyAlert = document.getElementById('emrAllergyAlert');
  elements.emrBedBadge = document.getElementById('emrBedBadge');
  elements.emrDoctorName = document.getElementById('emrDoctorName');
  
  elements.vitalsModal = document.getElementById('vitalsModal');
  elements.vitalsForm = document.getElementById('vitalsForm');
  elements.nurseNoteModal = document.getElementById('nurseNoteModal');
  elements.nurseNoteForm = document.getElementById('nurseNoteForm');
  
  elements.tabBtns = document.querySelectorAll('.chart-tab-btn');
  elements.tabPanes = document.querySelectorAll('.tab-pane');
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initElements();
    initEventListeners();
    initAuth();
    initSignaturePad();
    initAdminUsers();

    if (state.currentUser) {
      await loadWards();
      await loadPatients();
      await loadAuditGuidesList();
    }
  } catch (err) {
    console.error('App init error:', err);
  }
});

function initEventListeners() {
  // Brand click -> Back to Home/Ward
  const brandLogo = document.getElementById('brandLogo');
  if (brandLogo) brandLogo.addEventListener('click', showWardView);

  // Ward Filter Change
  if (elements.wardSelect) {
    elements.wardSelect.addEventListener('change', (e) => {
      state.selectedWard = e.target.value;
      loadPatients();
    });
  }

  // Top Navigation View Switcher (Ward vs Archive Search)
  const navWardBtn = document.getElementById('navWardViewBtn');
  const navArchiveBtn = document.getElementById('navArchiveViewBtn');
  if (navWardBtn) navWardBtn.addEventListener('click', showWardView);
  if (navArchiveBtn) navArchiveBtn.addEventListener('click', showArchiveView);

  // Archive Search Form & Controls
  const archiveSearchForm = document.getElementById('archiveSearchForm');
  if (archiveSearchForm) archiveSearchForm.addEventListener('submit', handleArchiveSearch);

  const archiveResetBtn = document.getElementById('archiveResetBtn');
  if (archiveResetBtn) {
    archiveResetBtn.addEventListener('click', () => {
      if (archiveSearchForm) archiveSearchForm.reset();
      handleArchiveSearch();
    });
  }

  const emrBackToArchiveBtn = document.getElementById('emrBackToArchiveBtn');
  if (emrBackToArchiveBtn) emrBackToArchiveBtn.addEventListener('click', showArchiveView);

  // Search Input (Ward Grid)
  if (elements.searchInput) {
    let debounceTimer;
    elements.searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value;
        loadPatients();
      }, 300);
    });
  }

  // Back Button
  if (elements.backToWardBtn) {
    elements.backToWardBtn.addEventListener('click', () => {
      if (state.lastSourceView === 'archive') {
        showArchiveView();
      } else {
        showWardView();
      }
    });
  }

  // Tab Switching
  document.querySelectorAll('.chart-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });

  // Mobile Bottom Bar Navigation
  document.querySelectorAll('.mobile-nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.mobile-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const action = item.dataset.action;
      if (action === 'ward') {
        showWardView();
      } else if (action === 'vitals' && state.currentPatient) {
        openVitalsModal();
      } else if (action === 'nurse' && state.currentPatient) {
        openNurseNoteModal();
      } else if (action === 'chart' && state.currentPatient) {
        switchTab('tpr');
      }
    });
  });

  // Quick Action Modals
  const addVitalsBtn = document.getElementById('addVitalsBtn');
  if (addVitalsBtn) addVitalsBtn.addEventListener('click', openVitalsModal);

  const addNurseNoteBtn = document.getElementById('addNurseNoteBtn');
  if (addNurseNoteBtn) addNurseNoteBtn.addEventListener('click', openNurseNoteModal);

  const printChartBtn = document.getElementById('printChartBtn');
  if (printChartBtn) printChartBtn.addEventListener('click', openPrintModal);

  const printDocTypeSelect = document.getElementById('printDocTypeSelect');
  if (printDocTypeSelect) printDocTypeSelect.addEventListener('change', renderPrintDocumentPreview);

  const downloadPdfBtn = document.getElementById('downloadPdfBtn');
  if (downloadPdfBtn) downloadPdfBtn.addEventListener('click', handleDownloadPdf);

  const executePrintBtn = document.getElementById('executePrintBtn');
  if (executePrintBtn) executePrintBtn.addEventListener('click', executePrintDocument);

  // Zoom & Fit Controls for A4 Preview
  const zoomFitBtn = document.getElementById('zoomFitBtn');
  const zoomActualBtn = document.getElementById('zoomActualBtn');
  const printPaperPreview = document.getElementById('printPaperPreview');

  if (zoomFitBtn && zoomActualBtn && printPaperPreview) {
    zoomFitBtn.addEventListener('click', () => {
      const container = document.getElementById('printModalBody');
      if (!container) return;
      const availableWidth = container.clientWidth - 40;
      const paperWidthPx = 794; // ~210mm in standard 96dpi
      if (availableWidth < paperWidthPx) {
        const scale = availableWidth / paperWidthPx;
        printPaperPreview.style.transform = `scale(${scale.toFixed(2)})`;
        printPaperPreview.style.transformOrigin = 'top center';
      } else {
        printPaperPreview.style.transform = 'none';
      }
      zoomFitBtn.style.background = 'white';
      zoomFitBtn.style.color = '#0f172a';
      zoomFitBtn.style.borderColor = '#cbd5e1';
      zoomActualBtn.style.background = 'transparent';
      zoomActualBtn.style.color = '#475569';
      zoomActualBtn.style.borderColor = 'transparent';
    });

    zoomActualBtn.addEventListener('click', () => {
      printPaperPreview.style.transform = 'none';
      zoomActualBtn.style.background = 'white';
      zoomActualBtn.style.color = '#0f172a';
      zoomActualBtn.style.borderColor = '#cbd5e1';
      zoomFitBtn.style.background = 'transparent';
      zoomFitBtn.style.color = '#475569';
      zoomFitBtn.style.borderColor = 'transparent';
    });
  }

  // Close modals
  document.querySelectorAll('.close-modal-btn').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // Close modals when clicking overlay backdrop
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAllModals();
    });
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  // Modal Guide Select Change
  const modalGuideSelect = document.getElementById('modalGuideSelect');
  if (modalGuideSelect) {
    modalGuideSelect.addEventListener('change', (e) => {
      loadModalGuideContent(e.target.value);
    });
  }

  // Form Submissions
  if (elements.vitalsForm) elements.vitalsForm.addEventListener('submit', handleAddVitals);
  if (elements.nurseNoteForm) elements.nurseNoteForm.addEventListener('submit', handleAddNurseNote);

  // SOAP & PE Form Submissions
  const soapForm = document.getElementById('soapForm');
  if (soapForm) soapForm.addEventListener('submit', handleAddSoap);

  const peForm = document.getElementById('peForm');
  if (peForm) peForm.addEventListener('submit', handleAddPe);

  const diagForm = document.getElementById('diagForm');
  if (diagForm) diagForm.addEventListener('submit', handleAddDiag);

  const orderForm = document.getElementById('orderForm');
  if (orderForm) orderForm.addEventListener('submit', handleAddOrder);

  initIcdAndDrugAutocomplete();
  initLiveSosCalculator();

  // Delegation Form Submission
  const delegateForm = document.getElementById('delegateForm');
  if (delegateForm) delegateForm.addEventListener('submit', handleDelegateSubmit);

  // Top Discharge Summary & Approval Button
  const topDischargeSummaryBtn = document.getElementById('topDischargeSummaryBtn');
  if (topDischargeSummaryBtn) {
    topDischargeSummaryBtn.addEventListener('click', () => {
      switchTab('approval');
      const target = document.getElementById('tab-approval');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Doctor Case Filter Buttons
  const filterMyBtn = document.getElementById('filterMyCasesBtn');
  const filterAllBtn = document.getElementById('filterAllCasesBtn');
  if (filterMyBtn) {
    filterMyBtn.addEventListener('click', () => {
      state.doctorFilter = 'my';
      filterMyBtn.classList.add('active');
      filterMyBtn.style.background = '#0284c7';
      filterMyBtn.style.color = 'white';
      filterMyBtn.style.border = 'none';
      if (filterAllBtn) {
        filterAllBtn.classList.remove('active');
        filterAllBtn.style.background = '#f1f5f9';
        filterAllBtn.style.color = 'var(--text-sub)';
        filterAllBtn.style.border = '1px solid var(--border)';
      }
      renderBedGrid();
    });
  }
  if (filterAllBtn) {
    filterAllBtn.addEventListener('click', () => {
      state.doctorFilter = 'all';
      filterAllBtn.classList.add('active');
      filterAllBtn.style.background = '#0284c7';
      filterAllBtn.style.color = 'white';
      filterAllBtn.style.border = 'none';
      if (filterMyBtn) {
        filterMyBtn.classList.remove('active');
        filterMyBtn.style.background = '#f1f5f9';
        filterMyBtn.style.color = 'var(--text-sub)';
        filterMyBtn.style.border = '1px solid var(--border)';
      }
      renderBedGrid();
    });
  }

  // Live SOS Calculator on Vital Signs Input
  initLiveSosCalculator();
}

// -------------------------------------------------------------
// 2. Patient Profile & Header Rendering
// -------------------------------------------------------------
function renderPatientHeader(p) {
  elements.emrPatientPhoto.src = `/api/patient-photo/${p.hn}`;
  elements.emrPatientName.textContent = p.patient_name;
  elements.emrBedBadge.textContent = `🛏️ เตียง ${p.bedno || (p.bedname || 'รอจัดเตียง')}`;
  elements.emrDoctorName.textContent = `🩺 แพทย์: ${p.approval?.assigned_doctor_name || p.doctor_name || 'ไม่ระบุ'}`;

  const hasAllergy = p.drugallergy && p.drugallergy.trim().length > 0 && !p.drugallergy.includes('ไม่มี') && !p.drugallergy.includes('ปฏิเสธ');
  if (hasAllergy) {
    elements.emrAllergyAlert.style.display = 'inline-flex';
    elements.emrAllergyAlert.innerHTML = `⚠️ <strong>ประวัติแพ้ยา:</strong> ${p.drugallergy}`;
  } else {
    elements.emrAllergyAlert.style.display = 'none';
  }

  const dchPill = p.dchdate 
    ? `<span class="meta-pill meta-pill-dch">🚪 จำหน่าย: ${new Date(p.dchdate).toLocaleDateString('th-TH')} ${p.dchtime ? p.dchtime.slice(0, 5) : ''}</span>` 
    : `<span class="meta-pill meta-pill-active">⏳ กำลังรักษา (Active IPD)</span>`;

  elements.emrPatientMeta.innerHTML = `
    <span class="meta-pill"><strong>HN:</strong> ${p.hn}</span>
    <span class="meta-pill"><strong>AN:</strong> ${p.an}</span>
    <span class="meta-pill">${p.sex === '1' ? '👨 ชาย' : '👩 หญิง'} • ${p.age} ปี</span>
    <span class="meta-pill meta-pill-pttype">🏷️ ${p.pttype_name || p.pttype}</span>
    <span class="meta-pill">🏥 ${p.ward_name}</span>
    <span class="meta-pill meta-pill-admit">📅 Admit: ${new Date(p.regdate).toLocaleDateString('th-TH')} ${p.regtime ? p.regtime.slice(0, 5) : ''} (${p.los_days} วัน)</span>
    ${dchPill}
  `;
}

function initLiveSosCalculator() {
  const inputs = ['inputBt', 'inputPr', 'inputRr', 'inputSbp', 'inputSpo2', 'inputAvpu'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculateLiveSos);
  });
}

function calculateLiveSos() {
  const bt = parseFloat(document.getElementById('inputBt')?.value) || 36.5;
  const pr = parseFloat(document.getElementById('inputPr')?.value) || 80;
  const rr = parseFloat(document.getElementById('inputRr')?.value) || 20;
  const sbp = parseFloat(document.getElementById('inputSbp')?.value) || 120;
  const spo2 = parseFloat(document.getElementById('inputSpo2')?.value) || 98;
  const avpu = document.getElementById('inputAvpu')?.value || 'A';

  let score = 0;
  // BT
  if (bt <= 35.0 || bt >= 39.1) score += 2;
  else if ((bt >= 35.1 && bt <= 36.0) || (bt >= 38.1 && bt <= 39.0)) score += 1;

  // PR
  if (pr <= 40 || pr >= 131) score += 3;
  else if (pr >= 111 && pr <= 130) score += 2;
  else if ((pr >= 41 && pr <= 50) || (pr >= 91 && pr <= 110)) score += 1;

  // RR
  if (rr <= 8 || rr >= 25) score += 3;
  else if (rr >= 21 && rr <= 24) score += 2;
  else if (rr >= 9 && rr <= 11) score += 1;

  // SBP
  if (sbp <= 90 || sbp >= 220) score += 3;
  else if (sbp >= 91 && sbp <= 100) score += 2;
  else if (sbp >= 101 && sbp <= 110) score += 1;

  // SpO2
  if (spo2 <= 91) score += 3;
  else if (spo2 >= 92 && spo2 <= 93) score += 2;
  else if (spo2 >= 94 && spo2 <= 95) score += 1;

  // AVPU
  if (avpu === 'V') score += 1;
  else if (avpu === 'P') score += 2;
  else if (avpu === 'U') score += 3;

  const badge = document.getElementById('liveSosScoreBadge');
  const action = document.getElementById('liveSosAction');
  if (!badge) return;

  if (score >= 4) {
    badge.style.background = 'var(--rose-light)';
    badge.style.color = 'var(--rose)';
    badge.textContent = `🚨 SOS = ${score} (Critical Risk)`;
    if (action) action.textContent = '⚡ รายงานแพทย์ทันที / เตรียม Oxygen & Monitor V/S q 15-30 min';
  } else if (score >= 2) {
    badge.style.background = 'var(--amber-light)';
    badge.style.color = 'var(--amber-text)';
    badge.textContent = `⚠️ SOS = ${score} (Medium Risk)`;
    if (action) action.textContent = 'แจ้งพยาบาลประจำเวร เพิ่มความถี่วัด V/S q 2 hr';
  } else {
    badge.style.background = 'var(--emerald-light)';
    badge.style.color = 'var(--emerald-text)';
    badge.textContent = `✓ SOS = ${score} (Low Risk)`;
    if (action) action.textContent = 'ติดตามสัญญาณชีพตามรอบปกติ q 4-8 hr';
  }
}

// -------------------------------------------------------------
// 1. Data Fetching
// -------------------------------------------------------------
async function loadWards() {
  try {
    const res = await fetch('/api/wards');
    const json = await res.json();
    if (json.ok) {
      state.wards = json.data;
      renderWardOptions();
    }
  } catch (e) {
    console.error('Failed to load wards', e);
  }
}

function renderWardOptions() {
  elements.wardSelect.innerHTML = '<option value="ALL">🏥 ทุกหอผู้ป่วย (All Wards)</option>';
  state.wards.forEach((w) => {
    if (w.active_patients > 0 || ['01', '02', '03'].includes(w.ward)) {
      const opt = document.createElement('option');
      opt.value = w.ward;
      opt.textContent = `${w.name} (${w.active_patients} คน)`;
      elements.wardSelect.appendChild(opt);
    }
  });
}

function renderBedGridSkeleton(count = 6) {
  const cards = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div style="display: flex; gap: 0.75rem; align-items: center;">
        <div class="skeleton-avatar skeleton-loading"></div>
        <div style="flex: 1;">
          <div class="skeleton-line title skeleton-loading"></div>
          <div class="skeleton-line subtitle skeleton-loading"></div>
        </div>
      </div>
      <div style="display: flex; gap: 0.4rem;">
        <div style="width: 70px; height: 22px; border-radius: 4px;" class="skeleton-loading"></div>
        <div style="width: 90px; height: 22px; border-radius: 4px;" class="skeleton-loading"></div>
      </div>
      <div class="skeleton-strip skeleton-loading"></div>
    </div>
  `).join('');
  elements.bedGrid.innerHTML = cards;
}

async function loadPatients() {
  try {
    renderBedGridSkeleton(6);

    const url = `/api/patients?ward=${encodeURIComponent(state.selectedWard)}&search=${encodeURIComponent(state.searchQuery)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.ok) {
      state.patients = json.data;
      renderBedGrid();
    }
  } catch (e) {
    elements.bedGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--rose);">
        ❌ เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล HOSxP: ${e.message}
      </div>
    `;
  }
}

function renderBedGrid() {
  const myDocCode = state.currentUser?.doctorcode;
  const myCases = state.patients.filter(p => (myDocCode && (p.assigned_doctor_code === myDocCode || p.doctor_code === myDocCode)));
  
  const myCountEl = document.getElementById('myCaseCount');
  const allCountEl = document.getElementById('allCaseCount');
  if (myCountEl) myCountEl.textContent = myCases.length;
  if (allCountEl) allCountEl.textContent = state.patients.length;

  let displayList = state.patients;
  if (state.doctorFilter === 'my' && myDocCode) {
    displayList = myCases;
  }

  elements.patientCountEl.textContent = `${displayList.length} คน`;
  
  if (displayList.length === 0) {
    elements.bedGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 4rem; background: white; border-radius: var(--radius-xl); border: 1.5px dashed var(--border);">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🛏️</div>
        <h3 style="color: var(--text-muted);">${state.doctorFilter === 'my' ? 'ไม่พบผู้ป่วยที่อยู่ในความรับผิดชอบของคุณ' : 'ไม่พบผู้ป่วยในหอผู้ป่วยนี้'}</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted);">${state.doctorFilter === 'my' ? 'กดปุ่ม "🏥 เคสทั้งหมด" เพื่อดูผู้ป่วยในหอทั้งหมด' : 'ลองเปลี่ยนหอผู้ป่วยหรือตรวจสอบคำค้นหา'}</p>
      </div>
    `;
    return;
  }

  elements.bedGrid.innerHTML = displayList.map((p) => {
    const hasAllergy = p.drugallergy && p.drugallergy.trim().length > 0 && !p.drugallergy.includes('ไม่มี') && !p.drugallergy.includes('ปฏิเสธ');
    const v = p.latest_vitals || {};
    const sosHigh = (v.sos && v.sos >= 3) || (v.news2 && v.news2 >= 4);
    const isDocApproved = p.is_doctor_approved;

    return `
      <div class="patient-card ${sosHigh ? 'high-alert-card' : ''}" onclick="openPatientEMR('${p.an}')">
        <div class="card-top">
          <div style="display: flex; gap: 0.75rem; align-items: center;">
            <img src="/api/patient-photo/${p.hn}" alt="Photo" class="patient-avatar-mini" loading="lazy" onerror="this.src='/images/default-avatar.svg'" />
            <div>
              <div class="patient-name-title">${p.patient_name}</div>
              <div class="patient-sub-ids">
                <span>HN: <strong>${p.hn}</strong></span>
                <span>AN: <strong>${p.an}</strong></span>
              </div>
            </div>
          </div>
          <div class="bed-badge">
            🛏️ ${p.bedno ? p.bedno : (p.bedname || 'รอเตียง')}
          </div>
        </div>

        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
          <span class="badge-tag" style="background: var(--surface-subtle); color: var(--text-sub);">
            ${p.sex === '1' ? 'ชาย' : 'หญิง'} อายุ ${p.age || '-'} ปี
          </span>
          <span class="badge-tag" style="background: var(--primary-light); color: var(--primary-dark);">
            ${p.ward_name}
          </span>
          <span class="badge-tag" style="background: #f1f5f9; color: var(--text-sub);">
            นอน ${p.los_days} วัน
          </span>
          ${isDocApproved ? `
            <span class="badge-tag" style="background: #dcfce7; color: #166534; font-weight: 600;">
              ✓ แพทย์ Approve แล้ว
            </span>
          ` : `
            <span class="badge-tag" style="background: #fff7ed; color: #c2410c;">
              ⏳ รอแพทย์สรุป
            </span>
          `}
        </div>

        ${hasAllergy ? `
          <div class="allergy-alert-badge">
            ⚠️ แพ้ยา: ${p.drugallergy}
          </div>
        ` : ''}

        ${p.prediag ? `
          <div style="font-size: 0.82rem; color: var(--text-sub); background: #fafafa; padding: 0.4rem 0.6rem; border-radius: 6px; border-left: 3px solid var(--primary);">
            <strong>Pre-diag:</strong> ${p.prediag}
          </div>
        ` : ''}

        <div class="vitals-snapshot-strip">
          <div class="vitals-item-snap">
            <span class="label">BT (°C)</span>
            <span class="val ${v.temp >= 38.0 ? 'high-alert' : ''}">${v.temp ? Number(v.temp).toFixed(1) : '-'}</span>
          </div>
          <div class="vitals-item-snap">
            <span class="label">PR (bpm)</span>
            <span class="val ${v.pulse >= 100 || (v.pulse && v.pulse < 60) ? 'high-alert' : ''}">${v.pulse || '-'}</span>
          </div>
          <div class="vitals-item-snap">
            <span class="label">BP</span>
            <span class="val ${v.bps >= 140 ? 'high-alert' : ''}">${v.bps && v.bpd ? `${v.bps}/${v.bpd}` : '-'}</span>
          </div>
          <div class="vitals-item-snap">
            <span class="label">SpO2</span>
            <span class="val ${(v.spo2 && v.spo2 < 95) ? 'high-alert' : ''}">${v.spo2 ? `${v.spo2}%` : '-'}</span>
          </div>
        </div>

        <div class="card-footer">
          <span>🩺 ${p.assigned_doctor_name || p.doctor_name || 'แพทย์เจ้าของไข้'}</span>
          <span>📅 รับ ${new Date(p.regdate).toLocaleDateString('th-TH')} ${p.regtime ? p.regtime.slice(0, 5) : ''}</span>
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------
// 2. Patient EMR Chart & View Switching
// -------------------------------------------------------------
function renderPatientHeader(p) {
  if (!p) return;
  if (elements.emrPatientPhoto) elements.emrPatientPhoto.src = `/api/patient-photo/${p.hn}`;
  if (elements.emrPatientName) elements.emrPatientName.textContent = p.patient_name;
  
  const hasAllergy = p.drugallergy && p.drugallergy.trim().length > 0 && !p.drugallergy.includes('ไม่มี') && !p.drugallergy.includes('ปฏิเสธ');
  if (elements.emrAllergyAlert) {
    if (hasAllergy) {
      elements.emrAllergyAlert.style.display = 'flex';
      elements.emrAllergyAlert.innerHTML = `⚠️ <strong>ประวัติแพ้ยา (Allergy):</strong> ${p.drugallergy}`;
    } else {
      elements.emrAllergyAlert.style.display = 'none';
    }
  }

  if (elements.emrBedBadge) {
    elements.emrBedBadge.textContent = `🛏️ เตียง ${p.bedno || p.bedname || '-'}`;
  }
  if (elements.emrDoctorName) {
    elements.emrDoctorName.textContent = `🩺 แพทย์: ${p.approval?.assigned_doctor_name || p.doctor_name || '-'}`;
  }

  if (elements.emrPatientMeta) {
    const maskedCid = p.cid ? (p.cid.length === 13 ? `${p.cid.slice(0, 1)}-${p.cid.slice(1, 5)}-${p.cid.slice(5, 10)}-${p.cid.slice(10, 12)}-${p.cid.slice(12)}` : p.cid) : '-';
    
    elements.emrPatientMeta.innerHTML = `
      <span class="meta-pill"><strong>HN:</strong> ${p.hn}</span>
      <span class="meta-pill"><strong>AN:</strong> ${p.an}</span>
      <span class="meta-pill" style="color: #64748b;"><strong>CID:</strong> ${maskedCid}</span>
      <span class="meta-pill">${p.sex === '1' ? 'ชาย' : 'หญิง'}</span>
      <span class="meta-pill">อายุ <strong>${p.age || '-'}</strong> ปี</span>
      <span class="meta-pill meta-pill-pttype">💳 ${p.pttype_name || p.pttype}</span>
      <span class="meta-pill meta-pill-admit">📅 Admit: ${new Date(p.regdate).toLocaleDateString('th-TH')} ${p.regtime ? p.regtime.slice(0, 5) : ''} (${p.los_days || 1} วัน)</span>
      ${p.dchdate ? `
        <span class="meta-pill meta-pill-dch">🚪 จำหน่าย: ${new Date(p.dchdate).toLocaleDateString('th-TH')} ${p.dchtime ? p.dchtime.slice(0, 5) : ''}</span>
      ` : `
        <span class="meta-pill meta-pill-active">⏳ กำลังรักษา (Active IPD)</span>
      `}
      ${p.is_legacy ? `
        <span class="meta-pill" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-weight: 700;">
          ⚠️ ข้อมูลก่อนใช้ระบบ (IPD เดิม)
        </span>
      ` : `
        <span class="meta-pill" style="background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; font-weight: 600;">
          ✓ ระบบ IPD Paperless
        </span>
      `}
    `;
  }
}

async function openPatientEMR(an, options = {}) {
  if (!state.currentUser) {
    showLoginView();
    return;
  }

  const isReadOnly = !!options.isReadOnly;
  const isLegacy = !!options.isLegacy;
  const sourceView = options.sourceView || 'ward';
  state.lastSourceView = sourceView;
  state.isReadOnlyReview = isReadOnly;

  try {
    const res = await fetch(`/api/patient/${an}`);
    const json = await res.json();
    if (!json.ok) return alert('ไม่พบข้อมูลผู้ป่วย');

    state.currentPatient = json.data;
    state.currentPatient.is_legacy = isLegacy;
    renderPatientHeader(state.currentPatient);
    
    // Manage Read-only & Legacy banners
    const readOnlyBanner = document.getElementById('emrReadOnlyBanner');
    const legacyBanner = document.getElementById('emrLegacyWarningBanner');
    
    if (readOnlyBanner) {
      readOnlyBanner.style.display = isReadOnly ? 'flex' : 'none';
    }
    if (legacyBanner) {
      legacyBanner.style.display = isLegacy ? 'flex' : 'none';
    }

    // Switch view
    const appHeader = document.getElementById('mainAppHeader');
    if (appHeader) appHeader.style.display = 'flex';
    const loginView = document.getElementById('loginView');
    if (loginView) {
      loginView.style.display = 'none';
      loginView.classList.remove('active');
    }
    if (elements.wardView) {
      elements.wardView.style.display = 'none';
      elements.wardView.classList.remove('active');
    }
    const archiveView = document.getElementById('archiveView');
    if (archiveView) {
      archiveView.style.display = 'none';
      archiveView.classList.remove('active');
    }
    if (elements.emrView) {
      elements.emrView.style.display = 'block';
      elements.emrView.classList.add('active');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Switch to default tab
    switchTab('overview');
  } catch (e) {
    alert('เกิดข้อผิดพลาดในการโหลดชาร์ต: ' + e.message);
  }
}

function showLoginView() {
  const loginView = document.getElementById('loginView');
  const wardView = document.getElementById('wardView') || elements.wardView;
  const archiveView = document.getElementById('archiveView');
  const emrView = document.getElementById('emrView') || elements.emrView;
  const appHeader = document.getElementById('mainAppHeader');

  if (appHeader) appHeader.style.display = 'none';
  if (loginView) {
    loginView.style.display = 'flex';
    loginView.classList.add('active');
  }
  if (wardView) {
    wardView.style.display = 'none';
    wardView.classList.remove('active');
  }
  if (archiveView) {
    archiveView.style.display = 'none';
    archiveView.classList.remove('active');
  }
  if (emrView) {
    emrView.style.display = 'none';
    emrView.classList.remove('active');
  }
}

function showWardView() {
  if (!state.currentUser) {
    showLoginView();
    return;
  }
  state.currentView = 'ward';
  state.lastSourceView = 'ward';
  state.isReadOnlyReview = false;

  const navWardBtn = document.getElementById('navWardViewBtn');
  const navArchiveBtn = document.getElementById('navArchiveViewBtn');
  if (navWardBtn) {
    navWardBtn.style.background = '#0f172a';
    navWardBtn.style.color = '#ffffff';
    navWardBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
  }
  if (navArchiveBtn) {
    navArchiveBtn.style.background = 'transparent';
    navArchiveBtn.style.color = '#475569';
    navArchiveBtn.style.boxShadow = 'none';
  }

  const loginView = document.getElementById('loginView');
  const wardView = document.getElementById('wardView') || elements.wardView;
  const archiveView = document.getElementById('archiveView');
  const emrView = document.getElementById('emrView') || elements.emrView;
  const appHeader = document.getElementById('mainAppHeader');

  if (appHeader) appHeader.style.display = 'flex';
  if (loginView) {
    loginView.style.display = 'none';
    loginView.classList.remove('active');
  }
  if (emrView) {
    emrView.style.display = 'none';
    emrView.classList.remove('active');
  }
  if (archiveView) {
    archiveView.style.display = 'none';
    archiveView.classList.remove('active');
  }
  if (wardView) {
    wardView.style.display = 'block';
    wardView.classList.add('active');
  }

  state.currentPatient = null;
  loadPatients();
}

function showArchiveView() {
  if (!state.currentUser) {
    showLoginView();
    return;
  }
  state.currentView = 'archive';
  state.lastSourceView = 'archive';

  const navWardBtn = document.getElementById('navWardViewBtn');
  const navArchiveBtn = document.getElementById('navArchiveViewBtn');
  if (navWardBtn) {
    navWardBtn.style.background = 'transparent';
    navWardBtn.style.color = '#475569';
    navWardBtn.style.boxShadow = 'none';
  }
  if (navArchiveBtn) {
    navArchiveBtn.style.background = '#0f172a';
    navArchiveBtn.style.color = '#ffffff';
    navArchiveBtn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
  }

  const loginView = document.getElementById('loginView');
  const wardView = document.getElementById('wardView') || elements.wardView;
  const archiveView = document.getElementById('archiveView');
  const emrView = document.getElementById('emrView') || elements.emrView;
  const appHeader = document.getElementById('mainAppHeader');

  if (appHeader) appHeader.style.display = 'flex';
  if (loginView) {
    loginView.style.display = 'none';
    loginView.classList.remove('active');
  }
  if (emrView) {
    emrView.style.display = 'none';
    emrView.classList.remove('active');
  }
  if (wardView) {
    wardView.style.display = 'none';
    wardView.classList.remove('active');
  }
  if (archiveView) {
    archiveView.style.display = 'block';
    archiveView.classList.add('active');
  }

  // Populate ward dropdown in archive view if needed
  const archiveWardSelect = document.getElementById('archiveWardSelect');
  if (archiveWardSelect && archiveWardSelect.options.length <= 1 && state.wards) {
    state.wards.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.ward;
      opt.textContent = w.name;
      archiveWardSelect.appendChild(opt);
    });
  }

  // If no results rendered yet, trigger initial search
  const resultContainer = document.getElementById('archiveResultContainer');
  if (resultContainer && resultContainer.children.length === 1 && resultContainer.children[0].tagName === 'DIV') {
    handleArchiveSearch();
  }
}

async function handleArchiveSearch(e) {
  if (e) e.preventDefault();
  const queryInput = document.getElementById('archiveQueryInput');
  const wardSelect = document.getElementById('archiveWardSelect');
  const legacySelect = document.getElementById('archiveLegacySelect');
  const dateStartInput = document.getElementById('archiveDateStartInput');
  const dateEndInput = document.getElementById('archiveDateEndInput');
  const resultContainer = document.getElementById('archiveResultContainer');
  const countEl = document.getElementById('archiveResultCount');

  const q = queryInput ? queryInput.value.trim() : '';
  const ward = wardSelect ? wardSelect.value : '';
  const legacy_filter = legacySelect ? legacySelect.value : '';
  const date_start = dateStartInput ? dateStartInput.value : '';
  const date_end = dateEndInput ? dateEndInput.value : '';

  if (resultContainer) {
    resultContainer.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">⏳ กำลังสืบค้นข้อมูลเวชระเบียน...</div>';
  }

  try {
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (ward) params.append('ward', ward);
    if (legacy_filter) params.append('legacy_filter', legacy_filter);
    if (date_start) params.append('date_start', date_start);
    if (date_end) params.append('date_end', date_end);
    params.append('limit', '60');

    const res = await fetch(`/api/archive/search?${params.toString()}`);
    const json = await res.json();
    const results = json.ok ? json.data : [];

    if (countEl) countEl.textContent = `${results.length} รายการ`;

    if (results.length === 0) {
      resultContainer.innerHTML = `
        <div style="text-align: center; padding: 4rem 2rem; color: var(--text-muted); background: #f8fafc; border-radius: var(--radius-lg); border: 1.5px dashed var(--border);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
          <h4 style="color: #475569; margin-bottom: 0.25rem;">ไม่พบข้อมูลเวชระเบียนตามเงื่อนไขที่ระบุ</h4>
          <p style="font-size: 0.85rem; margin: 0;">กรุณาตรวจสอบความถูกต้องของ เลขบัตร ปชช., HN, AN หรือคำค้นหา แล้วลองใหม่อีกครั้ง</p>
        </div>
      `;
      return;
    }

    resultContainer.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>วัน-เวลารับ (Admit)</th>
              <th>วันจำหน่าย (Discharge)</th>
              <th>HN / AN / CID</th>
              <th>ชื่อ-สกุลผู้ป่วย</th>
              <th>หอผู้ป่วย / เตียง</th>
              <th>อาการแรกรับ / วินิจฉัย</th>
              <th>แพทย์เจ้าของไข้</th>
              <th>แหล่งข้อมูล</th>
              <th style="text-align: center;">เปิดทบทวน</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => {
              const admitStr = `${new Date(r.regdate).toLocaleDateString('th-TH')} ${r.regtime ? r.regtime.slice(0, 5) : ''}`;
              const dchStr = r.dchdate 
                ? `${new Date(r.dchdate).toLocaleDateString('th-TH')} (${r.los_days || 1} วัน)`
                : '<span style="color: #d97706; font-weight: 600;">⏳ กำลังรักษา (Active)</span>';
              
              const maskedCid = r.cid ? (r.cid.length === 13 ? `${r.cid.slice(0, 1)}-${r.cid.slice(1, 5)}-${r.cid.slice(5, 10)}-${r.cid.slice(10, 12)}-${r.cid.slice(12)}` : r.cid) : '-';

              return `
                <tr>
                  <td>
                    <strong>${admitStr}</strong>
                  </td>
                  <td>
                    ${dchStr}
                  </td>
                  <td>
                    <div><strong>HN:</strong> ${r.hn}</div>
                    <div><strong>AN:</strong> ${r.an}</div>
                    <div style="font-size: 0.76rem; color: #64748b;">CID: ${maskedCid}</div>
                  </td>
                  <td>
                    <strong style="color: #0f172a; font-size: 0.95rem;">${r.patient_name}</strong>
                    <div style="font-size: 0.78rem; color: #64748b;">${r.sex === '1' ? 'ชาย' : 'หญิง'} • ${r.age || '-'} ปี</div>
                  </td>
                  <td>
                    <div>${r.ward_name || '-'}</div>
                    <span class="badge-tag" style="background: #f1f5f9; color: #475569; font-size: 0.75rem;">
                      เตียง ${r.bedno || (r.bedname || '-')}
                    </span>
                  </td>
                  <td style="max-width: 200px;">
                    <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.prediag || ''}">
                      ${r.prediag || '-'}
                    </div>
                    ${r.dchstts_name ? `<div style="font-size: 0.75rem; color: #059669;">สถานะ: ${r.dchstts_name}</div>` : ''}
                  </td>
                  <td>
                    <span style="font-size: 0.85rem; color: #334155;">${r.doctor_name || '-'}</span>
                  </td>
                  <td>
                    ${r.is_legacy ? `
                      <span class="badge-tag" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;" title="ข้อมูลก่อนเริ่มใช้ระบบ IPD Paperless ตรวจสอบเอกสารชาร์ตที่ระบบเดิม">
                        ⚠️ ข้อมูลก่อนใช้ระบบ (IPD เดิม)
                      </span>
                    ` : `
                      <span class="badge-tag" style="background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem;">
                        ✓ IPD Paperless
                      </span>
                    `}
                  </td>
                  <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm" onclick="openPatientEMR('${r.an}', { isReadOnly: true, isLegacy: ${r.is_legacy ? 'true' : 'false'}, sourceView: 'archive' })" style="border-radius: 9999px; font-weight: 600; padding: 0.35rem 0.85rem; background: #f8fafc; border: 1px solid #cbd5e1; cursor: pointer;">
                      🔍 ทบทวนชาร์ต
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    if (resultContainer) {
      resultContainer.innerHTML = `<div style="color: red; padding: 2rem; text-align: center;">เกิดข้อผิดพลาดในการสืบค้น: ${err.message}</div>`;
    }
  }
}

// -------------------------------------------------------------
// 3. EMR Tab Switching & Loading
// -------------------------------------------------------------
function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.chart-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${tabName}`);
  });

  if (!state.currentPatient) return;
  const an = state.currentPatient.an;

  if (tabName === 'overview') loadOverviewTab(an);
  if (tabName === 'approval') loadApprovalTab(an);
  if (tabName === 'pe') loadPeTab(an);
  if (tabName === 'tpr') loadTPRChartTab(an);
  if (tabName === 'soap') loadSoapTab(an);
  if (tabName === 'orders') loadOrdersTab(an);
  if (tabName === 'mar') loadMarTab(an);
  if (tabName === 'nurse') loadNurseNotesTab(an);
  if (tabName === 'labs') loadLabsTab(an);
  if (tabName === 'xray') loadXrayTab(an);
  if (tabName === 'diag') loadDiagnosisTab(an);
  if (tabName === 'io') loadIoTab(an);
  if (tabName === 'dch') loadDchTab(an);
  if (tabName === 'audit') loadAuditGuideTab();
}

// Tab 14: Discharge Approval & Delegation Hub
let currentDelegateType = 'doctor';

async function loadApprovalTab(an) {
  const container = document.getElementById('approvalContainer');
  if (!container) return;

  container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">⏳ กำลังโหลดสถานะการสรุปและ Approve เวชระเบียน...</div>';

  try {
    const [resApproval, resOptions] = await Promise.all([
      fetch(`/api/discharge-approval/${an}`),
      fetch('/api/discharge-options')
    ]);
    const jsonApproval = await resApproval.json();
    const jsonOptions = await resOptions.json();

    const d = jsonApproval.ok ? jsonApproval.data : {};
    const options = jsonOptions.ok ? jsonOptions.data : { statuses: [], types: [] };
    
    state.currentApprovalData = d;
    if (state.currentPatient) {
      state.currentPatient.approval = d;
      if (d.dchdate) state.currentPatient.dchdate = d.dchdate;
      if (d.dchtime) state.currentPatient.dchtime = d.dchtime;
      if (d.dchstts_name) state.currentPatient.dchstts_name = d.dchstts_name;
      if (d.dchtype_name) state.currentPatient.dchtype_name = d.dchtype_name;
    }

    const p = state.currentPatient || {};
    const user = state.currentUser || {};
    
    // Check doctor authorization
    const isAttendingDoc = user.doctorcode && (user.doctorcode === (d.assigned_doctor_code || p.doctor_code));
    const canDocApprove = user.is_admin || isAttendingDoc;
    const canNurseApprove = user.is_admin || user.is_nurse || user.groupname?.includes('พยาบาล') || (!user.is_doctor);

    const dchDateVal = d.dchdate ? (typeof d.dchdate === 'string' ? d.dchdate.slice(0, 10) : new Date(d.dchdate).toISOString().slice(0, 10)) : '';
    const dchTimeVal = d.dchtime ? d.dchtime.slice(0, 5) : '';

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h3 style="color: var(--primary-dark); font-size: 1.3rem; margin-bottom: 0.25rem;">
            ✅ ระบบสรุป & Approve เวชระเบียนผู้ป่วยใน (Medical Record Approval Hub)
          </h3>
          <p style="color: var(--text-muted); font-size: 0.88rem; margin: 0;">
            ผู้ป่วย: <strong>${p.patient_name}</strong> (HN: ${p.hn} | AN: ${p.an}) • แพทย์เจ้าของไข้: <strong>${p.doctor_name || '-'}</strong>
          </p>
        </div>

        <div style="display: flex; gap: 0.5rem; align-items: center;">
          ${d.is_locked ? `
            <span class="badge-tag" style="background: #e0e7ff; color: #3730a3; font-size: 0.85rem; padding: 0.4rem 0.8rem; font-weight: 600;">
              🔒 บันทึกล็อคข้อมูลแล้ว (พิมพ์ครั้งแรกเมื่อ: ${d.first_printed_at ? new Date(d.first_printed_at).toLocaleDateString('th-TH') : '-'})
            </span>
          ` : `
            <span class="badge-tag" style="background: #fef3c7; color: #b45309; font-size: 0.85rem; padding: 0.4rem 0.8rem;">
              ⏳ ฉบับร่าง (ยังไม่เคยพิมพ์)
            </span>
          `}
        </div>
      </div>

      ${state.isReadOnlyReview ? `
        <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: var(--radius-lg); padding: 0.85rem 1.2rem; margin-bottom: 1.25rem; color: #1e40af; font-size: 0.88rem; display: flex; align-items: center; gap: 0.6rem;">
          <span style="font-size: 1.4rem;">🔒</span>
          <div>
            <strong>โหมดทบทวนเวชระเบียนย้อนหลัง (Read-Only Audit Mode):</strong>
            <div>หน้านี้แสดงสถานะการอนุมัติและจำหน่ายจริงในอดีต ไม่อนุญาตให้แก้ไขข้อมูลหรือเปลี่ยนแปลงสถานะการอนุมัติ</div>
          </div>
        </div>
      ` : ''}

      <!-- CARD 0: DISCHARGE DATE & STATUS CONTROL -->
      <div style="background: white; border: 1.5px solid #cbd5e1; border-radius: var(--radius-xl); padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1.4rem;">📅</span>
            <div>
              <h4 style="margin: 0; font-size: 1.05rem; color: #1e293b; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <span>ข้อมูลและวันที่จำหน่ายผู้ป่วย (Discharge Date & Status)</span>
                <span class="hosxp-sync-pill">🔗 เชื่อมโยงตาราง ipt (HOSxP)</span>
              </h4>
              <span style="font-size: 0.78rem; color: var(--text-muted);">กำหนดวัน-เวลา และสถานะการจำหน่ายผู้ป่วยเพื่อสรุปเวชระเบียนและซิงค์เข้า HOSxP</span>
            </div>
          </div>
          ${!state.isReadOnlyReview ? `
            <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
              <label style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; font-weight: 600; color: #0369a1; background: #f0f9ff; padding: 0.35rem 0.75rem; border-radius: 9999px; border: 1px solid #bae6fd; cursor: pointer;">
                <input type="checkbox" id="syncHosxpDchCheckbox" checked style="accent-color: #0284c7; width: 15px; height: 15px;" />
                <span>🔗 ซิงค์เข้าตาราง ipt ใน HOSxP ทันที</span>
              </label>
              <button class="btn btn-sm btn-primary" onclick="handleSaveDischargeInfo()" style="background: #0284c7; font-weight: 600; padding: 0.45rem 1rem;">
                💾 บันทึกวันและสถานะจำหน่าย
              </button>
            </div>
          ` : `
            <span class="badge-tag" style="background: #f1f5f9; color: #64748b; font-size: 0.82rem;">🔒 ล็อคการแก้ไข</span>
          `}
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; background: #f8fafc; padding: 1rem; border-radius: var(--radius-md);">
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: #475569; display: block; margin-bottom: 0.3rem;">
              🚪 วันที่จำหน่าย (Discharge Date):
            </label>
            <input type="date" id="dchDateInput" class="form-control" value="${dchDateVal}" ${state.isReadOnlyReview ? 'disabled' : ''} style="font-size: 0.9rem;" />
          </div>
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: #475569; display: block; margin-bottom: 0.3rem;">
              ⏰ เวลาจำหน่าย (Discharge Time):
            </label>
            <input type="time" id="dchTimeInput" class="form-control" value="${dchTimeVal}" ${state.isReadOnlyReview ? 'disabled' : ''} style="font-size: 0.9rem;" />
          </div>
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: #475569; display: block; margin-bottom: 0.3rem;">
              📊 สถานะการจำหน่าย (Discharge Status):
            </label>
            <select id="dchStatusSelect" class="form-control" ${state.isReadOnlyReview ? 'disabled' : ''} style="font-size: 0.88rem;">
              <option value="">-- เลือกสถานะจำหน่าย --</option>
              ${options.statuses.map(s => `
                <option value="${s.dchstts}" ${d.dchstts === s.dchstts ? 'selected' : ''}>${s.dchstts} - ${s.name}</option>
              `).join('')}
            </select>
          </div>
          <div>
            <label style="font-size: 0.8rem; font-weight: 600; color: #475569; display: block; margin-bottom: 0.3rem;">
              🏷️ ประเภทการจำหน่าย (Discharge Type):
            </label>
            <select id="dchTypeSelect" class="form-control" ${state.isReadOnlyReview ? 'disabled' : ''} style="font-size: 0.88rem;">
              <option value="">-- เลือกประเภทจำหน่าย --</option>
              ${options.types.map(t => `
                <option value="${t.dchtype}" ${d.dchtype === t.dchtype ? 'selected' : ''}>${t.dchtype} - ${t.name}</option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Main Dual Approval Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
        
        <!-- CARD 1: DOCTOR SUMMARY APPROVAL -->
        <div style="background: white; border: 1.5px solid ${d.is_doctor_approved ? '#86efac' : '#fed7aa'}; border-radius: var(--radius-xl); padding: 1.5rem; box-shadow: var(--shadow-sm);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="font-size: 1.6rem;">👨‍⚕️</span>
              <div>
                <h4 style="margin: 0; font-size: 1.1rem; color: #1e293b;">การสรุปเวชระเบียนของแพทย์</h4>
                <span style="font-size: 0.8rem; color: var(--text-muted);">Inpatient Physician Summary</span>
              </div>
            </div>
            <span class="badge-tag" style="background: ${d.is_doctor_approved ? '#dcfce7' : '#fff7ed'}; color: ${d.is_doctor_approved ? '#15803d' : '#c2410c'}; font-size: 0.82rem; font-weight: 600;">
              ${d.is_doctor_approved ? '✅ แพทย์อนุมัติแล้ว' : '⏳ รอแพทย์สรุป'}
            </span>
          </div>

          <div style="background: #f8fafc; border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem; font-size: 0.88rem;">
            <div style="margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">แพทย์เจ้าของไข้ (Admit):</span> 
              <strong>${d.attending_doctor_name || p.doctor_name || '-'}</strong>
            </div>
            <div style="margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">แพทย์ผู้รับผิดชอบสรุป:</span> 
              <strong style="color: var(--primary-dark);">${d.assigned_doctor_name || d.attending_doctor_name || '-'}</strong>
            </div>
            ${d.doctor_signed_at ? `
              <div style="font-size: 0.8rem; color: #16a34a; margin-top: 0.4rem;">
                ✓ ลงนามและอนุมัติเมื่อ: ${new Date(d.doctor_signed_at).toLocaleString('th-TH')}
              </div>
            ` : ''}
          </div>

          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            ${!state.isReadOnlyReview ? `
              ${canDocApprove ? `
                <button class="btn btn-primary btn-sm" onclick="handleApproveCase('doctor')" style="background: ${d.is_doctor_approved ? '#16a34a' : 'var(--primary)'}; font-weight: 600; padding: 0.5rem 1rem;">
                  ${d.is_doctor_approved ? '✓ อนุมัติแล้ว (กดเพื่อยืนยันซ้ำ)' : '✅ แพทย์กด Approve & ลงลายเซ็น'}
                </button>
              ` : `
                <button class="btn btn-secondary btn-sm" disabled style="opacity: 0.6; cursor: not-allowed; font-size: 0.82rem;">
                  🔒 เฉพาะแพทย์เจ้าของไข้ (${d.assigned_doctor_name || p.doctor_name}) เท่านั้น
                </button>
              `}
              <button class="btn btn-secondary btn-sm" onclick="openDelegateModal('doctor')" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a; font-weight: 600;">
                🔄 มอบหมายแพทย์อื่นสรุปแทน
              </button>
            ` : `
              <span class="badge-tag" style="background: #f1f5f9; color: #475569;">🔒 โหมดทบทวนเวชระเบียน (ปิดการแก้ไขสถานะ)</span>
            `}
          </div>
        </div>

        <!-- CARD 2: NURSE REVIEW & APPROVAL -->
        <div style="background: white; border: 1.5px solid ${d.is_nurse_approved ? '#86efac' : '#bae6fd'}; border-radius: var(--radius-xl); padding: 1.5rem; box-shadow: var(--shadow-sm);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <span style="font-size: 1.6rem;">👩‍⚕️</span>
              <div>
                <h4 style="margin: 0; font-size: 1.1rem; color: #1e293b;">การตรวจสอบทางการพยาบาล</h4>
                <span style="font-size: 0.8rem; color: var(--text-muted);">Nursing Discharge Validation</span>
              </div>
            </div>
            <span class="badge-tag" style="background: ${d.is_nurse_approved ? '#dcfce7' : '#f0f9ff'}; color: ${d.is_nurse_approved ? '#15803d' : '#0369a1'}; font-size: 0.82rem; font-weight: 600;">
              ${d.is_nurse_approved ? '✅ พยาบาลอนุมัติแล้ว' : '⏳ รอพยาบาลตรวจสอบ'}
            </span>
          </div>

          <div style="background: #f8fafc; border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem; font-size: 0.88rem;">
            <div style="margin-bottom: 0.4rem;">
              <span style="color: var(--text-muted);">พยาบาลผู้รับผิดชอบ:</span> 
              <strong style="color: #0369a1;">${d.assigned_nurse_name || (user.is_nurse ? user.name : 'พยาบาลประจำตึก')}</strong>
            </div>
            ${d.nurse_signed_at ? `
              <div style="font-size: 0.8rem; color: #16a34a; margin-top: 0.4rem;">
                ✓ ลงนามและอนุมัติเมื่อ: ${new Date(d.nurse_signed_at).toLocaleString('th-TH')}
              </div>
            ` : ''}
          </div>

          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            ${!state.isReadOnlyReview ? `
              ${canNurseApprove ? `
                <button class="btn btn-primary btn-sm" onclick="handleApproveCase('nurse')" style="background: ${d.is_nurse_approved ? '#16a34a' : '#0284c7'}; font-weight: 600; padding: 0.5rem 1rem;">
                  ${d.is_nurse_approved ? '✓ อนุมัติแล้ว (กดเพื่อยืนยันซ้ำ)' : '✅ พยาบาลกด Approve & ลงลายเซ็น'}
                </button>
              ` : `
                <button class="btn btn-secondary btn-sm" disabled style="opacity: 0.6; cursor: not-allowed; font-size: 0.82rem;">
                  🔒 เฉพาะพยาบาลผู้รับผิดชอบ
                </button>
              `}
              <button class="btn btn-secondary btn-sm" onclick="openDelegateModal('nurse')" style="background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; font-weight: 600;">
                🔄 มอบหมายพยาบาลอื่นตรวจแทน
              </button>
            ` : `
              <span class="badge-tag" style="background: #f1f5f9; color: #475569;">🔒 โหมดทบทวนเวชระเบียน (ปิดการแก้ไขสถานะ)</span>
            `}
          </div>
        </div>
      </div>

      <!-- Delegation History Trail -->
      ${d.delegation_history && d.delegation_history.length > 0 ? `
        <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 1.5rem; margin-top: 1.5rem;">
          <h4 style="margin-bottom: 1rem; color: var(--text-main); font-size: 1rem;">
            📜 ประวัติการมอบหมายงานสรุปเวชระเบียน (Delegation Audit Trail)
          </h4>
          <table class="data-table" style="width: 100%; font-size: 0.85rem;">
            <thead>
              <tr style="background: #f8fafc;">
                <th>วัน-เวลา</th>
                <th>ประเภท</th>
                <th>จากผู้ปฏิบัติเดิม</th>
                <th>มอบหมายให้</th>
                <th>ผู้ทำการมอบหมาย</th>
              </tr>
            </thead>
            <tbody>
              ${d.delegation_history.map(h => `
                <tr>
                  <td>${new Date(h.at).toLocaleString('th-TH')}</td>
                  <td><span class="badge-tag">${h.type === 'doctor' ? '👨‍⚕️ แพทย์' : '👩‍⚕️ พยาบาล'}</span></td>
                  <td>${h.from || '-'}</td>
                  <td><strong>${h.to || '-'}</strong></td>
                  <td>${h.by || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    `;
  } catch (err) {
    container.innerHTML = `<div style="color: red; padding: 2rem;">เกิดข้อผิดพลาดในการโหลดข้อมูล: ${err.message}</div>`;
  }
}

async function openDelegateModal(type) {
  currentDelegateType = type;
  const modal = document.getElementById('delegateModal');
  const title = document.getElementById('delegateModalTitle');
  const selectLabel = document.getElementById('delegateTargetSelectLabel');
  const selectEl = document.getElementById('delegateTargetSelect');
  const alertBox = document.getElementById('delegateAlertBox');
  const nameEl = document.getElementById('delegatePatientName');
  const metaEl = document.getElementById('delegatePatientMeta');

  if (alertBox) alertBox.style.display = 'none';
  if (nameEl) nameEl.textContent = state.currentPatient?.patient_name || '-';
  if (metaEl) metaEl.textContent = `HN: ${state.currentPatient?.hn} | AN: ${state.currentPatient?.an}`;

  if (type === 'doctor') {
    title.textContent = '🔄 มอบหมายแพทย์ท่านอื่นสรุปเวชระเบียนแทน';
    selectLabel.innerHTML = '👨‍⚕️ เลือกแพทย์ผู้รับมอบหมายสรุปแทน (จากตาราง doctor):';
    selectEl.innerHTML = '<option value="">-- กำลังโหลดรายชื่อแพทย์... --</option>';

    try {
      const res = await fetch('/api/doctors');
      const json = await res.json();
      if (json.ok && json.data) {
        selectEl.innerHTML = '<option value="">-- กรุณาเลือกแพทย์ --</option>' + 
          json.data.map(doc => `<option value="${doc.code}" data-name="${doc.name}">${doc.name} ${doc.licenseno ? `(ว. ${doc.licenseno})` : ''}</option>`).join('');
      }
    } catch (e) {
      selectEl.innerHTML = '<option value="">โหลดรายชื่อแพทย์ล้มเหลว</option>';
    }
  } else {
    title.textContent = '🔄 มอบหมายพยาบาลท่านอื่นตรวจสอบเวชระเบียน';
    selectLabel.innerHTML = '👩‍⚕️ เลือกพยาบาลผู้รับมอบหมายตรวจสอบ:';
    selectEl.innerHTML = '<option value="">-- กำลังโหลดรายชื่อพยาบาล... --</option>';

    try {
      const res = await fetch('/api/nurses');
      const json = await res.json();
      if (json.ok && json.data) {
        selectEl.innerHTML = '<option value="">-- กรุณาเลือกพยาบาล --</option>' + 
          json.data.map(nur => `<option value="${nur.loginname}" data-name="${nur.name}">${nur.name} (${nur.department || nur.groupname || 'พยาบาล'})</option>`).join('');
      }
    } catch (e) {
      selectEl.innerHTML = '<option value="">โหลดรายชื่อพยาบาลล้มเหลว</option>';
    }
  }

  if (modal) modal.classList.add('open');
}

async function handleDelegateSubmit(e) {
  e.preventDefault();
  if (!state.currentPatient) return;

  const selectEl = document.getElementById('delegateTargetSelect');
  const noteEl = document.getElementById('delegateNoteInput');
  const alertBox = document.getElementById('delegateAlertBox');
  const submitBtn = document.getElementById('confirmDelegateBtn');

  const selectedCode = selectEl.value;
  const selectedOption = selectEl.selectedOptions[0];
  const selectedName = selectedOption ? selectedOption.dataset.name : '';
  const note = noteEl ? noteEl.value.trim() : '';

  if (!selectedCode || !selectedName) {
    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fee2e2';
      alertBox.style.color = '#991b1b';
      alertBox.textContent = 'กรุณาเลือกผู้รับมอบหมายงาน';
    }
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ กำลังบันทึก...';
    }

    const res = await fetch('/api/discharge-approval/delegate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        an: state.currentPatient.an,
        target_type: currentDelegateType,
        new_target_code: selectedCode,
        new_target_name: selectedName,
        delegated_by_name: state.currentUser?.name || 'ผู้ดูแลระบบ',
        note: note,
      }),
    });

    const json = await res.json();
    if (json.ok) {
      if (alertBox) {
        alertBox.style.display = 'block';
        alertBox.style.background = '#dcfce7';
        alertBox.style.color = '#15803d';
        alertBox.textContent = '✓ บันทึกการมอบหมายงานเรียบร้อย';
      }

      setTimeout(() => {
        closeAllModals();
        loadApprovalTab(state.currentPatient.an);
        loadPatients();
      }, 700);
    } else {
      if (alertBox) {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fee2e2';
        alertBox.style.color = '#991b1b';
        alertBox.textContent = json.error || 'เกิดข้อผิดพลาดในการมอบหมายงาน';
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fee2e2';
      alertBox.style.color = '#991b1b';
      alertBox.textContent = err.message;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 ยืนยันมอบหมายงาน';
    }
  }
}

async function handleApproveCase(role) {
  if (!state.currentPatient) return;
  const user = state.currentUser;
  if (!user) {
    alert('กรุณาเข้าสู่ระบบก่อนทำรายการ');
    return;
  }

  if (role === 'doctor' && !user.is_admin && user.doctorcode !== (state.currentApprovalData?.assigned_doctor_code || state.currentPatient.doctor_code)) {
    alert(`เฉพาะแพทย์เจ้าของไข้ (${state.currentApprovalData?.assigned_doctor_name || state.currentPatient.doctor_name}) หรือแพทย์ที่ได้รับมอบหมายเท่านั้น`);
    return;
  }

  if (!confirm(`ยืนยันการสรุปและอนุมัติ (Approve) เวชระเบียนในบทบาท ${role === 'doctor' ? 'แพทย์' : 'พยาบาล'}?`)) {
    return;
  }

  try {
    const res = await fetch('/api/discharge-approval/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        an: state.currentPatient.an,
        role: role,
        user_login: user.loginname,
        user_doctorcode: user.doctorcode || '',
        user_name: user.name,
      }),
    });

    const json = await res.json();
    if (json.ok) {
      alert(`✓ ${json.message}`);
      loadApprovalTab(state.currentPatient.an);
      loadPatients();
    } else {
      alert(`❌ ${json.error || 'เกิดข้อผิดพลาดในการอนุมัติ'}`);
    }
  } catch (err) {
    alert(`❌ เกิดข้อผิดพลาด: ${err.message}`);
  }
}

async function handleSaveDischargeInfo() {
  if (!state.currentPatient) return;
  const dchdate = document.getElementById('dchDateInput')?.value || '';
  const dchtime = document.getElementById('dchTimeInput')?.value || '';
  const dchsttsSelect = document.getElementById('dchStatusSelect');
  const dchtypeSelect = document.getElementById('dchTypeSelect');

  const dchstts = dchsttsSelect?.value || '';
  const dchstts_name = dchsttsSelect?.selectedOptions[0]?.text || '';
  const dchtype = dchtypeSelect?.value || '';
  const dchtype_name = dchtypeSelect?.selectedOptions[0]?.text || '';
  const syncHosxp = document.getElementById('syncHosxpDchCheckbox') ? document.getElementById('syncHosxpDchCheckbox').checked : true;

  try {
    const res = await fetch('/api/discharge-approval/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        an: state.currentPatient.an,
        hn: state.currentPatient.hn,
        dchdate,
        dchtime,
        dchstts,
        dchstts_name: dchstts ? dchstts_name : '',
        dchtype,
        dchtype_name: dchtype ? dchtype_name : '',
        sync_hosxp: syncHosxp,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      showToast(json.hosxp_synced ? '🔗 บันทึกและซิงค์ข้อมูลจำหน่ายเข้าตาราง ipt (HOSxP) เรียบร้อย' : '✓ บันทึกวันและสถานะการจำหน่ายเรียบร้อย');
      state.currentPatient.dchdate = dchdate;
      state.currentPatient.dchtime = dchtime;
      state.currentPatient.dchstts = dchstts;
      state.currentPatient.dchstts_name = dchstts_name;
      state.currentPatient.dchtype = dchtype;
      state.currentPatient.dchtype_name = dchtype_name;
      if (state.currentPatient.approval) {
        state.currentPatient.approval.dchdate = dchdate;
        state.currentPatient.approval.dchtime = dchtime;
        state.currentPatient.approval.dchstts = dchstts;
        state.currentPatient.approval.dchstts_name = dchstts_name;
        state.currentPatient.approval.dchtype = dchtype;
        state.currentPatient.approval.dchtype_name = dchtype_name;
      }
      renderPatientHeader(state.currentPatient);
      loadApprovalTab(state.currentPatient.an);
    } else {
      alert('❌ ' + (json.error || 'เกิดข้อผิดพลาดในการบันทึก'));
    }
  } catch (e) {
    alert('❌ เกิดข้อผิดพลาด: ' + e.message);
  }
}

// Tab 1: Patient Overview & Admission Profile
async function loadOverviewTab(an) {
  const container = document.getElementById('overviewContainer');
  if (!container) return;
  const p = state.currentPatient;

  const [vitalsRes, diagRes] = await Promise.all([
    fetch(`/api/patient/${an}/vitals`).then(r => r.json()),
    fetch(`/api/patient/${an}/diagnosis`).then(r => r.json()),
  ]);

  const vitals = vitalsRes.ok ? vitalsRes.data : [];
  const diags = diagRes.ok ? diagRes.data : [];
  const latestV = vitals.length > 0 ? vitals[vitals.length - 1] : null;

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.25rem; margin-bottom: 1.25rem;">
      
      <!-- CARD 1: Clinical Admission Profile -->
      <div class="emr-card">
        <div class="emr-card-header">
          <h3 class="emr-card-title">
            <span style="font-size: 1.2rem;">📋</span>
            <span>ข้อมูลแรกรับผู้ป่วย (Admission Profile)</span>
          </h3>
          <span class="meta-pill meta-pill-admit">
            📅 ${new Date(p.regdate).toLocaleDateString('th-TH')} ${p.regtime ? p.regtime.slice(0, 5) : ''}
          </span>
        </div>

        <div class="kv-grid">
          <div class="kv-item" style="grid-column: 1 / -1; background: #f8fafc; padding: 0.75rem 0.9rem; border-radius: var(--radius-md); border-left: 3.5px solid var(--primary);">
            <span class="kv-label">อาการสำคัญแรกรับ (Chief Complaint):</span>
            <span class="kv-val" style="font-size: 0.95rem; color: #0f172a; margin-top: 0.15rem;">${p.prediag || 'ไม่มีบันทึก'}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">หอผู้ป่วย / เตียง:</span>
            <span class="kv-val">${p.ward_name} (เตียง ${p.bedno || p.bedname || 'รอจัดเตียง'})</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">สิทธิการรักษา:</span>
            <span class="kv-val" style="color: var(--primary-dark);">${p.pttype_name || p.pttype}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">แพทย์เจ้าของไข้:</span>
            <span class="kv-val">${p.approval?.assigned_doctor_name || p.doctor_name || '-'}</span>
          </div>
          <div class="kv-item">
            <span class="kv-label">ผู้ติดต่อฉุกเฉิน:</span>
            <span class="kv-val">${p.informname || '-'} ${p.informrelation ? `(${p.informrelation})` : ''} ${p.informtel ? `โทร ${p.informtel}` : ''}</span>
          </div>
        </div>
      </div>

      <!-- CARD 2: Latest Vitals Snapshot -->
      <div class="emr-card">
        <div class="emr-card-header">
          <h3 class="emr-card-title">
            <span style="font-size: 1.2rem;">💓</span>
            <span>สัญญาณชีพล่าสุด (Latest Vitals)</span>
          </h3>
          ${!state.isReadOnlyReview ? `
            <button class="btn btn-primary btn-sm" onclick="openVitalsModal()" style="border-radius: 9999px; padding: 0.35rem 0.85rem; font-weight: 600;">
              + บันทึกสัญญาณชีพ
            </button>
          ` : `
            <span class="badge-tag" style="background: #f1f5f9; color: #64748b; font-size: 0.8rem;">🔒 Read-Only</span>
          `}
        </div>

        ${latestV ? `
          <div class="vital-metric-grid" style="margin-top: 0.5rem;">
            <div class="vital-metric-card" style="border-top: 3px solid #e11d48;">
              <div class="label">BT (อุณหภูมิ)</div>
              <div class="value" style="color: ${latestV.temperature >= 38 ? '#e11d48' : '#0f172a'};">
                ${latestV.temperature ? `${Number(latestV.temperature).toFixed(1)}°` : '-'}
              </div>
            </div>
            <div class="vital-metric-card" style="border-top: 3px solid #0284c7;">
              <div class="label">PR (ชีพจร)</div>
              <div class="value" style="color: ${latestV.pulse >= 100 || (latestV.pulse && latestV.pulse < 60) ? '#e11d48' : '#0f172a'};">
                ${latestV.pulse || '-'}
              </div>
            </div>
            <div class="vital-metric-card" style="border-top: 3px solid #059669;">
              <div class="label">BP (ความดัน)</div>
              <div class="value" style="font-size: 1.15rem; color: ${latestV.bp_systolic >= 140 ? '#e11d48' : '#0f172a'};">
                ${latestV.bp_systolic && latestV.bp_diastolic ? `${latestV.bp_systolic}/${latestV.bp_diastolic}` : '-'}
              </div>
            </div>
            <div class="vital-metric-card" style="border-top: 3px solid #7c3aed;">
              <div class="label">SpO2 (ออกซิเจน)</div>
              <div class="value" style="color: ${(latestV.spo2_ra && latestV.spo2_ra < 95) ? '#e11d48' : '#0f172a'};">
                ${latestV.spo2_ra ? `${latestV.spo2_ra}%` : (latestV.spo2_o2 ? `${latestV.spo2_o2}%` : '-')}
              </div>
            </div>
          </div>
          <div style="margin-top: 0.85rem; font-size: 0.78rem; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed #e2e8f0; padding-top: 0.5rem;">
            <span>ผู้บันทึก: <strong>${latestV.staff || 'พยาบาล'}</strong></span>
            <span>เมื่อ: ${new Date(latestV.note_date).toLocaleDateString('th-TH')} ${latestV.note_time ? latestV.note_time.slice(0, 5) : ''}</span>
          </div>
        ` : `
          <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); background: #f8fafc; border-radius: var(--radius-md); border: 1px dashed #cbd5e1;">
            <p style="margin-bottom: 0.75rem; font-size: 0.88rem;">ยังไม่มีการบันทึกสัญญาณชีพ</p>
            ${!state.isReadOnlyReview ? `
              <button class="btn btn-secondary btn-sm" onclick="openVitalsModal()" style="border-radius: 9999px;">
                ✏️ กดเพื่อเริ่มบันทึกแรกรับ
              </button>
            ` : ''}
          </div>
        `}
      </div>

    </div>

    <!-- CARD 3: Active Diagnoses ICD-10 -->
    <div class="emr-card">
      <div class="emr-card-header">
        <h3 class="emr-card-title">
          <span style="font-size: 1.2rem;">📑</span>
          <span>การวินิจฉัยโรค (Current Diagnoses ICD-10)</span>
        </h3>
        <button class="btn btn-secondary btn-sm" onclick="switchTab('diag')" style="border-radius: 9999px; font-size: 0.8rem;">
          ดูรายละเอียด ICD-10 ทั้งหมด ➔
        </button>
      </div>

      ${diags.length > 0 ? `
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 25%;">ประเภท (Diag Type)</th>
                <th style="width: 15%;">ICD-10 Code</th>
                <th>ชื่อโรค (Diagnosis Description)</th>
                <th style="width: 25%;">แพทย์ผู้วินิจฉัย</th>
              </tr>
            </thead>
            <tbody>
              ${diags.map(d => {
                const isPrincipal = d.diagtype === '1' || d.diagtype_name?.includes('Principal');
                return `
                  <tr>
                    <td>
                      <span class="${isPrincipal ? 'badge-diag-principal' : 'badge-diag-other'}">
                        ${isPrincipal ? '★ ' : ''}${d.diagtype_name || (isPrincipal ? 'Principal Diag' : 'Other')}
                      </span>
                    </td>
                    <td><span class="badge-icd10">${d.icd10}</span></td>
                    <td style="font-weight: 500;">${d.icd_name || d.diagnosis_note || '-'}</td>
                    <td style="color: #475569;">${d.doctor_name || '-'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted); background: #f8fafc; border-radius: var(--radius-md); border: 1px dashed #cbd5e1;">
          <p style="margin: 0; font-size: 0.9rem;">ยังไม่มีการบันทึกการวินิจฉัยโรค (ICD-10) สำหรับการนอนโรงพยาบาลครั้งนี้</p>
        </div>
      `}
    </div>
  `;
}

// Tab 2: Admission Assessment & Physical Examination (PE)
async function loadPeTab(an) {
  const container = document.getElementById('peContainer');
  const res = await fetch(`/api/patient/${an}/admission-assessment`);
  const json = await res.json();
  const d = json.ok ? json.data : {};

  // Store for modal form prefill
  state.currentPeData = d;

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="color: var(--primary-dark);">🩺 การประเมินแรกรับและตรวจร่างกาย (Admission & Physical Exam)</h3>
        <span style="font-size: 0.82rem; color: var(--text-muted);">ตามเกณฑ์มาตรฐานเวชระเบียน MRA 2026 (ตรวจร่างกายครบ 7 ระบบ)</span>
      </div>
      ${!state.isReadOnlyReview ? `
        <button class="btn btn-primary btn-sm" onclick="openPeModal()">✏️ บันทึก / แก้ไขผลตรวจแรกรับ</button>
      ` : `
        <span class="badge-tag" style="background: #f1f5f9; color: #64748b; font-size: 0.82rem;">🔒 Read-Only Audit</span>
      `}
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; margin-bottom: 1.25rem;">
      <!-- History Card -->
      <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
        <h4 style="color: var(--primary-dark); margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">
          📝 ประวัติแรกรับ (History Taking)
        </h4>
        <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.9rem;">
          <div><strong style="color: var(--text-muted);">อาการสำคัญ (Chief Complaint):</strong><div style="margin-top: 0.2rem; font-weight: 500;">${d.cc || d.prediag || 'ไม่มีบันทึก'}</div></div>
          <div><strong style="color: var(--text-muted);">ประวัติปัจจุบัน (Present Illness):</strong><div style="margin-top: 0.2rem;">${d.hpi || '-'}</div></div>
          <div><strong style="color: var(--text-muted);">ประวัติอดีต/โรคประจำตัว (Past History):</strong><div style="margin-top: 0.2rem;">${d.pmh || '-'}</div></div>
          <div><strong style="color: var(--text-muted);">ประวัติครอบครัว (Family History):</strong><div style="margin-top: 0.2rem;">${d.fh || '-'}</div></div>
          <div><strong style="color: var(--text-muted);">ประวัติแพ้ยา:</strong><div style="margin-top: 0.2rem; color: ${d.drugallergy ? 'var(--rose)' : 'inherit'}; font-weight: 600;">${d.drugallergy || 'ปฏิเสธประวัติแพ้ยา'}</div></div>
        </div>
      </div>

      <!-- Vital Signs at Admission Card -->
      <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
        <h4 style="color: var(--primary-dark); margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">
          💓 สัญญาณชีพและมาตรวัดแรกรับ (Initial Vitals)
        </h4>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem;">
          <div style="background: var(--surface-subtle); padding: 0.75rem; border-radius: var(--radius-md); text-align: center;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">อุณหภูมิ (BT)</div>
            <div style="font-size: 1.3rem; font-weight: 700;">${d.temperature ? `${d.temperature} °C` : '-'}</div>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.75rem; border-radius: var(--radius-md); text-align: center;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">ชีพจร (Pulse)</div>
            <div style="font-size: 1.3rem; font-weight: 700;">${d.pulse ? `${d.pulse} bpm` : '-'}</div>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.75rem; border-radius: var(--radius-md); text-align: center;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">การหายใจ (RR)</div>
            <div style="font-size: 1.3rem; font-weight: 700;">${d.rr ? `${d.rr} /min` : '-'}</div>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.75rem; border-radius: var(--radius-md); text-align: center;">
            <div style="font-size: 0.75rem; color: var(--text-muted);">ความดันโลหิต (BP)</div>
            <div style="font-size: 1.3rem; font-weight: 700;">${d.bps && d.bpd ? `${d.bps}/${d.bpd}` : '-'}</div>
          </div>
        </div>
        <div style="margin-top: 1rem; font-size: 0.85rem; color: var(--text-muted); display: flex; justify-content: space-between;">
          <span>น้ำหนัก: ${d.bw || '-'} kg | ส่วนสูง: ${d.height || '-'} cm</span>
          <span>BMI: ${d.bmi || '-'} kg/m²</span>
        </div>
      </div>
    </div>

    <!-- 7 Systems PE Grid -->
    <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
      <h4 style="color: var(--primary-dark); margin-bottom: 1rem;">
        🩺 ผลการตรวจร่างกายครบ 7 ระบบ (Physical Examination - 7 Systems Checklist)
      </h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; background: var(--surface-subtle);">
          <strong style="color: var(--primary-dark); font-size: 0.9rem;">1. General Appearance (GA)</strong>
          <p style="font-size: 0.88rem; margin-top: 0.35rem; color: var(--text-main);">${d.pe_ga || 'Good consciousness, not pale, no jaundice'}</p>
        </div>
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; background: var(--surface-subtle);">
          <strong style="color: var(--primary-dark); font-size: 0.9rem;">2. HEENT</strong>
          <p style="font-size: 0.88rem; margin-top: 0.35rem; color: var(--text-main);">${d.pe_heent || 'Normal pharynx, not injected, no lymphadenopathy'}</p>
        </div>
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; background: var(--surface-subtle);">
          <strong style="color: var(--primary-dark); font-size: 0.9rem;">3. Heart & CVS</strong>
          <p style="font-size: 0.88rem; margin-top: 0.35rem; color: var(--text-main);">${d.pe_heart || 'Normal S1 S2, regular rhythm, no murmur'}</p>
        </div>
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; background: var(--surface-subtle);">
          <strong style="color: var(--primary-dark); font-size: 0.9rem;">4. Lungs & Respiratory</strong>
          <p style="font-size: 0.88rem; margin-top: 0.35rem; color: var(--text-main);">${d.pe_lung || 'Clear breath sounds both lungs, no wheezing'}</p>
        </div>
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; background: var(--surface-subtle);">
          <strong style="color: var(--primary-dark); font-size: 0.9rem;">5. Abdomen</strong>
          <p style="font-size: 0.88rem; margin-top: 0.35rem; color: var(--text-main);">${d.pe_ab || 'Soft, not tender, no distension, normal bowel sound'}</p>
        </div>
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; background: var(--surface-subtle);">
          <strong style="color: var(--primary-dark); font-size: 0.9rem;">6. Extremities</strong>
          <p style="font-size: 0.88rem; margin-top: 0.35rem; color: var(--text-main);">${d.pe_ext || 'No edema, peripheral pulses palpable both feet'}</p>
        </div>
        <div style="border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; background: var(--surface-subtle); grid-column: span 2;">
          <strong style="color: var(--primary-dark); font-size: 0.9rem;">7. Neurological Examination</strong>
          <p style="font-size: 0.88rem; margin-top: 0.35rem; color: var(--text-main);">${d.pe_neuro || 'Alert, oriented to time place person, Motor grade V all extremities'}</p>
        </div>
      </div>
    </div>
  `;
}

// Tab 2: TPR & Graphic Vital Signs Chart
async function loadTPRChartTab(an) {
  const container = document.getElementById('tprChartContainer');
  const res = await fetch(`/api/patient/${an}/vitals`);
  const json = await res.json();
  const vitals = json.ok ? json.data : [];

  if (vitals.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        <p style="margin-bottom: 1rem;">ยังไม่มีข้อมูลกราฟสัญญาณชีพ</p>
        <button class="btn btn-primary" onclick="openVitalsModal()">+ บันทึกสัญญาณชีพแรกรับ</button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <h3 style="color: var(--primary-dark);">📈 กราฟสัญญาณชีพ (TPR & Blood Pressure Flow Sheet)</h3>
      ${!state.isReadOnlyReview ? `
        <button class="btn btn-primary btn-sm" onclick="openVitalsModal()">+ เพิ่มจุดบันทึก</button>
      ` : `
        <span class="badge-tag" style="background: #f1f5f9; color: #64748b; font-size: 0.82rem;">🔒 Read-Only</span>
      `}
    </div>
    <div style="height: 380px; width: 100%; position: relative; margin-bottom: 2rem;">
      <canvas id="tprCanvas"></canvas>
    </div>

    <h4 style="margin-bottom: 0.75rem;">ตารางประวัติสัญญาณชีพ</h4>
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>วัน-เวลา</th>
            <th>BT (°C)</th>
            <th>PR (bpm)</th>
            <th>RR (/min)</th>
            <th>BP (mmHg)</th>
            <th>SpO2 (%)</th>
            <th>Pain (0-10)</th>
            <th>SOS / NEWS2</th>
            <th>ผู้บันทึก</th>
          </tr>
        </thead>
        <tbody>
          ${vitals.slice().reverse().map(v => `
            <tr>
              <td>${new Date(v.note_date).toLocaleDateString('th-TH')} ${v.note_time || ''}</td>
              <td style="color: ${v.temperature >= 38 ? 'var(--rose); font-weight: bold;' : 'inherit'}">${v.temperature || '-'}</td>
              <td style="color: ${v.pulse >= 100 ? 'var(--rose); font-weight: bold;' : 'inherit'}">${v.pulse || '-'}</td>
              <td>${v.respiratory_rate || '-'}</td>
              <td style="color: ${v.bp_systolic >= 140 ? 'var(--rose); font-weight: bold;' : 'inherit'}">
                ${v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '-'}
              </td>
              <td style="color: ${v.spo2_ra < 95 ? 'var(--rose); font-weight: bold;' : 'inherit'}">
                ${v.spo2_ra || v.spo2_o2 || '-'}
              </td>
              <td>${v.pain_score !== null ? v.pain_score : '-'}</td>
              <td>${v.sos_score || v.news2_score || '-'}</td>
              <td>${v.staff || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Render Chart.js
  const ctx = document.getElementById('tprCanvas').getContext('2d');
  const labels = vitals.map(v => `${new Date(v.note_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${v.note_time ? v.note_time.slice(0, 5) : ''}`);
  
  if (state.tprChartInstance) state.tprChartInstance.destroy();

  state.tprChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Body Temp (°C)',
          data: vitals.map(v => v.temperature),
          borderColor: '#e11d48',
          backgroundColor: 'rgba(225, 29, 72, 0.1)',
          yAxisID: 'yTemp',
          tension: 0.3,
          borderWidth: 2.5,
        },
        {
          label: 'Pulse Rate (bpm)',
          data: vitals.map(v => v.pulse),
          borderColor: '#0284c7',
          backgroundColor: 'rgba(2, 132, 199, 0.1)',
          yAxisID: 'yPulse',
          tension: 0.3,
          borderWidth: 2,
        },
        {
          label: 'BP Systolic (mmHg)',
          data: vitals.map(v => v.bp_systolic),
          borderColor: '#059669',
          borderDash: [5, 5],
          yAxisID: 'yPulse',
          tension: 0.2,
          borderWidth: 1.5,
        },
        {
          label: 'SpO2 (%)',
          data: vitals.map(v => v.spo2_ra || v.spo2_o2),
          borderColor: '#7c3aed',
          yAxisID: 'yPulse',
          tension: 0.2,
          borderWidth: 1.5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        yTemp: {
          type: 'linear',
          display: true,
          position: 'left',
          min: 35,
          max: 41,
          title: { display: true, text: 'Temperature (°C)' },
          grid: { color: '#f1f5f9' }
        },
        yPulse: {
          type: 'linear',
          display: true,
          position: 'right',
          min: 40,
          max: 180,
          title: { display: true, text: 'PR / BP / SpO2' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// Tab 3: Doctor Orders & Med Plan (Enhanced with Category Chips & Resolved Names)
async function loadOrdersTab(an) {
  const container = document.getElementById('ordersContainer');
  if (container) container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">⏳ กำลังโหลดรายการยาและคำสั่งแพทย์...</div>';
  try {
    const res = await fetch(`/api/patient/${an}/orders`);
    const json = await res.json();
    // รองรับทั้ง json.orders และ json.data จาก API (ทั้งสองรูปแบบ)
    const raw = json.ok ? (json.orders || json.data || []) : [];
    state.currentOrders = Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.error('loadOrdersTab error:', e);
    state.currentOrders = [];
  }
  state.orderFilter = 'ALL';
  renderOrdersTable();
}

function renderOrdersTable() {
  const container = document.getElementById('ordersContainer');
  const all = Array.isArray(state.currentOrders) ? state.currentOrders : [];
  const filter = state.orderFilter;

  const filtered = all.filter(item => {
    if (filter === 'DRUG') return item.item_type === 'DRUG';
    if (filter === 'NONDRUG') return item.item_type === 'NONDRUG';
    return true;
  });

  const drugCount = all.filter(i => i.item_type === 'DRUG').length;
  const nonDrugCount = all.filter(i => i.item_type === 'NONDRUG').length;

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
      <div>
        <h3 style="color: var(--primary-dark); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span>💊 รายการยาและคำสั่งการรักษา (Medication Plan & Doctor Orders)</span>
          <span class="hosxp-sync-pill">🔗 เชื่อมตาราง medplan_ipd (HOSxP)</span>
        </h3>
      </div>
      
      <!-- Filter Chips & Add Order Button -->
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
        <button class="btn btn-sm ${filter === 'ALL' ? 'btn-primary' : 'btn-secondary'}" onclick="setOrderFilter('ALL')">
          ทั้งหมด (${all.length})
        </button>
        <button class="btn btn-sm ${filter === 'DRUG' ? 'btn-primary' : 'btn-secondary'}" onclick="setOrderFilter('DRUG')">
          💊 รายการยา (${drugCount})
        </button>
        <button class="btn btn-sm ${filter === 'NONDRUG' ? 'btn-primary' : 'btn-secondary'}" onclick="setOrderFilter('NONDRUG')">
          🔬 ตรวจ Lab / X-Ray / หัตถการ (${nonDrugCount})
        </button>
        ${!state.isReadOnlyReview ? `
          <button class="btn btn-sm btn-primary" onclick="openOrderModal()" style="background: linear-gradient(135deg, #0284c7, #0369a1); font-weight: 700; margin-left: 0.25rem;">
            + สั่งยา / การรักษาใหม่ (Sync HOSxP)
          </button>
        ` : ''}
      </div>
    </div>

    ${filtered.length > 0 ? `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>ประเภท</th>
              <th>หมวด</th>
              <th>รายการยา / การตรวจ (Item Name & Strength)</th>
              <th>วิธีใช้ (Signa / Instructions)</th>
              <th>จำนวน</th>
              <th>วันที่เริ่มสั่ง</th>
              <th>แพทย์ผู้สั่ง</th>
              <th>สถานะ / จัดการ</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(m => `
              <tr>
                <td>
                  <span class="badge-tag" style="background: ${m.is_stat === 'Y' ? 'var(--rose-light)' : 'var(--emerald-light)'}; color: ${m.is_stat === 'Y' ? 'var(--rose-text)' : 'var(--emerald-text)'};">
                    ${m.is_stat === 'Y' ? 'STAT Order' : 'Continue'}
                  </span>
                </td>
                <td>
                  <span class="badge-tag" style="background: ${m.item_type === 'DRUG' ? 'var(--primary-light)' : 'var(--purple-light)'}; color: ${m.item_type === 'DRUG' ? 'var(--primary-dark)' : 'var(--purple)'};">
                    ${m.item_type === 'DRUG' ? '💊 ยา' : '🔬 ตรวจ/บริการ'}
                  </span>
                </td>
                <td>
                  <strong style="font-size: 0.95rem; color: var(--text-main);">${m.item_name}</strong>
                  ${m.strength ? `<span style="color: var(--text-muted); font-size: 0.85rem; margin-left: 0.35rem;">(${m.strength})</span>` : ''}
                </td>
                <td style="color: var(--text-sub);">
                  ${m.usage_text ? `<span style="font-weight: 500;">${m.usage_text}</span>` : (m.doctor_note ? `<em>${m.doctor_note}</em>` : '-')}
                </td>
                <td>${m.qty} ${m.units || ''}</td>
                <td>${new Date(m.orderdate).toLocaleDateString('th-TH')}</td>
                <td>${m.doctor_name || '-'}</td>
                <td>
                  <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <span class="badge-tag" style="background: ${m.offdate ? 'var(--surface-subtle)' : 'var(--primary-light)'}; color: ${m.offdate ? 'var(--text-muted)' : 'var(--primary-dark)'};">
                      ${m.offdate ? 'Off Med' : 'Active'}
                    </span>
                    ${(!m.offdate && !state.isReadOnlyReview && m.med_plan_number) ? `
                      <button class="btn btn-secondary btn-sm" style="padding: 0.15rem 0.5rem; font-size: 0.72rem; color: var(--rose);" onclick="handleOffOrder('${m.med_plan_number}', '${(m.item_name || '').replace(/'/g, "\\'")}')">
                        🛑 Off
                      </button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        ไม่พบรายการในหมวดนี้
      </div>
    `}
  `;
}

function setOrderFilter(f) {
  state.orderFilter = f;
  renderOrdersTable();
}

// Tab 4: Nurse Notes & Care Plan (FDAR)
async function loadNurseNotesTab(an) {
  const container = document.getElementById('nurseContainer');
  const res = await fetch(`/api/patient/${an}/nurse-notes`);
  const json = await res.json();
  const notes = json.ok ? json.data : [];

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <h3 style="color: var(--primary-dark);">📝 บันทึกทางการพยาบาล (Nurse Focus Charting - FDAR)</h3>
      ${!state.isReadOnlyReview ? `
        <button class="btn btn-primary btn-sm" onclick="openNurseNoteModal()">+ เพิ่มบันทึกพยาบาล</button>
      ` : `
        <span class="badge-tag" style="background: #f1f5f9; color: #64748b; font-size: 0.82rem;">🔒 Read-Only</span>
      `}
    </div>

    ${notes.length > 0 ? `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        ${notes.map(n => `
          <div style="background: white; border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: var(--radius-md); padding: 1rem;">
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">
              <span>📅 ${new Date(n.note_date).toLocaleDateString('th-TH')} เวลา ${n.note_time ? n.note_time.slice(0, 5) : ''}</span>
              <span>✍️ ผู้บันทึก: <strong>${n.staff}</strong></span>
            </div>
            <div style="white-space: pre-wrap; font-size: 0.95rem; line-height: 1.6; color: var(--text-main);">
              ${n.note}
            </div>
            ${(n.fluid_intake_oral > 0 || n.fluid_output_urine > 0) ? `
              <div style="margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px dashed var(--border); font-size: 0.82rem; color: var(--text-sub); display: flex; gap: 1rem;">
                <span>💧 In: Oral ${n.fluid_intake_oral} ml / IV ${n.fluid_intake_parenteral} ml</span>
                <span>🚽 Out: Urine ${n.fluid_output_urine} ml / Emesis ${n.fluid_output_emesis} ml</span>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    ` : `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        ยังไม่มีบันทึกทางการพยาบาล ${!state.isReadOnlyReview ? '<button class="btn btn-secondary btn-sm" onclick="openNurseNoteModal()">+ เขียนบันทึก</button>' : ''}
      </div>
    `}
  `;
}

// Tab 4: Doctor Progress Notes (SOAP Timeline)
async function loadSoapTab(an) {
  const container = document.getElementById('soapContainer');
  const res = await fetch(`/api/patient/${an}/progress-notes`);
  const json = await res.json();
  const notes = json.ok ? json.data : [];

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="color: var(--primary-dark);">👨‍⚕️ บันทึกความก้าวหน้าการรักษา (Doctor Progress Notes - SOAP)</h3>
        <span style="font-size: 0.82rem; color: var(--text-muted);">ตามเกณฑ์เวชระเบียน MRA: ต้องมีบันทึกความก้าวหน้าและแผนการรักษาต่อเนื่อง</span>
      </div>
      ${!state.isReadOnlyReview ? `
        <button class="btn btn-primary btn-sm" onclick="openSoapModal()">+ เขียนบันทึก SOAP ประจำวัน</button>
      ` : `
        <span class="badge-tag" style="background: #f1f5f9; color: #64748b; font-size: 0.82rem;">🔒 Read-Only</span>
      `}
    </div>

    ${notes.length > 0 ? `
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        ${notes.map(n => `
          <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 0.6rem; margin-bottom: 0.85rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="badge-tag" style="background: var(--primary-light); color: var(--primary-dark); font-weight: 700;">
                  📅 ${new Date(n.order_date).toLocaleDateString('th-TH')} ${n.order_time ? n.order_time.slice(0, 5) : ''}
                </span>
                <span style="font-weight: 600; font-size: 0.95rem; color: var(--text-main);">Doctor Ward Round Note</span>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">
                🩺 ผู้ตรวจ: <strong>${n.doctor_name || 'แพทย์ประจำตึก'}</strong>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem;">
              <div style="background: #f8fafc; padding: 0.75rem; border-radius: var(--radius-md); border-left: 3px solid #38bdf8;">
                <strong style="color: var(--primary-dark); font-size: 0.85rem;">S: Subjective</strong>
                <p style="font-size: 0.88rem; margin-top: 0.25rem; color: var(--text-main);">${n.pn_s || '-'}</p>
              </div>
              <div style="background: #f8fafc; padding: 0.75rem; border-radius: var(--radius-md); border-left: 3px solid #0284c7;">
                <strong style="color: var(--primary-dark); font-size: 0.85rem;">O: Objective</strong>
                <p style="font-size: 0.88rem; margin-top: 0.25rem; color: var(--text-main);">${n.pn_o || '-'}</p>
              </div>
              <div style="background: #f8fafc; padding: 0.75rem; border-radius: var(--radius-md); border-left: 3px solid #f59e0b;">
                <strong style="color: #b45309; font-size: 0.85rem;">A: Assessment</strong>
                <p style="font-size: 0.88rem; margin-top: 0.25rem; color: var(--text-main);">${n.pn_a || '-'}</p>
              </div>
              <div style="background: #f8fafc; padding: 0.75rem; border-radius: var(--radius-md); border-left: 3px solid #10b981;">
                <strong style="color: #047857; font-size: 0.85rem;">P: Plan</strong>
                <p style="font-size: 0.88rem; margin-top: 0.25rem; color: var(--text-main);">${n.pn_p || '-'}</p>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted); background: white; border-radius: var(--radius-lg); border: 1px solid var(--border);">
        <p style="margin-bottom: 1rem;">ยังไม่มีบันทึก SOAP สำหรับผู้ป่วยรายนี้</p>
        <button class="btn btn-primary" onclick="openSoapModal()">+ เขียนบันทึก SOAP แรก</button>
      </div>
    `}
  `;
}

// Tab 6: Electronic Medication Administration Record (e-MAR)
async function loadMarTab(an) {
  const container = document.getElementById('marContainer');
  const res = await fetch(`/api/patient/${an}/mar`);
  const json = await res.json();
  const meds = json.ok ? json.data : [];

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="color: var(--primary-dark);">💉 ตารางการบริหารยาทางการพยาบาล (Electronic MAR)</h3>
        <span style="font-size: 0.82rem; color: var(--text-muted);">บันทึกการให้ยาตามรอบเวลา พร้อมระบบเฝ้าระวังยาที่มีความเสี่ยงสูง (High Alert Drugs)</span>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <span class="badge-tag" style="background: var(--rose-light); color: var(--rose-text);">🔴 High Alert Drug (HAD)</span>
        <span class="badge-tag" style="background: var(--emerald-light); color: var(--emerald-text);">✓ บริหารยาแล้ว</span>
      </div>
    </div>

    ${meds.length > 0 ? `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>รายการยา & ความแรง</th>
              <th>คำสั่งวิธีใช้ (Signa)</th>
              <th>เช้า (08:00)</th>
              <th>กลางวัน (12:00)</th>
              <th>เย็น (18:00)</th>
              <th>ก่อนนอน (20:00)</th>
              <th>การกระทำ / ยืนยัน</th>
            </tr>
          </thead>
          <tbody>
            ${meds.map(m => {
              const isHad = m.criticalpriority === 'Y' || (m.drug_name && (m.drug_name.includes('Insulin') || m.drug_name.includes('Morphine') || m.drug_name.includes('Pethidine') || m.drug_name.includes('Heparin') || m.drug_name.includes('Warfarin')));
              return `
                <tr>
                  <td>
                    <div style="display: flex; align-items: center; gap: 0.35rem;">
                      ${isHad ? '<span class="badge-tag" style="background: var(--rose-light); color: var(--rose-text); font-size: 0.7rem;">HAD</span>' : ''}
                      <strong style="font-size: 0.95rem; color: var(--primary-dark);">${m.drug_name}</strong>
                    </div>
                    ${m.strength ? `<small style="color: var(--text-muted);">${m.strength}</small>` : ''}
                  </td>
                  <td style="color: var(--text-main); font-size: 0.88rem;">${m.usage_text || '-'}</td>
                  <td><button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="administerMed(this, '${(m.drug_name || m.icode).replace(/'/g, "\\'")}', 'เช้า (08:00)')">✓ ให้ยา</button></td>
                  <td><button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="administerMed(this, '${(m.drug_name || m.icode).replace(/'/g, "\\'")}', 'กลางวัน (12:00)')">✓ ให้ยา</button></td>
                  <td><button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="administerMed(this, '${(m.drug_name || m.icode).replace(/'/g, "\\'")}', 'เย็น (18:00)')">✓ ให้ยา</button></td>
                  <td><button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="administerMed(this, '${(m.drug_name || m.icode).replace(/'/g, "\\'")}', 'ก่อนนอน (20:00)')">✓ ให้ยา</button></td>
                  <td>
                    <button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.5rem; color: var(--rose);" onclick="holdMed('${(m.drug_name || m.icode).replace(/'/g, "\\'")}')">🛑 Hold ยา</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        ยังไม่มีรายการยาที่ต้องบริหารในช่วงนี้
      </div>
    `}
  `;
}

async function administerMed(btnEl, drugName, round) {
  if (!state.currentPatient) return;
  const staff = state.currentUser?.name || 'พยาบาลประจำตึก';
  try {
    if (btnEl && btnEl.tagName === 'BUTTON') {
      btnEl.disabled = true;
      btnEl.textContent = '⏳...';
    }
    const res = await fetch(`/api/patient/${state.currentPatient.an}/mar/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drug_name: `${drugName} (รอบ ${round})`,
        action: 'GIVEN',
        staff,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      if (btnEl && btnEl.tagName === 'BUTTON') {
        btnEl.style.background = '#dcfce7';
        btnEl.style.color = '#15803d';
        btnEl.style.borderColor = '#86efac';
        btnEl.textContent = '✓ ให้แล้ว';
      }
      showToast(`🔗 บันทึกการให้ยา ${drugName} (${round}) ลง HOSxP เรียบร้อย`);
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function holdMed(drugName) {
  if (!state.currentPatient) return;
  const reason = prompt(`กรุณาระบุเหตุผลการ Hold ยา "${drugName}" (เช่น BP ต่ำ, NPO, คลื่นไส้รุนแรง):`);
  if (!reason) return;
  const staff = state.currentUser?.name || 'พยาบาลประจำตึก';
  try {
    const res = await fetch(`/api/patient/${state.currentPatient.an}/mar/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drug_name: drugName,
        action: 'HOLD',
        reason,
        staff,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      showToast(`🔗 บันทึกการ Hold ยา ${drugName} ลง HOSxP เรียบร้อย`);
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// Tab 12: Discharge Summary & MRA Audit Scorecard
async function loadDchTab(an) {
  const container = document.getElementById('dchContainer');
  const res = await fetch(`/api/patient/${an}/discharge-summary`);
  const json = await res.json();
  if (!json.ok) {
    container.innerHTML = '<div style="padding: 2rem; color: var(--rose);">❌ ไม่สามารถโหลดข้อมูลสรุปจำหน่ายได้</div>';
    return;
  }

  const { patient: p, diagnoses: diags, home_medications: meds, mra_scorecard: mra } = json.data;

  container.innerHTML = `
    <!-- MRA Scorecard Banner -->
    <div style="background: white; border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; margin-bottom: 1rem;">
        <div>
          <h3 style="color: var(--primary-dark); font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
            ⚖️ ตรวจสอบคุณภาพเวชระเบียน (Medical Record Audit Scorecard 2026)
          </h3>
          <span style="font-size: 0.8rem; color: var(--text-muted);">คำนวณตามเกณฑ์ MRA สปสช. / กรมการแพทย์ / D:\\myvale</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 1.5rem; font-weight: 800; color: ${mra.total_score >= 80 ? 'var(--emerald)' : 'var(--amber-text)'};">
            ${mra.total_score} / 100 คะแนน
          </span>
          <span class="badge-tag" style="background: ${mra.is_audit_pass ? 'var(--emerald-light)' : 'var(--amber-light)'}; color: ${mra.is_audit_pass ? 'var(--emerald-text)' : 'var(--amber-text)'}; font-size: 0.9rem; font-weight: 700; padding: 0.4rem 0.8rem;">
            ${mra.is_audit_pass ? '✓ ผ่านเกณฑ์ Audit มาตรฐาน' : '⚠️ ต้องปรับปรุงเพิ่มเติม'}
          </span>
        </div>
      </div>

      <!-- Criteria Breakdown Grid -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
        <div style="background: var(--surface-subtle); padding: 0.65rem; border-radius: var(--radius-md); text-align: center;">
          <div style="color: var(--text-muted);">1. Admission Note (20)</div>
          <strong style="color: var(--primary-dark); font-size: 1.1rem;">${mra.score_admission} / 20</strong>
        </div>
        <div style="background: var(--surface-subtle); padding: 0.65rem; border-radius: var(--radius-md); text-align: center;">
          <div style="color: var(--text-muted);">2. Doctor Progress Note (20)</div>
          <strong style="color: var(--primary-dark); font-size: 1.1rem;">${mra.score_progress} / 20</strong>
        </div>
        <div style="background: var(--surface-subtle); padding: 0.65rem; border-radius: var(--radius-md); text-align: center;">
          <div style="color: var(--text-muted);">3. Doctor Orders (15)</div>
          <strong style="color: var(--primary-dark); font-size: 1.1rem;">${mra.score_orders} / 15</strong>
        </div>
        <div style="background: var(--surface-subtle); padding: 0.65rem; border-radius: var(--radius-md); text-align: center;">
          <div style="color: var(--text-muted);">4. Nurse Record & TPR (20)</div>
          <strong style="color: var(--primary-dark); font-size: 1.1rem;">${mra.score_nurse} / 20</strong>
        </div>
        <div style="background: var(--surface-subtle); padding: 0.65rem; border-radius: var(--radius-md); text-align: center;">
          <div style="color: var(--text-muted);">5. Lab & Imaging (10)</div>
          <strong style="color: var(--primary-dark); font-size: 1.1rem;">${mra.score_investigation} / 10</strong>
        </div>
        <div style="background: var(--surface-subtle); padding: 0.65rem; border-radius: var(--radius-md); text-align: center;">
          <div style="color: var(--text-muted);">6. ICD-10 & Summary (15)</div>
          <strong style="color: var(--primary-dark); font-size: 1.1rem;">${mra.score_diagnosis} / 15</strong>
        </div>
      </div>
    </div>

    <!-- Official Printable Discharge Summary Sheet -->
    <div style="background: white; border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 2rem;" id="printableDchSummary">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--primary); padding-bottom: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h2 style="color: var(--primary-dark); font-size: 1.35rem; margin-bottom: 0.25rem;">📄 ใบสรุปการรักษาพยาบาลผู้ป่วยใน (Inpatient Discharge Summary)</h2>
          <span style="font-size: 0.88rem; color: var(--text-muted);">โรงพยาบาลวานรนิวาส &bull; กลุ่มงานการแพทย์และเวชระเบียน</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="window.print()">🖨️ พิมพ์เอกสาร (Print)</button>
      </div>

      <!-- Patient Header Info Table -->
      <table style="width: 100%; font-size: 0.9rem; margin-bottom: 1.25rem; line-height: 1.8;">
        <tr>
          <td style="width: 50%;"><strong>ชื่อ-สกุล:</strong> ${p.patient_name}</td>
          <td style="width: 25%;"><strong>HN:</strong> ${p.hn}</td>
          <td style="width: 25%;"><strong>AN:</strong> ${p.an}</td>
        </tr>
        <tr>
          <td><strong>เพศ:</strong> ${p.sex === '1' ? 'ชาย' : 'หญิง'} &bull; <strong>อายุ:</strong> ${p.age} ปี</td>
          <td><strong>Admit:</strong> ${new Date(p.regdate).toLocaleDateString('th-TH')}</td>
          <td><strong>Discharge:</strong> ${p.dchdate ? new Date(p.dchdate).toLocaleDateString('th-TH') : 'ยังรักษาตัวอยู่'}</td>
        </tr>
        <tr>
          <td><strong>หอผู้ป่วย:</strong> ${p.ward_name} (เตียง ${p.bedno || '-'})</td>
          <td><strong>ระยะเวลานอน (LOS):</strong> ${p.los_days} วัน</td>
          <td><strong>สิทธิ:</strong> ${p.pttype_name || p.pttype}</td>
        </tr>
      </table>

      <!-- Diagnoses Summary -->
      <h4 style="color: var(--primary-dark); margin-top: 1.25rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.35rem;">
        🩺 การวินิจฉัยโรค (Diagnoses - ICD-10)
      </h4>
      <table class="data-table" style="margin-bottom: 1.25rem;">
        <thead>
          <tr>
            <th style="width: 25%;">ประเภท</th>
            <th style="width: 20%;">ICD-10 Code</th>
            <th>ชื่อโรค / คำอธิบาย</th>
          </tr>
        </thead>
        <tbody>
          ${diags.map(d => `
            <tr>
              <td><strong>${d.diagtype === '1' ? 'Principal Diagnosis (โรคหลัก)' : (d.diagtype === '2' ? 'Comorbidity (โรคร่วม)' : (d.diagtype === '3' ? 'Complication (โรคแทรก)' : 'Other'))}</strong></td>
              <td><strong style="color: var(--primary-dark);">${d.icd10}</strong></td>
              <td>${d.icd_name || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- Home Medication Summary -->
      <h4 style="color: var(--primary-dark); margin-top: 1.25rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.35rem;">
        💊 รายการยากลับบ้าน (Home Medications)
      </h4>
      ${meds.length > 0 ? `
        <table class="data-table">
          <thead>
            <tr>
              <th>ชื่อยา & ความแรง</th>
              <th>จำนวน</th>
              <th>วิธีรับประทาน (Signa)</th>
            </tr>
          </thead>
          <tbody>
            ${meds.map(m => `
              <tr>
                <td><strong>${m.drug_name}</strong> ${m.strength ? `(${m.strength})` : ''}</td>
                <td>${m.qty} ${m.units || ''}</td>
                <td>${m.usage_text || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p style="color: var(--text-muted); font-size: 0.88rem;">ไม่มีรายการยากลับบ้าน</p>'}

      <!-- Signatures Footer -->
      <div style="display: flex; justify-content: space-between; margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); font-size: 0.9rem;">
        <div style="text-align: center; width: 250px;">
          <div>..................................................................</div>
          <div style="margin-top: 0.4rem;">( ${p.doctor_name || 'แพทย์ผู้ให้การรักษา'} )</div>
          <small style="color: var(--text-muted);">แพทย์ผู้สรุปเวชระเบียน</small>
        </div>
        <div style="text-align: center; width: 250px;">
          <div>..................................................................</div>
          <div style="margin-top: 0.4rem;">( พยาบาลหัวหน้าหอผู้ป่วย )</div>
          <small style="color: var(--text-muted);">ผู้ตรวจสอบความสมบูรณ์</small>
        </div>
      </div>
    </div>
  `;
}

// Modal open/handlers for SOAP & PE
function openSoapModal() {
  if (!state.currentPatient) return alert('กรุณาเลือกผู้ป่วยก่อน');
  const docInput = document.getElementById('soapDoctorNameInput');
  if (docInput && state.currentUser?.name) {
    docInput.value = state.currentUser.name;
  } else if (docInput && state.currentPatient?.doctor_name) {
    docInput.value = state.currentPatient.doctor_name;
  }
  const modal = document.getElementById('soapModal');
  if (modal) modal.classList.add('open');
}

async function handleAddSoap(e) {
  e.preventDefault();
  const an = state.currentPatient.an;
  const form = document.getElementById('soapForm');
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.doctor_code = state.currentUser?.doctorcode || state.currentPatient?.doctor_code || '2632';

  try {
    const res = await fetch(`/api/patient/${an}/progress-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.ok) {
      showToast('🔗 บันทึก Doctor SOAP Note และซิงค์เข้าตาราง ipd_doctor_order (HOSxP) เรียบร้อย');
      closeAllModals();
      form.reset();
      loadSoapTab(an);
    } else {
      alert('เกิดข้อผิดพลาด: ' + json.error);
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function openPeModal() {
  if (!state.currentPatient) return alert('กรุณาเลือกผู้ป่วยก่อน');
  const modal = document.getElementById('peModal');
  const d = state.currentPeData || {};

  // Prefill if available
  const formCc = document.getElementById('formPeCc');
  if (formCc) formCc.value = d.cc || d.prediag || '';
  const formHpi = document.getElementById('formPeHpi');
  if (formHpi) formHpi.value = d.hpi || '';
  const formPmh = document.getElementById('formPePmh');
  if (formPmh) formPmh.value = d.pmh || '';

  if (modal) modal.classList.add('open');
}

async function handleAddPe(e) {
  e.preventDefault();
  const an = state.currentPatient.an;
  const form = document.getElementById('peForm');
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await fetch(`/api/patient/${an}/admission-assessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.ok) {
      showToast('🔗 บันทึกผลตรวจร่างกายแรกรับและซิงค์เข้าตาราง opdscreen & ipt (HOSxP) เรียบร้อย');
      closeAllModals();
      loadPeTab(an);
    } else {
      alert('เกิดข้อผิดพลาด: ' + json.error);
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// Tab 8: Lab Results
async function loadLabsTab(an) {
  const container = document.getElementById('labsContainer');
  const res = await fetch(`/api/patient/${an}/labs`);
  const json = await res.json();
  const labs = json.ok ? json.data : [];

  container.innerHTML = `
    <h3 style="color: var(--primary-dark); margin-bottom: 1rem;">🧪 ผลตรวจทางห้องปฏิบัติการ (Laboratory Results)</h3>
    ${labs.length > 0 ? `
      <div style="display: flex; flex-direction: column; gap: 1.25rem;">
        ${labs.map(lh => `
          <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem;">
              <div>
                <strong style="font-size: 1rem; color: var(--primary-dark);">${lh.form_name || 'Lab Order'}</strong>
                <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 0.5rem;">(#${lh.lab_order_number})</span>
              </div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">
                📅 สั่งตรวจ: ${new Date(lh.order_date).toLocaleDateString('th-TH')} ${lh.order_time ? lh.order_time.slice(0, 5) : ''}
              </div>
            </div>

            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>รายการตรวจ (Test Name)</th>
                    <th>ผลตรวจ (Result)</th>
                    <th>ค่าอ้างอิงปกติ (Normal Range)</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  ${lh.items.map(item => `
                    <tr class="${item.critical_result === 'Y' ? 'critical-row' : ''}">
                      <td>${item.lab_items_name_ref}</td>
                      <td>
                        <strong style="color: ${item.abnormal_result === 'Y' ? 'var(--rose)' : 'inherit'}; font-size: 0.95rem;">
                          ${item.lab_order_result || '-'}
                        </strong>
                      </td>
                      <td style="color: var(--text-muted);">${item.lab_items_normal_value_ref || '-'}</td>
                      <td>
                        ${item.abnormal_result === 'Y' ? '<span class="badge-tag" style="background: var(--rose-light); color: var(--rose-text);">Abnormal</span>' : '<span class="badge-tag" style="background: var(--emerald-light); color: var(--emerald-text);">Normal</span>'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        ยังไม่มีรายการผลแล็บสำหรับการนอนโรงพยาบาลนี้
      </div>
    `}
  `;
}

// Tab 6: X-Ray & Imaging Results
async function loadXrayTab(an) {
  const container = document.getElementById('xrayContainer');
  const res = await fetch(`/api/patient/${an}/xrays`);
  const json = await res.json();
  const xrays = json.ok ? json.data : [];

  container.innerHTML = `
    <h3 style="color: var(--primary-dark); margin-bottom: 1rem;">🩻 ผลเอกซเรย์และการตรวจทางรังสี (X-Ray & Imaging)</h3>
    ${xrays.length > 0 ? `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>เลขที่สั่งตรวจ</th>
              <th>รายการเอ็กซเรย์ (X-Ray Study)</th>
              <th>แผนก / จุดสั่ง</th>
              <th>วันที่-เวลาสั่ง</th>
              <th>แพทย์ผู้สั่ง</th>
              <th>ผลการอ่าน / รายงาน (Report)</th>
            </tr>
          </thead>
          <tbody>
            ${xrays.map(x => `
              <tr>
                <td>#${x.xray_order_number}</td>
                <td><strong style="font-size: 0.95rem; color: var(--primary-dark);">${x.xray_list || 'X-Ray'}</strong></td>
                <td>${x.department_name || '-'}</td>
                <td>${x.order_date ? new Date(x.order_date).toLocaleDateString('th-TH') : '-'} ${x.order_time ? x.order_time.slice(0, 5) : ''}</td>
                <td>${x.doctor_name || '-'}</td>
                <td>
                  ${x.result_note ? `
                    <div style="background: #fafafa; padding: 0.5rem; border-radius: 4px; border-left: 3px solid var(--primary); font-size: 0.85rem;">
                      ${x.result_note}
                    </div>
                  ` : `
                    <span class="badge-tag" style="background: var(--surface-subtle); color: var(--text-muted);">
                      ${x.confirm_report === 'Y' ? 'รายงานผลแล้ว' : 'ส่งตรวจ/รอผลอ่านฟิล์ม'}
                    </span>
                  `}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        ยังไม่มีรายการตรวจเอกซเรย์สำหรับผู้ป่วยรายนี้
      </div>
    `}
  `;
}

// Tab 8: Intake / Output Sheet
async function loadIoTab(an) {
  const container = document.getElementById('ioContainer');
  const res = await fetch(`/api/patient/${an}/io`);
  const json = await res.json();
  const records = json.ok ? json.data : [];

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

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <h3 style="color: var(--primary-dark);">💧 บันทึกสารน้ำเข้า-ออก (Fluid Balance - Intake / Output Sheet)</h3>
      <button class="btn btn-primary btn-sm" onclick="openNurseNoteModal()">+ บันทึก I/O</button>
    </div>

    <!-- 24h Summary Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
      <div style="background: var(--primary-light); padding: 1rem; border-radius: var(--radius-lg); border: 1px solid var(--primary-border); text-align: center;">
        <div style="font-size: 0.8rem; color: var(--primary-dark); font-weight: 600;">รวมสารน้ำเข้า (Total Intake)</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary-dark);">${totalIn} ml</div>
        <small style="color: var(--text-muted); font-size: 0.75rem;">Oral ${sumOral} ml | IV ${sumIv} ml</small>
      </div>

      <div style="background: var(--amber-light); padding: 1rem; border-radius: var(--radius-lg); border: 1px solid #fde68a; text-align: center;">
        <div style="font-size: 0.8rem; color: var(--amber-text); font-weight: 600;">รวมสารน้ำออก (Total Output)</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: var(--amber-text);">${totalOut} ml</div>
        <small style="color: var(--text-muted); font-size: 0.75rem;">Urine ${sumUrine} ml | Drain/Emesis ${sumEmesis} ml</small>
      </div>

      <div style="background: ${balance >= 0 ? 'var(--emerald-light)' : 'var(--rose-light)'}; padding: 1rem; border-radius: var(--radius-lg); border: 1px solid ${balance >= 0 ? '#a7f3d0' : '#fecdd3'}; text-align: center;">
        <div style="font-size: 0.8rem; color: ${balance >= 0 ? 'var(--emerald-text)' : 'var(--rose-text)'}; font-weight: 600;">สมดุลสารน้ำ (Fluid Balance)</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: ${balance >= 0 ? 'var(--emerald-text)' : 'var(--rose-text)'};">
          ${balance > 0 ? `+${balance}` : balance} ml
        </div>
        <small style="color: var(--text-muted); font-size: 0.75rem;">${balance >= 0 ? 'Positive Balance' : 'Negative Balance'}</small>
      </div>
    </div>

    ${records.length > 0 ? `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>วัน-เวลา</th>
              <th>ทางปาก (Oral In)</th>
              <th>ทางเส้นเลือด (IV In)</th>
              <th>รวม In</th>
              <th>ปัสสาวะ (Urine Out)</th>
              <th>อาเจียน/สายระบาย</th>
              <th>รวม Out</th>
              <th>ผู้บันทึก</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr>
                <td>${new Date(r.note_date).toLocaleDateString('th-TH')} ${r.note_time ? r.note_time.slice(0, 5) : ''}</td>
                <td>${r.oral_in ? `${r.oral_in} ml` : '-'}</td>
                <td>${r.parenteral_in ? `${r.parenteral_in} ml` : '-'}</td>
                <td><strong>${r.total_in} ml</strong></td>
                <td>${r.urine_out ? `${r.urine_out} ml` : '-'}</td>
                <td>${(Number(r.emesis_out) + Number(r.drainage_out)) ? `${Number(r.emesis_out) + Number(r.drainage_out)} ml` : '-'}</td>
                <td><strong>${r.total_out} ml</strong></td>
                <td>${r.staff || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : `
      <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
        ยังไม่มีรายการบันทึก I/O ในช่วงนี้ <button class="btn btn-secondary btn-sm" onclick="openNurseNoteModal()">+ บันทึก I/O</button>
      </div>
    `}
  `;
}

// Tab 6: Diagnoses (Clean Thai Mapping & Two-Way HOSxP `iptdiag` Sync)
async function loadDiagnosisTab(an) {
  const container = document.getElementById('diagContainer');
  const res = await fetch(`/api/patient/${an}/diagnosis`);
  const json = await res.json();
  const diags = json.ok ? json.data : [];

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
      <div>
        <h3 style="color: var(--primary-dark); display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <span>🩺 การวินิจฉัยโรคและการให้รหัส (ICD-10 Diagnoses)</span>
          <span class="hosxp-sync-pill">🔗 เชื่อมตาราง iptdiag & ipt (HOSxP)</span>
        </h3>
      </div>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button class="btn btn-secondary btn-sm" onclick="openAuditModal()">⚖️ ตรวจสอบเกณฑ์เวชระเบียน (D:\\myvale)</button>
        ${!state.isReadOnlyReview ? `
          <button class="btn btn-primary btn-sm" onclick="openDiagModal()" style="background: linear-gradient(135deg, #0284c7, #0369a1); font-weight: 700;">
            + เพิ่มการวินิจฉัย ICD-10 (Sync HOSxP)
          </button>
        ` : ''}
      </div>
    </div>

    ${diags.length > 0 ? `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>ประเภทการวินิจฉัย</th>
              <th>รหัสโรค (ICD-10)</th>
              <th>คำอธิบาย (Diagnosis Title)</th>
              <th>แพทย์ผู้วินิจฉัย</th>
              <th>เกณฑ์ Audit (D:\\myvale)</th>
              ${!state.isReadOnlyReview ? '<th style="text-align: center;">จัดการ</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${diags.map(d => {
              const guideMatch = findGuideForIcd(d.icd10);
              return `
                <tr>
                  <td><span class="badge-tag" style="background: var(--primary-light); color: var(--primary-dark); font-size: 0.85rem;">${d.diagtype_name}</span></td>
                  <td><strong style="font-size: 1.05rem; color: var(--primary-dark);">${d.icd10}</strong></td>
                  <td>
                    <span style="font-weight: 600;">${d.icd_name || d.diagnosis_note || '-'}</span>
                    ${d.icd_tname ? `<div style="font-size: 0.78rem; color: var(--text-muted);">${d.icd_tname}</div>` : ''}
                  </td>
                  <td>${d.doctor_name || '-'}</td>
                  <td>
                    ${guideMatch ? `
                      <button class="btn btn-secondary btn-sm" onclick="openAuditModal('${guideMatch.id}')">
                        📖 ${guideMatch.title}
                      </button>
                    ` : `
                      <button class="btn btn-secondary btn-sm" onclick="openAuditModal()">
                        📖 ดูเกณฑ์ทั่วไป
                      </button>
                    `}
                  </td>
                  ${!state.isReadOnlyReview ? `
                    <td style="text-align: center;">
                      <button class="btn btn-secondary btn-sm" style="padding: 0.2rem 0.55rem; font-size: 0.75rem; color: var(--rose);" onclick="handleDeleteDiag('${d.ipt_diag_id}', '${d.icd10}')">
                        🗑️ ลบ
                      </button>
                    </td>
                  ` : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted); background: #f8fafc; border-radius: var(--radius-lg); border: 1.5px dashed var(--border);">
        <p style="margin-bottom: 0.85rem;">ยังไม่มีข้อมูลการวินิจฉัย ICD-10 ในระบบ</p>
        ${!state.isReadOnlyReview ? `
          <button class="btn btn-primary btn-sm" onclick="openDiagModal()">+ เพิ่มการวินิจฉัย ICD-10 แรก (ซิงค์เข้า HOSxP)</button>
        ` : ''}
      </div>
    `}
  `;
}

// Helper: match ICD code to relevant D:\myvale guide
function findGuideForIcd(icd) {
  if (!icd) return null;
  const prefix = icd.toUpperCase().slice(0, 3);
  
  if (prefix.startsWith('J')) return { id: '2026_10Pulmonary.md', title: 'Pulmonary / Pneumonia' };
  if (prefix.startsWith('A') || prefix.startsWith('B')) return { id: '2026_01Infection01.md', title: 'Infection / Sepsis' };
  if (prefix.startsWith('I')) return { id: '2026_09Heart.md', title: 'Cardiology / Heart' };
  if (prefix.startsWith('K')) return { id: '2026_11GI1Upper.md', title: 'Gastrointestinal' };
  if (prefix.startsWith('E')) return { id: '2026_05EndoMetabolism.md', title: 'Endocrine & Diabetes' };
  if (prefix.startsWith('S') || prefix.startsWith('T')) return { id: '2026_19Injury.md', title: 'Injury & Trauma' };
  if (prefix.startsWith('M')) return { id: '2026_13Orthopedics.md', title: 'Orthopedics' };
  if (prefix.startsWith('N')) return { id: '2026_14Nephroloy.md', title: 'Nephrology & Renal' };
  if (prefix.startsWith('O')) return { id: '2026_15Obstetrics.md', title: 'Obstetrics' };
  if (prefix.startsWith('G')) return { id: '2026_08BrainStroke.md', title: 'Brain & Stroke' };

  return { id: '2026_00MedicalRecord.md', title: 'Medical Record Concept' };
}

// Open Audit Guide in Modal Dialog (Easy to close)
async function openAuditModal(guideId) {
  const modal = document.getElementById('auditModal');
  const select = document.getElementById('modalGuideSelect');
  if (!modal) return;

  // Populate select options if empty
  if (select && select.children.length === 0 && state.auditGuides.length > 0) {
    select.innerHTML = state.auditGuides.map(g => `<option value="${g.id}">📄 ${g.title} (${g.category})</option>`).join('');
  }

  const targetId = guideId || (state.auditGuides.length > 0 ? state.auditGuides[0].id : '2026_00MedicalRecord.md');
  if (select) select.value = targetId;

  modal.classList.add('open');
  await loadModalGuideContent(targetId);
}

async function loadModalGuideContent(guideId) {
  const contentEl = document.getElementById('modalGuideContent');
  const titleEl = document.getElementById('auditModalTitle');
  if (!contentEl) return;

  contentEl.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">⏳ กำลังโหลดคู่มือ...</div>';

  try {
    const res = await fetch(`/api/audit-guides/${encodeURIComponent(guideId)}`);
    const json = await res.json();
    if (json.ok) {
      if (titleEl) titleEl.textContent = `คู่มือเวชระเบียน: ${json.filename.replace('.md', '')}`;
      contentEl.textContent = json.content;
    } else {
      contentEl.textContent = '❌ ไม่พบข้อมูลคู่มือ';
    }
  } catch (err) {
    contentEl.textContent = '❌ เกิดข้อผิดพลาดในการโหลด: ' + err.message;
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
}

// Tab 7: Clinical & Audit Guide (D:\myvale) Full Tab View
async function loadAuditGuidesList() {
  try {
    const res = await fetch('/api/audit-guides');
    const json = await res.json();
    if (json.ok) {
      state.auditGuides = json.data;
      const modalSelect = document.getElementById('modalGuideSelect');
      if (modalSelect) {
        modalSelect.innerHTML = state.auditGuides.map(g => `<option value="${g.id}">📄 ${g.title} (${g.category})</option>`).join('');
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadAuditGuideTab() {
  const container = document.getElementById('auditContainer');
  if (!state.auditGuides || state.auditGuides.length === 0) {
    await loadAuditGuidesList();
  }

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
      <h3 style="color: var(--primary-dark);">⚖️ เกณฑ์มาตรฐานเวชระเบียน (D:\\myvale)</h3>
      <button class="btn btn-secondary btn-sm" onclick="switchTab('diag')">⬅️ ย้อนกลับไปหน้าวินิจฉัยโรค</button>
    </div>

    <div style="display: grid; grid-template-columns: 300px 1fr; gap: 1.25rem;">
      <!-- Guide Sidebar List -->
      <div style="background: var(--surface-subtle); border-radius: var(--radius-lg); padding: 1rem; max-height: 650px; overflow-y: auto;">
        <h4 style="margin-bottom: 0.5rem; color: var(--text-sub); font-size: 0.9rem;">📚 หมวดโรคและเกณฑ์ Audit (${state.auditGuides.length} หมวด)</h4>
        
        <input type="text" id="guideFilterInput" class="form-control" placeholder="ค้นหาหมวดโรค/เกณฑ์..." style="margin-bottom: 0.75rem; font-size: 0.82rem;" />

        <div style="display: flex; flex-direction: column; gap: 0.35rem;" id="guideListMenu">
          ${renderGuideMenuItems(state.auditGuides)}
        </div>
      </div>

      <!-- Guide Viewer Content -->
      <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; max-height: 650px; overflow-y: auto;" id="guideViewerArea">
        <h4 style="color: var(--primary-dark); margin-bottom: 0.5rem;">คู่มือการบันทึกเวชระเบียนและเกณฑ์การวินิจฉัย (Clinical & Audit Guide)</h4>
        <p style="color: var(--text-muted); font-size: 0.88rem;">เลือกหัวข้อจากเมนูด้านซ้ายเพื่ออ่านเกณฑ์การวินิจฉัย สรุปประวัติ และมาตรฐานการบันทึกชาร์ตผู้ป่วยใน</p>
      </div>
    </div>
  `;

  // Filter input event
  document.getElementById('guideFilterInput').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = state.auditGuides.filter(g => g.title.toLowerCase().includes(q) || g.filename.toLowerCase().includes(q));
    document.getElementById('guideListMenu').innerHTML = renderGuideMenuItems(filtered);
  });

  // Auto load first guide if available
  if (state.auditGuides.length > 0) {
    viewGuideDetail(state.auditGuides[0].id);
  }
}

function renderGuideMenuItems(guides) {
  return guides.map((g) => `
    <button class="btn btn-secondary btn-sm" style="text-align: left; justify-content: flex-start; font-size: 0.82rem; line-height: 1.4; padding: 0.5rem 0.75rem;" onclick="viewGuideDetail('${g.id}')">
      📄 ${g.title}
    </button>
  `).join('');
}

async function viewGuideDetail(guideId) {
  const viewer = document.getElementById('guideViewerArea');
  viewer.innerHTML = '<div style="color: var(--text-muted); padding: 2rem;">⏳ กำลังโหลดคู่มือฉบับสมบูรณ์...</div>';
  try {
    const res = await fetch(`/api/audit-guides/${encodeURIComponent(guideId)}?t=${Date.now()}`);
    const json = await res.json();
    if (json.ok) {
      viewer.innerHTML = `
        <div style="border-bottom: 2px solid var(--border); padding-bottom: 0.75rem; margin-bottom: 1.25rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <h3 style="color: var(--primary-dark); font-size: 1.2rem; margin-bottom: 0.2rem;">📑 ${json.filename.replace('.md', '')}</h3>
            <span class="badge-tag" style="background: var(--primary-light); color: var(--primary-dark);">D:\\myvale Knowledge Base 2026</span>
          </div>
        </div>
        <div style="white-space: pre-wrap; font-family: inherit; font-size: 0.94rem; line-height: 1.8; color: var(--text-main); background: #f8fafc; padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--border);">
${json.content}
        </div>
      `;
    }
  } catch (e) {
    viewer.innerHTML = '❌ ไม่สามารถโหลดคู่มือได้: ' + e.message;
  }
}

// Tab 12: Discharge Summary & MRA Scorecard Tab
async function loadDchTab(an) {
  const container = document.getElementById('dchContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">⏳ กำลังโหลดข้อมูลสรุปการรักษาพยาบาลและ MRA Scorecard...</div>';

  try {
    const res = await fetch(`/api/patient/${an}/discharge-summary`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const d = json.data;
    const sc = d.mra_scorecard || {};

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
        <div>
          <h3 style="color: var(--primary-dark); font-size: 1.15rem; margin-bottom: 0.2rem;">📄 ใบสรุปการรักษาพยาบาลผู้ป่วยใน (Inpatient Discharge Summary)</h3>
          <span style="font-size: 0.82rem; color: var(--text-muted);">สรุปประวัติ วินิจฉัย ยา และเกณฑ์การประเมินคุณภาพเวชระเบียน MRA 2026</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openPrintModal()">🖨️ พิมพ์เอกสาร / ส่งออก PDF</button>
      </div>

      <!-- MRA Scorecard Banner -->
      <div style="background: white; border: 1.5px solid ${sc.is_audit_pass ? 'var(--emerald)' : 'var(--amber)'}; border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 1.3rem;">⚖️</span>
            <strong style="color: var(--primary-dark); font-size: 1rem;">ตรวจสอบคุณภาพเวชระเบียน (Medical Record Audit Scorecard 2026)</strong>
          </div>
          <div>
            <span style="font-size: 1.5rem; font-weight: 700; color: ${sc.is_audit_pass ? 'var(--emerald-text)' : 'var(--amber-text)'};">
              ${sc.total_score || 0} / 100 คะแนน
            </span>
            <span class="badge-tag" style="margin-left: 0.5rem; background: ${sc.is_audit_pass ? 'var(--emerald-light)' : 'var(--amber-light)'}; color: ${sc.is_audit_pass ? 'var(--emerald-text)' : 'var(--amber-text)'};">
              ${sc.is_audit_pass ? '✓ ผ่านเกณฑ์ MRA' : '⚠️ ต้องปรับปรุงเพิ่มเติม'}
            </span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; font-size: 0.82rem;">
          <div style="background: var(--surface-subtle); padding: 0.6rem; border-radius: 6px; text-align: center;">
            <div style="color: var(--text-muted);">1. Admission Note (20)</div>
            <strong style="font-size: 1.1rem; color: var(--primary-dark);">${sc.score_admission || 0} / 20</strong>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.6rem; border-radius: 6px; text-align: center;">
            <div style="color: var(--text-muted);">2. Doctor Progress Note (20)</div>
            <strong style="font-size: 1.1rem; color: var(--primary-dark);">${sc.score_progress || 0} / 20</strong>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.6rem; border-radius: 6px; text-align: center;">
            <div style="color: var(--text-muted);">3. Doctor Orders (15)</div>
            <strong style="font-size: 1.1rem; color: var(--primary-dark);">${sc.score_orders || 0} / 15</strong>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.6rem; border-radius: 6px; text-align: center;">
            <div style="color: var(--text-muted);">4. Nurse Record & TPR (20)</div>
            <strong style="font-size: 1.1rem; color: var(--primary-dark);">${sc.score_nurse || 0} / 20</strong>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.6rem; border-radius: 6px; text-align: center;">
            <div style="color: var(--text-muted);">5. Lab & Imaging (10)</div>
            <strong style="font-size: 1.1rem; color: var(--primary-dark);">${sc.score_investigation || 0} / 10</strong>
          </div>
          <div style="background: var(--surface-subtle); padding: 0.6rem; border-radius: 6px; text-align: center;">
            <div style="color: var(--text-muted);">6. ICD-10 & Summary (15)</div>
            <strong style="font-size: 1.1rem; color: var(--primary-dark);">${sc.score_diagnosis || 0} / 15</strong>
          </div>
        </div>
      </div>

      <!-- Clean Printable Layout Preview Card -->
      <div style="background: white; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h4 style="color: var(--primary-dark); font-size: 1rem;">📄 รายละเอียดสรุปจำหน่ายผู้ป่วย (Discharge Record Preview)</h4>
          <button class="btn btn-secondary btn-sm" onclick="openPrintModal()">🖨️ ดูเอกสารฉบับพิมพ์ A4 & PDF</button>
        </div>
        ${ClinicalDocEngine.generateDischargeSummaryHtml(state.currentPatient, d, state.currentUser)}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="color: var(--rose); padding: 2rem; text-align: center;">❌ ไม่สามารถโหลดข้อมูลสรุปจำหน่ายได้: ${err.message}</div>`;
  }
}

// -------------------------------------------------------------
// 4. Modal Handlers (Add Vitals, Nurse Note, ICD-10, Orders & Clinical Helpers)
// -------------------------------------------------------------
function showToast(message, isError = false) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast-item ${isError ? 'toast-error' : 'toast-success'}`;
  toast.innerHTML = `
    <span style="font-size: 1.15rem;">${isError ? '⚠️' : '✅'}</span>
    <div style="flex: 1; font-weight: 600; font-size: 0.88rem; line-height: 1.35;">${message}</div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3800);
}

function openVitalsModal() {
  if (!state.currentPatient) return alert('กรุณาเลือกผู้ป่วยก่อน');
  const staffInput = elements.vitalsForm?.querySelector('input[name="staff"]');
  if (staffInput && state.currentUser?.name) {
    staffInput.value = state.currentUser.name;
  }
  elements.vitalsModal.classList.add('open');
  updateLiveSosCalculator();
}

async function handleAddVitals(e) {
  e.preventDefault();
  const an = state.currentPatient.an;
  const formData = new FormData(elements.vitalsForm);
  const payload = Object.fromEntries(formData.entries());
  payload.sos_score = calculateSosScoreFromInputs().score;
  payload.news2_score = payload.sos_score;

  try {
    const res = await fetch(`/api/patient/${an}/vitals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      showToast('🔗 บันทึกสัญญาณชีพและซิงค์เข้าตาราง ipd_nurse_note (HOSxP) เรียบร้อย');
      elements.vitalsModal.classList.remove('open');
      elements.vitalsForm.reset();
      switchTab(state.currentTab);
    } else {
      alert('เกิดข้อผิดพลาด: ' + json.error);
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function openNurseNoteModal() {
  if (!state.currentPatient) return alert('กรุณาเลือกผู้ป่วยก่อน');
  const staffInput = document.getElementById('nurseStaffInput');
  if (staffInput && state.currentUser?.name) {
    staffInput.value = state.currentUser.name;
  }
  elements.nurseNoteModal.classList.add('open');
}

async function handleAddNurseNote(e) {
  e.preventDefault();
  const an = state.currentPatient.an;
  const formData = new FormData(elements.nurseNoteForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const res = await fetch(`/api/patient/${an}/nurse-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      showToast('🔗 บันทึก Nurse Focus Note และซิงค์เข้าตาราง ipd_nurse_note (HOSxP) เรียบร้อย');
      elements.nurseNoteModal.classList.remove('open');
      elements.nurseNoteForm.reset();
      switchTab(state.currentTab);
    } else {
      alert('เกิดข้อผิดพลาด: ' + json.error);
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// 1-Tap Quick Templates & Live SOS Calculator
function calculateSosScoreFromInputs() {
  const bt = parseFloat(document.getElementById('inputBt')?.value);
  const pr = parseFloat(document.getElementById('inputPr')?.value);
  const rr = parseFloat(document.getElementById('inputRr')?.value);
  const sbp = parseFloat(document.getElementById('inputSbp')?.value);
  const spo2 = parseFloat(document.getElementById('inputSpo2')?.value);
  const avpu = document.getElementById('inputAvpu')?.value || 'A';

  let score = 0;
  if (!isNaN(bt)) {
    if (bt <= 35.0) score += 2;
    else if (bt <= 36.0) score += 1;
    else if (bt >= 38.5) score += 2;
    else if (bt >= 38.1) score += 1;
  }
  if (!isNaN(pr)) {
    if (pr <= 40 || pr >= 130) score += 3;
    else if (pr >= 111) score += 2;
    else if (pr <= 50 || pr >= 101) score += 1;
  }
  if (!isNaN(rr)) {
    if (rr <= 8 || rr >= 25) score += 3;
    else if (rr >= 21) score += 2;
    else if (rr <= 11) score += 1;
  }
  if (!isNaN(sbp)) {
    if (sbp <= 90 || sbp >= 220) score += 3;
    else if (sbp <= 100) score += 2;
    else if (sbp <= 110) score += 1;
  }
  if (!isNaN(spo2)) {
    if (spo2 <= 91) score += 3;
    else if (spo2 <= 93) score += 2;
    else if (spo2 <= 95) score += 1;
  }
  if (avpu !== 'A') score += 3;

  return { score };
}

function updateLiveSosCalculator() {
  const badge = document.getElementById('liveSosScoreBadge');
  const action = document.getElementById('liveSosAction');
  if (!badge || !action) return;

  const { score } = calculateSosScoreFromInputs();
  if (score >= 5) {
    badge.style.background = '#fee2e2';
    badge.style.color = '#991b1b';
    badge.textContent = `SOS = ${score} (High Risk 🔴)`;
    action.textContent = '⚠️ รายงานแพทย์เวรทันที & ติดตาม V/S ทุก 15-30 นาที';
  } else if (score >= 3) {
    badge.style.background = '#fef3c7';
    badge.style.color = '#b45309';
    badge.textContent = `SOS = ${score} (Medium Risk 🟠)`;
    action.textContent = 'ติดตามสัญญาณชีพซ้ำทุก 1-2 ชั่วโมง และเฝ้าระวังอาการ';
  } else {
    badge.style.background = 'var(--emerald-light)';
    badge.style.color = 'var(--emerald-text)';
    badge.textContent = `SOS = ${score} (Low Risk 🟢)`;
    action.textContent = 'ติดตามสัญญาณชีพตามรอบปกติ (ทุก 4 ชั่วโมง)';
  }
}

function initLiveSosCalculator() {
  ['inputBt', 'inputPr', 'inputRr', 'inputSbp', 'inputSpo2', 'inputAvpu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateLiveSosCalculator);
      el.addEventListener('change', updateLiveSosCalculator);
    }
  });
}

function applyNurseTemplate(type) {
  const ta = document.getElementById('nurseNoteTextarea');
  if (!ta) return;
  const templates = {
    admit: `F: รับใหม่ผู้ป่วยใน (Admission Nursing Assessment)\nD: ผู้ป่วยรู้สึกตัวดี มาจากห้องฉุกเฉิน/OPD ด้วยอาการสำคัญ ${state.currentPatient?.prediag || '-'}\nA: ปฐมนิเทศหอผู้ป่วย ประเมินสัญญาณชีพแรกรับ ดูแลความสุขสบายและบริหารยาตามแผนการรักษาของแพทย์\nR: ผู้ป่วยและญาติเข้าใจระเบียบหอผู้ป่วย สัญญาณชีพคงที่`,
    routine: `F: ติดตามอาการทั่วไปและเฝ้าระวังภาวะแทรกซ้อน\nD: ผู้ป่วยรู้สึกตัวดี พักผ่อนได้บนเตียง ไม่มีไข้ ไม่หอบเหนื่อย รับประทานอาหารได้ดี\nA: วัดสัญญาณชีพตามรอบ ดูแลให้ได้รับยารับประทานและสารน้ำตามแผนการรักษา แนะนำการสังเกตอาการผิดปกติ\nR: สัญญาณชีพอยู่ในเกณฑ์ปกติ ไม่มีอาการแทรกซ้อน`,
    fever: `F: ภาวะอุณหภูมิร่างกายสูง (Hyperthermia / Fever)\nD: ผู้ป่วยตัวร้อน วัดอุณหภูมิร่างกายมีไข้ มีอาการอ่อนเพลีย\nA: ดูแลเช็ดตัวลดไข้ (Tepid sponge) กระตุ้นให้จิบน้ำมากๆ ให้ยาลดไข้ตามแผนการรักษาของแพทย์\nR: หลังเช็ดตัวและให้ยา 30-60 นาที อุณหภูมิร่างกายลดลง ผู้ป่วยสุขสบายขึ้น`,
    pain: `F: ความไม่สุขสบายจากอาการปวด (Acute Pain Management)\nD: ผู้ป่วยบ่นปวด ประเมิน Pain Score = 5/10 สีหน้าอ่อนเพลีย\nA: จัดท่าให้สุขสบาย แนะนำเทคนิคการหายใจผ่อนคลาย และดูแลให้ยาแก้ปวดตามแผนการรักษา\nR: หลังให้การพยาบาล 30 นาที อาการปวดทุเลาลง Pain Score ลดลงเหลือ 2/10 พักหลับได้`,
    dch: `F: การวางแผนจำหน่ายและการดูแลต่อเนื่องที่บ้าน (Discharge Planning - D-METHOD)\nD: แพทย์อนุญาตให้กลับบ้านได้ ผู้ป่วยรู้สึกตัวดี สัญญาณชีพปกติ\nA: แนะนำการใช้ยากลับบ้านอย่างถูกต้อง การสังเกตอาการผิดปกติที่ต้องมาพบแพทย์ก่อนนัด และส่งมอบใบนัด\nR: ผู้ป่วยและญาติเข้าใจวิธีการรับประทานยาและการปฏิบัติตัว จำหน่ายกลับบ้านอย่างปลอดภัย`,
  };
  ta.value = templates[type] || '';
  ta.focus();
}

function applySoapTemplate(type) {
  const sEl = document.getElementById('soapInputS');
  const oEl = document.getElementById('soapInputO');
  const aEl = document.getElementById('soapInputA');
  const pEl = document.getElementById('soapInputP');
  const diagText = state.currentPatient?.prediag || 'Primary condition';

  if (type === 'improving') {
    if (sEl) sEl.value = 'อาการทั่วไปดีขึ้น ไม่มีไข้ ไอลดลง ไม่หอบเหนื่อย รับประทานอาหารได้มากขึ้น นอนหลับพักผ่อนได้';
    if (oEl && !oEl.value) oEl.value = 'GA: Good consciousness, not pale, no dyspnea. Heart: normal S1S2. Lungs: clearer breath sounds.';
    if (aEl) aEl.value = `${diagText} - Clinical improving`;
    if (pEl) pEl.value = 'Continue current medications and supportive care. Observe clinical & vital signs.';
  } else if (type === 'stable') {
    if (sEl) sEl.value = 'อาการคงที่ ไม่มีอาการแทรกซ้อนใหม่ ยังมีอาการอ่อนเพลียเล็กน้อย พอรับประทานอาหารได้';
    if (oEl && !oEl.value) oEl.value = 'GA: Alert, vital signs stable, no acute distress. Abdomen: soft, not tender.';
    if (aEl) aEl.value = `${diagText} - Stable condition`;
    if (pEl) pEl.value = 'Continue current treatment plan. Follow up clinical response.';
  } else if (type === 'dch') {
    if (sEl) sEl.value = 'อาการดีขึ้นมาก ไม่มีไข้เกิน 24 ชั่วโมง ช่วยเหลือตัวเองได้ดี ไม่มีอาการผิดปกติ';
    if (oEl && !oEl.value) oEl.value = 'GA: Good consciousness, afebrile, vital signs stable. Physical exam: unremarkable.';
    if (aEl) aEl.value = `${diagText} - Improved and fit for discharge`;
    if (pEl) pEl.value = 'Discharge today. Prescribe home medications and schedule OPD follow-up.';
  }
}

async function pullLatestVitalsToSoap() {
  if (!state.currentPatient) return;
  const oEl = document.getElementById('soapInputO');
  if (!oEl) return;
  try {
    const res = await fetch(`/api/patient/${state.currentPatient.an}/vitals`);
    const json = await res.json();
    const list = json.ok ? json.data : [];
    if (list.length === 0) {
      showToast('ยังไม่มีข้อมูลสัญญาณชีพในระบบ', true);
      return;
    }
    const v = list[list.length - 1];
    const vsLine = `V/S: BT ${v.temperature || '-'} °C, PR ${v.pulse || '-'} bpm, RR ${v.respiratory_rate || '-'} /min, BP ${v.bp_systolic || '-'}/${v.bp_diastolic || '-'} mmHg, SpO2 ${v.spo2_ra || v.spo2_o2 || '-'}%`;
    oEl.value = oEl.value ? `${vsLine}\n${oEl.value}` : `${vsLine}\nGA: Good consciousness, no acute distress.`;
    showToast('💓 ดึงสัญญาณชีพล่าสุดใส่ช่อง O: Objective เรียบร้อย');
  } catch (e) {
    showToast('ไม่สามารถดึงสัญญาณชีพได้', true);
  }
}

function fillNormalPeAllSystems() {
  const form = document.getElementById('peForm');
  if (!form) return;
  const defaults = {
    pe_ga: 'Good consciousness, alert, not pale, no jaundice, no acute distress',
    pe_heent: 'Not pale conjunctivae, anicteric sclerae, pharynx not injected, no cervical lymphadenopathy',
    pe_heart: 'Normal S1 S2, regular rhythm, no murmur',
    pe_lung: 'Clear breath sounds both lungs, equal air entry, no adventitious sound',
    pe_ab: 'Soft, not tender, no guarding, no hepatosplenomegaly, normoactive bowel sounds',
    pe_ext: 'No pitting edema, no cyanosis, peripheral pulses 2+ all extremities',
    pe_neuro: 'E4V5M6 (GCS 15), pupils 3 mm RTLBE, motor power grade V all extremities, no focal neuro deficit',
  };
  Object.entries(defaults).forEach(([name, val]) => {
    const input = form.querySelector(`input[name="${name}"]`);
    if (input) input.value = val;
  });
  showToast('✨ กรอกค่าตรวจร่างกายปกติครบทั้ง 7 ระบบเรียบร้อย');
}

// ICD-10 Diagnosis & Doctor Order Modals (Two-Way HOSxP Sync)
function openDiagModal() {
  if (!state.currentPatient) return alert('กรุณาเลือกผู้ป่วยก่อน');
  const form = document.getElementById('diagForm');
  if (form) form.reset();
  const resBox = document.getElementById('icdSearchResults');
  if (resBox) resBox.style.display = 'none';
  document.getElementById('diagModal')?.classList.add('open');
}

function selectQuickIcd(code, title) {
  const codeEl = document.getElementById('diagIcdCodeInput');
  const noteEl = document.getElementById('diagNoteInput');
  const resBox = document.getElementById('icdSearchResults');
  if (codeEl) codeEl.value = code;
  if (noteEl) noteEl.value = title;
  if (resBox) resBox.style.display = 'none';
}

async function handleAddDiag(e) {
  e.preventDefault();
  if (!state.currentPatient) return;
  const an = state.currentPatient.an;
  const form = document.getElementById('diagForm');
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.doctor_code = state.currentUser?.doctorcode || state.currentPatient?.doctor_code || '2632';
  payload.staff = state.currentUser?.loginname || state.currentUser?.name || 'PAPERLESS';

  try {
    const res = await fetch(`/api/patient/${an}/diagnosis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      showToast(`🔗 ${json.message}`);
      closeAllModals();
      loadDiagnosisTab(an);
    } else {
      alert('❌ ' + (json.error || 'เกิดข้อผิดพลาด'));
    }
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

async function handleDeleteDiag(iptDiagId, icdCode) {
  if (!state.currentPatient || !iptDiagId) return;
  if (!confirm(`ยืนยันการลบรหัสวินิจฉัย ${icdCode} ออกจากตาราง iptdiag ใน HOSxP?`)) return;
  const an = state.currentPatient.an;
  try {
    const res = await fetch(`/api/patient/${an}/diagnosis/${iptDiagId}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (json.ok) {
      showToast(`🔗 ลบรหัสวินิจฉัย ${icdCode} จาก HOSxP เรียบร้อย`);
      loadDiagnosisTab(an);
    } else {
      alert('❌ ' + (json.error || 'ลบไม่สำเร็จ'));
    }
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function openOrderModal() {
  if (!state.currentPatient) return alert('กรุณาเลือกผู้ป่วยก่อน');
  const form = document.getElementById('orderForm');
  if (form) form.reset();
  const icodeEl = document.getElementById('selectedDrugIcode');
  if (icodeEl) icodeEl.value = '';
  const resBox = document.getElementById('drugSearchResults');
  if (resBox) resBox.style.display = 'none';
  document.getElementById('orderModal')?.classList.add('open');
}

function setOrderUsage(text) {
  const input = document.getElementById('orderUsageInput');
  if (input) input.value = text;
}

async function handleAddOrder(e) {
  e.preventDefault();
  if (!state.currentPatient) return;
  const an = state.currentPatient.an;
  const form = document.getElementById('orderForm');
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (!payload.icode) {
    alert('กรุณาค้นหาและคลิกเลือกรายการยาหรือเวชภัณฑ์จากรายการค้นหาก่อนบันทึก');
    return;
  }

  payload.doctor_code = state.currentUser?.doctorcode || state.currentPatient?.doctor_code || '2632';
  payload.staff = state.currentUser?.loginname || state.currentUser?.name || 'PAPERLESS';

  try {
    const res = await fetch(`/api/patient/${an}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      showToast(`🔗 ${json.message}`);
      closeAllModals();
      loadOrdersTab(an);
    } else {
      alert('❌ ' + (json.error || 'เกิดข้อผิดพลาด'));
    }
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

async function handleOffOrder(medPlanNumber, itemName) {
  if (!state.currentPatient || !medPlanNumber) return;
  if (!confirm(`ยืนยันการสั่งหยุดยา (Off Order): "${itemName}" ในระบบ HOSxP?`)) return;
  const an = state.currentPatient.an;
  try {
    const res = await fetch(`/api/patient/${an}/orders/${medPlanNumber}/off`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff: state.currentUser?.loginname || 'PAPERLESS' }),
    });
    const json = await res.json();
    if (json.ok) {
      showToast(`🔗 สั่งหยุดยา ${itemName} ในตาราง medplan_ipd (HOSxP) เรียบร้อย`);
      loadOrdersTab(an);
    }
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

function initIcdAndDrugAutocomplete() {
  // 1. ICD-10 Live Search
  const icdInput = document.getElementById('icdSearchInput');
  const icdResults = document.getElementById('icdSearchResults');
  if (icdInput && icdResults) {
    let icdTimer;
    icdInput.addEventListener('input', (e) => {
      clearTimeout(icdTimer);
      const q = e.target.value.trim();
      if (q.length < 2) {
        icdResults.style.display = 'none';
        return;
      }
      icdTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search-icd10?q=${encodeURIComponent(q)}`);
          const json = await res.json();
          const list = json.ok ? json.data : [];
          if (list.length === 0) {
            icdResults.innerHTML = '<div style="padding: 0.75rem; color: var(--text-muted); font-size: 0.85rem;">ไม่พบรหัสโรคที่ค้นหา</div>';
          } else {
            icdResults.innerHTML = list.map(item => `
              <div class="autocomplete-item" onclick="selectQuickIcd('${item.code}', '${(item.name || '').replace(/'/g, "\\'")}')">
                <strong style="color: #0284c7; font-size: 0.92rem; min-width: 55px; display: inline-block;">${item.code}</strong>
                <span style="font-weight: 600; color: #0f172a;">${item.name || ''}</span>
                ${item.tname ? `<div style="font-size: 0.78rem; color: #64748b; margin-left: 55px;">${item.tname}</div>` : ''}
              </div>
            `).join('');
          }
          icdResults.style.display = 'block';
        } catch (err) {
          console.error(err);
        }
      }, 250);
    });
  }

  // 2. Drug & Non-Drug Live Search
  const drugInput = document.getElementById('drugSearchInput');
  const drugResults = document.getElementById('drugSearchResults');
  if (drugInput && drugResults) {
    let drugTimer;
    drugInput.addEventListener('input', (e) => {
      clearTimeout(drugTimer);
      const q = e.target.value.trim();
      if (q.length < 2) {
        drugResults.style.display = 'none';
        return;
      }
      drugTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/search-drugs?q=${encodeURIComponent(q)}`);
          const json = await res.json();
          const list = json.ok ? json.data : [];
          if (list.length === 0) {
            drugResults.innerHTML = '<div style="padding: 0.75rem; color: var(--text-muted); font-size: 0.85rem;">ไม่พบรายการยาหรือเวชภัณฑ์</div>';
          } else {
            drugResults.innerHTML = list.map(item => `
              <div class="autocomplete-item" onclick="selectDrugItem('${item.icode}', '${(item.name || '').replace(/'/g, "\\'")}', '${(item.strength || '').replace(/'/g, "\\'")}', '${(item.units || '').replace(/'/g, "\\'")}')">
                <span class="badge-tag" style="background: ${item.item_type === 'DRUG' ? '#e0f2fe; color: #0369a1;' : '#f3e8ff; color: #7e22ce;'} font-size: 0.7rem; margin-right: 0.4rem;">
                  ${item.item_type === 'DRUG' ? '💊 ยา' : '🔬 บริการ'}
                </span>
                <strong style="color: #0f172a;">${item.name}</strong>
                ${item.strength ? `<span style="color: #64748b; font-size: 0.82rem;"> (${item.strength})</span>` : ''}
                <span style="color: #0284c7; font-size: 0.78rem; float: right;">${item.units || ''}</span>
              </div>
            `).join('');
          }
          drugResults.style.display = 'block';
        } catch (err) {
          console.error(err);
        }
      }, 250);
    });
  }
}

function selectDrugItem(icode, name, strength, units) {
  const drugInput = document.getElementById('drugSearchInput');
  const icodeInput = document.getElementById('selectedDrugIcode');
  const resBox = document.getElementById('drugSearchResults');
  if (drugInput) drugInput.value = `${name}${strength ? ` (${strength})` : ''}${units ? ` [${units}]` : ''}`;
  if (icodeInput) icodeInput.value = icode;
  if (resBox) resBox.style.display = 'none';
}

// -------------------------------------------------------------
// 10. Print & PDF Export System
// -------------------------------------------------------------
async function openPrintModal() {
  if (!state.currentPatient) return alert('กรุณาเลือกผู้ป่วยก่อน');
  const printModal = document.getElementById('printModal');
  if (!printModal) return;
  
  printModal.classList.add('open');
  await renderPrintDocumentPreview();
}

async function renderPrintDocumentPreview() {
  if (!state.currentPatient) return;
  const p = state.currentPatient;
  const docType = document.getElementById('printDocTypeSelect')?.value || 'dch';
  const previewEl = document.getElementById('printPaperPreview');
  if (!previewEl) return;

  previewEl.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;">⏳ กำลังโหลดและสร้างเอกสารมาตรฐาน A4...</div>';

  try {
    let data = {};
    if (docType === 'dch') {
      const res = await fetch(`/api/patient/${p.an}/discharge-summary`);
      const json = await res.json();
      data = json.ok ? json.data : {};
    } else if (docType === 'orders') {
      const res = await fetch(`/api/patient/${p.an}/orders`);
      const json = await res.json();
      data = json.ok ? (json.orders || json.data || []) : [];
    } else if (docType === 'nurse') {
      const res = await fetch(`/api/patient/${p.an}/nurse-notes`);
      const json = await res.json();
      data = json.ok ? (json.data || []) : [];
    } else if (docType === 'pe') {
      const res = await fetch(`/api/patient/${p.an}/admission-assessment`);
      const json = await res.json();
      data = json.ok ? (json.data || {}) : {};
    } else if (docType === 'io') {
      const res = await fetch(`/api/patient/${p.an}/io`);
      const json = await res.json();
      data = json.ok ? (json.data || []) : [];
    }

    previewEl.innerHTML = ClinicalDocEngine.generateHtml(docType, p, data, state.currentUser);
  } catch (err) {
    previewEl.innerHTML = `<div style="color: red; padding: 2rem;">เกิดข้อผิดพลาดในการโหลดเอกสาร: ${err.message}</div>`;
  }
}

async function handleDownloadPdf() {
  const previewEl = document.getElementById('printPaperPreview');
  if (!previewEl || !state.currentPatient) return;
  const p = state.currentPatient;
  const docType = document.getElementById('printDocTypeSelect')?.value || 'doc';

  const downloadBtn = document.getElementById('downloadPdfBtn');
  const oldText = downloadBtn.textContent;
  downloadBtn.textContent = '⏳ กำลังแปลงเป็น PDF...';
  downloadBtn.disabled = true;

  try {
    await ClinicalDocEngine.downloadPdf(previewEl, p, docType);
  } catch (err) {
    console.error('PDF export failed:', err);
    executePrintDocument();
  } finally {
    downloadBtn.textContent = oldText;
    downloadBtn.disabled = false;
  }
}

function executePrintDocument() {
  const content = document.getElementById('printPaperPreview')?.innerHTML;
  if (!content || !state.currentPatient) return;

  if (state.currentPatient) {
    // Auto-save & lock snapshot on print
    try {
      const ap = state.currentPatient.approval || {};
      fetch('/api/discharge-approval/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          an: state.currentPatient.an,
          hn: state.currentPatient.hn,
          is_first_print: true,
          printed_by: state.currentUser?.name || 'เจ้าหน้าที่',
          assigned_doctor_code: ap.assigned_doctor_code || state.currentPatient.doctor_code || '',
          assigned_doctor_name: ap.assigned_doctor_name || state.currentPatient.doctor_name || '',
          assigned_nurse_name: ap.assigned_nurse_name || state.currentUser?.name || 'พยาบาลผู้ตรวจ',
          assigned_nurse_login: ap.assigned_nurse_login || state.currentUser?.loginname || '',
        }),
      }).catch(err => console.error('Snapshot save error:', err));
    } catch (e) {
      console.error('Print auto-lock error:', e);
    }
  }

  ClinicalDocEngine.print(content, state.currentPatient);
}

// Backward-compatibility aliases (routed through ClinicalDocEngine)
const generateDischargeSummaryHtml = (p, d) => ClinicalDocEngine.generateDischargeSummaryHtml(p, d, state.currentUser);
const generateOrdersSheetHtml = (p, o) => ClinicalDocEngine.generateOrdersSheetHtml(p, o, state.currentUser);
const generateNurseNotesSheetHtml = (p, n) => ClinicalDocEngine.generateNurseNotesSheetHtml(p, n, state.currentUser);
const generateAdmissionPeSheetHtml = (p, pe) => ClinicalDocEngine.generateAdmissionPeSheetHtml(p, pe, state.currentUser);
const generateIoSheetHtml = (p, r) => ClinicalDocEngine.generateIoSheetHtml(p, r);
const renderSignatureStamp = (role, def, sub) => ClinicalDocEngine.renderSignatureStamp(role, def, sub, state.currentPatient, state.currentUser);

// -------------------------------------------------------------
// 11. Authentication & Digital Signature Management
// -------------------------------------------------------------
let sigCanvas = null;
let sigCtx = null;
let isDrawing = false;
let sigInkColor = '#002b80';

function initAuth() {
  state.currentUser = JSON.parse(localStorage.getItem('ipd_user') || 'null');
  updateAuthUI();

  if (!state.currentUser) {
    showLoginView();
  } else {
    showWardView();
  }

  // Main login form on view 0
  const mainLoginForm = document.getElementById('mainLoginForm');
  if (mainLoginForm) {
    mainLoginForm.addEventListener('submit', handleMainLogin);
  }

  // Toggle Password Visibility Eye Button
  const togglePassBtn = document.getElementById('toggleMainPassBtn');
  if (togglePassBtn) {
    togglePassBtn.addEventListener('click', () => {
      const passInput = document.getElementById('mainLoginPassword');
      if (passInput) {
        const isPass = passInput.type === 'password';
        passInput.type = isPass ? 'text' : 'password';
        togglePassBtn.textContent = isPass ? '🙈' : '👁️';
      }
    });
  }

  // Login button opens modal or view
  const openLoginBtn = document.getElementById('openLoginBtn');
  if (openLoginBtn) {
    openLoginBtn.addEventListener('click', () => {
      showLoginView();
      const alertBox = document.getElementById('loginAlertBox');
      if (alertBox) alertBox.style.display = 'none';
      document.getElementById('loginModal')?.classList.add('open');
    });
  }

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('คุณต้องการออกจากระบบหรือไม่?')) {
        state.currentUser = null;
        localStorage.removeItem('ipd_user');
        updateAuthUI();
        showLoginView();
      }
    });
  }

  // Signature modal opener
  const openSigBtn = document.getElementById('openSignatureBtn');
  if (openSigBtn) {
    openSigBtn.addEventListener('click', openSignatureModal);
  }

  // Doctor Filter Buttons (All Cases vs My Cases)
  const filterMyCasesBtn = document.getElementById('filterMyCasesBtn');
  const filterAllCasesBtn = document.getElementById('filterAllCasesBtn');
  if (filterMyCasesBtn) {
    filterMyCasesBtn.addEventListener('click', () => {
      state.doctorFilter = 'my';
      updateDoctorFilterButtons();
      renderBedGrid();
    });
  }
  if (filterAllCasesBtn) {
    filterAllCasesBtn.addEventListener('click', () => {
      state.doctorFilter = 'all';
      updateDoctorFilterButtons();
      renderBedGrid();
    });
  }

  // Login form submission (modal)
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
}

function updateDoctorFilterButtons() {
  const filterMyCasesBtn = document.getElementById('filterMyCasesBtn');
  const filterAllCasesBtn = document.getElementById('filterAllCasesBtn');

  if (filterMyCasesBtn && filterAllCasesBtn) {
    if (state.doctorFilter === 'my') {
      filterMyCasesBtn.style.background = '#0284c7';
      filterMyCasesBtn.style.color = '#ffffff';
      filterMyCasesBtn.style.fontWeight = '600';
      filterMyCasesBtn.style.border = 'none';

      filterAllCasesBtn.style.background = '#f1f5f9';
      filterAllCasesBtn.style.color = 'var(--text-sub)';
      filterAllCasesBtn.style.fontWeight = '500';
      filterAllCasesBtn.style.border = '1px solid var(--border)';
    } else {
      filterAllCasesBtn.style.background = '#0284c7';
      filterAllCasesBtn.style.color = '#ffffff';
      filterAllCasesBtn.style.fontWeight = '600';
      filterAllCasesBtn.style.border = 'none';

      filterMyCasesBtn.style.background = '#f1f5f9';
      filterMyCasesBtn.style.color = 'var(--text-sub)';
      filterMyCasesBtn.style.fontWeight = '500';
      filterMyCasesBtn.style.border = '1px solid var(--border)';
    }
  }
}

function updateAuthUI() {
  const openLoginBtn = document.getElementById('openLoginBtn');
  const loggedInBox = document.getElementById('loggedInBox');
  const userDisplayName = document.getElementById('userDisplayName');
  const userRoleLabel = document.getElementById('userRoleLabel');
  const userRoleIcon = document.getElementById('userRoleIcon');
  const openAdminBtn = document.getElementById('openAdminUsersBtn');
  const docCaseFilter = document.getElementById('doctorCaseFilterGroup');

  if (state.currentUser) {
    if (openLoginBtn) openLoginBtn.style.display = 'none';
    if (loggedInBox) loggedInBox.style.display = 'flex';
    if (userDisplayName) userDisplayName.textContent = state.currentUser.name;
    
    let roleText = state.currentUser.groupname || 'เจ้าหน้าที่';
    if (state.currentUser.licenseno) roleText += ` (ว. ${state.currentUser.licenseno})`;
    if (userRoleLabel) userRoleLabel.textContent = roleText;

    if (userRoleIcon) {
      userRoleIcon.textContent = state.currentUser.is_admin ? '👑' : (state.currentUser.is_doctor ? '👨‍⚕️' : (state.currentUser.is_nurse ? '👩‍⚕️' : '👤'));
    }

    if (openAdminBtn) {
      openAdminBtn.style.display = state.currentUser.is_admin ? 'inline-flex' : 'none';
    }

    if (docCaseFilter) {
      const isDoctor = state.currentUser.is_doctor || !!state.currentUser.doctorcode;
      docCaseFilter.style.display = isDoctor ? 'flex' : 'none';
      state.doctorFilter = 'all'; // DEFAULT TO ALL CASES
      updateDoctorFilterButtons();
    }
  } else {
    if (openLoginBtn) openLoginBtn.style.display = 'flex';
    if (loggedInBox) loggedInBox.style.display = 'none';
    if (openAdminBtn) openAdminBtn.style.display = 'none';
    if (docCaseFilter) docCaseFilter.style.display = 'none';
  }
}

async function handleMainLogin(e) {
  e.preventDefault();
  const username = document.getElementById('mainLoginUsername')?.value.trim();
  const password = document.getElementById('mainLoginPassword')?.value.trim();
  const alertBox = document.getElementById('mainLoginAlert');
  const submitBtn = document.getElementById('mainLoginSubmitBtn');

  if (!username) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ กำลังตรวจสอบกับ HOSxP...';
  }
  if (alertBox) alertBox.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (json.ok) {
      state.currentUser = json.user;
      localStorage.setItem('ipd_user', JSON.stringify(state.currentUser));
      updateAuthUI();
      document.getElementById('mainLoginForm')?.reset();
      showWardView();

      // Load full hospital data upon successful login
      await loadWards();
      await loadPatients();
      await loadAuditGuidesList();
    } else {
      if (alertBox) {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fee2e2';
        alertBox.style.color = '#991b1b';
        alertBox.style.border = '1px solid #f87171';
        alertBox.innerHTML = `⚠️ ${json.error}`;
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fee2e2';
      alertBox.style.color = '#991b1b';
      alertBox.style.border = '1px solid #f87171';
      alertBox.innerHTML = `⚠️ ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ${err.message}`;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '🔑 เข้าสู่ระบบ IPD Paperless ➔';
    }
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsernameInput')?.value.trim();
  const password = document.getElementById('loginPasswordInput')?.value.trim();
  const alertBox = document.getElementById('loginAlertBox');
  const submitBtn = document.getElementById('submitLoginBtn');

  if (!username) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ กำลังตรวจสอบ...';
  }
  if (alertBox) alertBox.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (json.ok) {
      state.currentUser = json.user;
      localStorage.setItem('ipd_user', JSON.stringify(state.currentUser));
      updateAuthUI();
      document.getElementById('loginModal')?.classList.remove('open');
      document.getElementById('loginForm')?.reset();
      showWardView();

      // Load full hospital data upon successful login
      await loadWards();
      await loadPatients();
      await loadAuditGuidesList();
    } else {
      if (alertBox) {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fee2e2';
        alertBox.style.color = '#991b1b';
        alertBox.style.border = '1px solid #f87171';
        alertBox.innerHTML = `⚠️ ${json.error}`;
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fee2e2';
      alertBox.style.color = '#991b1b';
      alertBox.style.border = '1px solid #f87171';
      alertBox.innerHTML = `⚠️ ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: ${err.message}`;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'เข้าสู่ระบบ ➔';
    }
  }
}

// -------------------------------------------------------------
// 12. Admin User Management & Password Reset
// -------------------------------------------------------------
let allAdminUsers = [];
let currentResetTarget = null;

function initAdminUsers() {
  const openAdminBtn = document.getElementById('openAdminUsersBtn');
  if (openAdminBtn) {
    openAdminBtn.addEventListener('click', openAdminUserModal);
  }

  const searchInput = document.getElementById('adminUserSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterAdminUsers(e.target.value);
    });
  }

  const resetPassForm = document.getElementById('resetPasswordForm');
  if (resetPassForm) {
    resetPassForm.addEventListener('submit', handleAdminResetPassword);
  }
}

async function openAdminUserModal() {
  if (!state.currentUser || !state.currentUser.is_admin) {
    alert('คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (เฉพาะผู้ดูแลระบบ)');
    return;
  }

  document.getElementById('adminUserModal')?.classList.add('open');
  const tbody = document.getElementById('adminUserTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">⏳ กำลังโหลดรายชื่อผู้ใช้งานทั้งหมด...</td></tr>';

  try {
    const res = await fetch('/api/admin/users');
    const json = await res.json();
    if (json.ok) {
      allAdminUsers = json.data;
      renderAdminUsers(allAdminUsers);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red; padding: 1rem;">❌ เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

function renderAdminUsers(users) {
  const tbody = document.getElementById('adminUserTableBody');
  const countLabel = document.getElementById('adminUserCountLabel');
  if (countLabel) countLabel.textContent = users.length;

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">ไม่พบข้อมูลผู้ใช้งานที่ค้นหา</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 0.6rem 0.75rem; font-weight: 700; font-family: monospace; color: var(--primary-dark);">${u.loginname}</td>
      <td style="padding: 0.6rem 0.75rem; font-weight: 600;">${u.name || '-'}</td>
      <td style="padding: 0.6rem 0.75rem;">
        <span class="badge-tag" style="background: ${u.groupname === 'ผู้ดูแลระบบ' ? '#fef3c7; color: #b45309;' : (u.groupname === 'แพทย์' ? '#e0f2fe; color: #0284c7;' : '#f1f5f9; color: #475569;')} font-size: 0.78rem;">
          ${u.groupname || 'ทั่วไป'}
        </span>
      </td>
      <td style="padding: 0.6rem 0.75rem; font-size: 0.82rem; color: var(--text-muted);">${u.department || '-'}</td>
      <td style="padding: 0.6rem 0.75rem; font-size: 0.82rem;">${u.licenseno ? `ว. ${u.licenseno}` : (u.doctorcode || '-')}</td>
      <td style="padding: 0.6rem 0.75rem; text-align: center;">
        <button class="btn btn-secondary btn-sm" style="padding: 0.25rem 0.6rem; font-size: 0.78rem; background: #fffbeb; color: #b45309; border: 1px solid #fde68a;" onclick="promptResetPassword('${u.loginname}', '${(u.name || u.loginname).replace(/'/g, "\\'")}')">
          🔑 รีเซ็ตรหัสผ่าน
        </button>
      </td>
    </tr>
  `).join('');
}

function filterAdminUsers(q) {
  const queryStr = q.toLowerCase().trim();
  if (!queryStr) {
    renderAdminUsers(allAdminUsers);
    return;
  }
  const filtered = allAdminUsers.filter(u => 
    (u.loginname && u.loginname.toLowerCase().includes(queryStr)) ||
    (u.name && u.name.toLowerCase().includes(queryStr)) ||
    (u.groupname && u.groupname.toLowerCase().includes(queryStr)) ||
    (u.department && u.department.toLowerCase().includes(queryStr)) ||
    (u.doctorcode && u.doctorcode.toLowerCase().includes(queryStr)) ||
    (u.licenseno && u.licenseno.toLowerCase().includes(queryStr))
  );
  renderAdminUsers(filtered);
}

function promptResetPassword(loginname, name) {
  currentResetTarget = { loginname, name };
  const targetName = document.getElementById('resetTargetUserName');
  const targetLogin = document.getElementById('resetTargetUserLogin');
  const passInput = document.getElementById('adminNewPasswordInput');
  const alertBox = document.getElementById('resetPasswordAlertBox');

  if (targetName) targetName.textContent = name;
  if (targetLogin) targetLogin.textContent = `Username: ${loginname}`;
  if (passInput) passInput.value = '';
  if (alertBox) alertBox.style.display = 'none';

  document.getElementById('resetPasswordModal')?.classList.add('open');
}

async function handleAdminResetPassword(e) {
  e.preventDefault();
  if (!currentResetTarget || !state.currentUser) return;

  const newPass = document.getElementById('adminNewPasswordInput')?.value.trim();
  const alertBox = document.getElementById('resetPasswordAlertBox');
  const submitBtn = document.getElementById('confirmResetPassBtn');

  if (!newPass) {
    alert('กรุณากรอกรหัสผ่านใหม่');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ กำลังบันทึก...';
  }

  try {
    const res = await fetch('/api/admin/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        admin_loginname: state.currentUser.loginname,
        target_loginname: currentResetTarget.loginname,
        new_password: newPass,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      alert(`✓ ${json.message}\nรหัสผ่านใหม่คือ: ${newPass}`);
      document.getElementById('resetPasswordModal')?.classList.remove('open');
    } else {
      if (alertBox) {
        alertBox.style.display = 'block';
        alertBox.style.background = '#fee2e2';
        alertBox.style.color = '#991b1b';
        alertBox.innerHTML = `⚠️ ${json.error}`;
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.style.display = 'block';
      alertBox.style.background = '#fee2e2';
      alertBox.style.color = '#991b1b';
      alertBox.innerHTML = `⚠️ เกิดข้อผิดพลาด: ${err.message}`;
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '💾 ยืนยันเปลี่ยนรหัสผ่าน';
    }
  }
}

function openSignatureModal() {
  if (!state.currentUser) {
    document.getElementById('loginModal')?.classList.add('open');
    return;
  }

  const u = state.currentUser;
  const nameLabel = document.getElementById('sigUserNameLabel');
  const detailLabel = document.getElementById('sigUserDetailLabel');
  if (nameLabel) nameLabel.textContent = u.name;
  if (detailLabel) detailLabel.textContent = `${u.groupname || 'เจ้าหน้าที่'} | Login: ${u.loginname} ${u.licenseno ? `| ว. ${u.licenseno}` : ''}`;

  const currentSigWrap = document.getElementById('currentSigPreviewWrap');
  const currentSigImg = document.getElementById('currentSigImg');
  if (currentSigWrap && currentSigImg) {
    if (u.signature_url) {
      currentSigWrap.style.display = 'block';
      currentSigImg.src = u.signature_url;
    } else {
      currentSigWrap.style.display = 'none';
    }
  }

  clearSignatureCanvas();
  document.getElementById('signatureModal')?.classList.add('open');
}

function initSignaturePad() {
  sigCanvas = document.getElementById('signatureCanvas');
  if (!sigCanvas) return;
  sigCtx = sigCanvas.getContext('2d');
  
  function resizeCanvas() {
    if (!sigCanvas) return;
    const rect = sigCanvas.getBoundingClientRect();
    if (rect.width > 0) {
      sigCanvas.width = rect.width * 2;
      sigCanvas.height = 180 * 2;
      sigCtx.scale(2, 2);
      sigCtx.lineCap = 'round';
      sigCtx.lineJoin = 'round';
      sigCtx.lineWidth = 2.5;
      sigCtx.strokeStyle = sigInkColor;
    }
  }
  setTimeout(resizeCanvas, 200);

  function getPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function startDraw(e) {
    isDrawing = true;
    const pos = getPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
    const hint = document.getElementById('canvasEmptyHint');
    if (hint) hint.style.display = 'none';
    if (e.cancelable) e.preventDefault();
  }

  function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
    if (e.cancelable) e.preventDefault();
  }

  function stopDraw() {
    isDrawing = false;
  }

  sigCanvas.addEventListener('mousedown', startDraw);
  sigCanvas.addEventListener('mousemove', draw);
  sigCanvas.addEventListener('mouseup', stopDraw);
  sigCanvas.addEventListener('mouseleave', stopDraw);

  sigCanvas.addEventListener('touchstart', startDraw, { passive: false });
  sigCanvas.addEventListener('touchmove', draw, { passive: false });
  sigCanvas.addEventListener('touchend', stopDraw);

  // Clear button
  document.getElementById('clearSignatureBtn')?.addEventListener('click', clearSignatureCanvas);

  // Color switcher
  document.querySelectorAll('.sig-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sig-color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sigInkColor = btn.dataset.color || '#002b80';
      if (sigCtx) sigCtx.strokeStyle = sigInkColor;
    });
  });

  // Image file upload
  document.getElementById('uploadSignatureInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        clearSignatureCanvas();
        const hint = document.getElementById('canvasEmptyHint');
        if (hint) hint.style.display = 'none';
        const rect = sigCanvas.getBoundingClientRect();
        const scale = Math.min(rect.width / img.width, 180 / img.height, 1);
        const w = img.width * scale * 0.85;
        const h = img.height * scale * 0.85;
        const x = (rect.width - w) / 2;
        const y = (180 - h) / 2;
        sigCtx.drawImage(img, x, y, w, h);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Save Signature button
  document.getElementById('saveSignatureBtn')?.addEventListener('click', handleSaveSignature);
}

function clearSignatureCanvas() {
  if (!sigCanvas || !sigCtx) return;
  const rect = sigCanvas.getBoundingClientRect();
  sigCtx.clearRect(0, 0, rect.width * 2, 180 * 2);
  const hint = document.getElementById('canvasEmptyHint');
  if (hint) hint.style.display = 'block';
}

async function handleSaveSignature() {
  if (!state.currentUser) {
    alert('กรุณาเข้าสู่ระบบก่อนบันทึกลายเซ็น');
    return;
  }
  if (!sigCanvas) return;

  const dataUrl = sigCanvas.toDataURL('image/png');
  const btn = document.getElementById('saveSignatureBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ กำลังบันทึก...';
  }

  try {
    const res = await fetch('/api/user/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginname: state.currentUser.loginname,
        signature_base64: dataUrl,
      }),
    });
    const json = await res.json();
    if (json.ok) {
      state.currentUser.signature_url = json.signature_url;
      localStorage.setItem('ipd_user', JSON.stringify(state.currentUser));
      updateAuthUI();
      alert('✓ บันทึกลายเซ็นดิจิทัลสำเร็จ! ระบบจะนำไปประทับลงในเอกสารเวชระเบียนโดยอัตโนมัติ');
      document.getElementById('signatureModal')?.classList.remove('open');
    } else {
      alert('เกิดข้อผิดพลาด: ' + json.error);
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '💾 บันทึกลายเซ็นดิจิทัล';
    }
  }
}
