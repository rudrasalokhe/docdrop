// DocDrop v3 — Professional Frontend JS
'use strict';

let currentUser = null;
let allDoctors  = [];
let _signupData = {};
let _otpTimer   = null;

// ─── Token ───────────────────────────────────────────
const saveToken  = t  => sessionStorage.setItem('token', t);
const loadToken  = () => sessionStorage.getItem('token');
const clearToken = () => sessionStorage.removeItem('token');

// ─── API ─────────────────────────────────────────────
async function api(path, method = 'GET', body) {
  const token = loadToken();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
const get  = path       => api(path, 'GET');
const post = (path, body) => api(path, 'POST', body || {});

// ─── DOM helpers ─────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $( id )?.classList.remove('hidden');
const hide = id => $( id )?.classList.add('hidden');
const val  = id => $( id )?.value.trim() ?? '';

// ─── Toast ───────────────────────────────────────────
function toast(msg, type = 'info') {
  const el    = $('toast');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  $('toastIcon').textContent = icons[type] || 'ℹ';
  $('toastMsg').textContent  = msg;
  el.className     = type;
  el.style.display = 'flex';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ─── Utils ───────────────────────────────────────────
function fmtDate(d) {
  return new Date(d + 'T00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}

function togglePw() {
  const inp = $('aPass');
  inp.type  = inp.type === 'password' ? 'text' : 'password';
}

function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }

function toggleMobileNav() {
  $('mobileNav').classList.toggle('open');
}

// ─── Button loading state ────────────────────────────
function setBtnLoading(btn, loading, text) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn._orig = btn.textContent;
    btn.textContent = text || 'Loading…';
  } else {
    btn.textContent = btn._orig || text || btn.textContent;
  }
}

// ─── Shell switching ─────────────────────────────────
function showLanding() {
  $('landingPage').style.display = '';
  $('appShell').classList.remove('visible');
  $('appShell').classList.add('hidden');
  document.body.style.overflow = '';
}

function showShell() {
  $('landingPage').style.display = 'none';
  const shell = $('appShell');
  shell.classList.remove('hidden');
  shell.classList.add('visible');
}

function backToLanding() {
  clearToken();
  currentUser = null;
  clearOtpTimer();
  hideChatFab();
  _chatHistory = [];
  showLanding();
}

// ════════════════════════════════════════════
//  ROUTING
// ════════════════════════════════════════════
function showApp(role, mode) {
  showShell();
  hide('patientDash');
  hide('doctorAdmin');
  hide('callScreen');
  show('authScreen');
  show('authStep1');
  hide('authStep2');
  $('navUser').innerHTML = '';

  const isDoc = role === 'doctor';
  $('authTitle').textContent    = isDoc ? 'Doctor Login' : (mode === 'signup' ? 'Create account' : 'Welcome back');
  $('authSubtitle').textContent = isDoc ? 'Sign in to your doctor account.' : 'Access your patient account.';
  $('nameField').style.display  = (isDoc || mode === 'login') ? 'none' : '';

  const btns = $('authBtns');
  const hint = $('authHint');

  if (isDoc) {
    btns.innerHTML = `<button class="btn-cta" onclick="loginDoctor()" style="flex:1;margin:0">Sign in →</button>`;
    hint.textContent   = 'Demo: sarah@docdrop.com / doc123';
    hint.style.display = 'block';
  } else if (mode === 'signup') {
    $('nameField').style.display = '';
    btns.innerHTML = `
      <button class="btn-secondary" onclick="switchAuthMode('login')" style="margin:0">Log in instead</button>
      <button class="btn-cta" onclick="initiateSignup()" style="margin:0">Sign Up →</button>`;
    hint.style.display = 'none';
  } else {
    btns.innerHTML = `
      <button class="btn-secondary" onclick="switchAuthMode('signup')" style="margin:0">Create account</button>
      <button class="btn-cta" onclick="loginPatient()" style="margin:0">Log in →</button>`;
    hint.style.display = 'none';
  }
}

function switchAuthMode(mode) { showApp('patient', mode); }

// ════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════
async function loginPatient() {
  const email = val('aEmail'), pass = val('aPass');
  if (!email || !pass) return toast('Enter email and password', 'error');
  const btn = document.querySelector('#authBtns .btn-cta');
  setBtnLoading(btn, true, 'Signing in…');
  try {
    const data = await post('/api/auth/login/patient', { email, password: pass });
    saveToken(data.token);
    currentUser = data.user;
    await showPatientDash();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false, 'Log in →');
  }
}

async function initiateSignup() {
  const name = val('aName'), email = val('aEmail'), pass = val('aPass');
  if (!email || !pass) return toast('Email and password required', 'error');
  if (pass.length < 4)  return toast('Password must be at least 4 characters', 'error');
  if (!email.includes('@')) return toast('Enter a valid email address', 'error');

  const btn = document.querySelector('#authBtns .btn-cta');
  setBtnLoading(btn, true, 'Sending code…');

  try {
    await post('/api/auth/send-otp', { email, name });
    _signupData = { name, email, password: pass };
    hide('authStep1');
    show('authStep2');
    $('otpSubtext').textContent = `We sent a 6-digit code to ${email}. Expires in 10 minutes.`;
    document.querySelectorAll('.otp-digit').forEach(i => { i.value = ''; i.classList.remove('filled'); });
    $('verifyOtpBtn').disabled = true;
    startOtpTimer(600);
    document.querySelectorAll('.otp-digit')[0].focus();
  } catch(e) {
    toast(e.message || 'Failed to send code.', 'error');
  } finally {
    setBtnLoading(btn, false, 'Sign Up →');
  }
}

async function verifyOtpAndSignup() {
  const digits = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
  if (digits.length < 6) return toast('Enter the full 6-digit code', 'error');

  const btn = $('verifyOtpBtn');
  setBtnLoading(btn, true, 'Verifying…');

  try {
    const data = await post('/api/auth/signup', {
      name:     _signupData.name,
      email:    _signupData.email,
      password: _signupData.password,
      otp:      digits,
    });
    clearOtpTimer();
    saveToken(data.token);
    currentUser = data.user;
    toast('Account created! Welcome 🎉', 'success');
    await showPatientDash();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false, 'Verify & Create Account');
    btn.disabled = false;
  }
}

async function resendOtp() {
  const btn = $('resendBtn');
  setBtnLoading(btn, true, 'Sending…');
  try {
    await post('/api/auth/send-otp', { email: _signupData.email, name: _signupData.name });
    toast('New code sent!', 'success');
    document.querySelectorAll('.otp-digit').forEach(i => { i.value = ''; i.classList.remove('filled'); });
    $('verifyOtpBtn').disabled = true;
    startOtpTimer(600);
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false, 'Resend code');
    btn.disabled = false;
  }
}

function backToStep1() {
  clearOtpTimer();
  hide('authStep2');
  show('authStep1');
}

function otpNext(input, idx) {
  input.value = input.value.replace(/[^0-9]/g, '').slice(-1);
  input.classList.toggle('filled', input.value !== '');
  const digits = [...document.querySelectorAll('.otp-digit')];
  if (input.value && idx < 5) digits[idx + 1].focus();
  $('verifyOtpBtn').disabled = !digits.every(i => i.value !== '');
}

function otpBack(input, e, idx) {
  if (e.key === 'Backspace' && !input.value && idx > 0) {
    const digits = [...document.querySelectorAll('.otp-digit')];
    digits[idx - 1].focus();
    digits[idx - 1].value = '';
    digits[idx - 1].classList.remove('filled');
    $('verifyOtpBtn').disabled = true;
  }
}

function startOtpTimer(seconds) {
  clearOtpTimer();
  hide('resendBtn');
  const timerEl  = $('otpTimer');
  const resendEl = $('resendBtn');
  let remaining  = seconds;

  function tick() {
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    timerEl.textContent = `Expires in ${m}:${s}`;
    if (remaining <= 0) {
      timerEl.textContent = 'Code expired.';
      resendEl.classList.remove('hidden');
      clearOtpTimer();
      return;
    }
    remaining--;
  }
  tick();
  _otpTimer = setInterval(tick, 1000);
  setTimeout(() => { if (_otpTimer) resendEl.classList.remove('hidden'); }, 60000);
}

function clearOtpTimer() {
  if (_otpTimer) { clearInterval(_otpTimer); _otpTimer = null; }
}

async function loginDoctor() {
  const email = val('aEmail'), pass = val('aPass');
  if (!email || !pass) return toast('Enter email and password', 'error');
  const btn = document.querySelector('#authBtns .btn-cta');
  setBtnLoading(btn, true, 'Signing in…');
  try {
    const data = await post('/api/auth/login/doctor', { email, password: pass });
    saveToken(data.token);
    currentUser = data.user;
    await showDoctorAdmin();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false, 'Sign in →');
  }
}

async function logout() {
  clearToken();
  currentUser = null;
  clearOtpTimer();
  hideChatFab();
  _chatHistory = [];
  showLanding();
}

// ════════════════════════════════════════════
//  PATIENT DASHBOARD
// ════════════════════════════════════════════
async function showPatientDash() {
  hide('authScreen');
  hide('doctorAdmin');
  show('patientDash');
  setNavUser();
  showChatFab();
  $('pDate').min = new Date().toISOString().split('T')[0];

  try {
    allDoctors = await get('/api/doctors');
    const sel  = $('doctorSelect');
    sel.innerHTML = `<option value="">— choose a doctor —</option>`;
    allDoctors.forEach(d => {
      const opt       = document.createElement('option');
      opt.value       = d.id;
      opt.textContent = `${d.name} — ${d.specialty}`;
      sel.appendChild(opt);
    });
  } catch(e) { toast('Could not load doctors', 'error'); }

  await loadPatientAppts();
}

async function bookAppointment() {
  const doctorId = val('doctorSelect');
  const date     = val('pDate');
  const timeSlot = val('slotSelect');
  const notes    = val('pNotes');

  if (!doctorId) return toast('Please select a doctor', 'error');
  if (!date)     return toast('Please choose a date', 'error');
  if (!timeSlot) return toast('Please choose a time slot', 'error');

  const btn = $('bookBtn');
  setBtnLoading(btn, true, '⏳ Booking…');

  try {
    await post('/api/appointments/book', { doctor_id: doctorId, date, time_slot: timeSlot, notes });
    toast('Appointment booked successfully ✓', 'success');
    $('doctorSelect').value = '';
    $('pDate').value        = '';
    $('slotSelect').value   = '';
    $('pNotes').value       = '';
    await loadPatientAppts();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    setBtnLoading(btn, false, '📅 Book Appointment');
  }
}

async function loadPatientAppts() {
  const tbody = $('patientTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="tbl-empty">Loading…</td></tr>`;
  try {
    const appts = await get('/api/appointments/patient');
    if (!appts.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="tbl-empty">No appointments yet. Book your first one!</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    appts.forEach(a => {
      const tr      = document.createElement('tr');
      const callBtn = a.status === 'upcoming'
        ? `<button class="tbl-btn tbl-blue" onclick="joinCall('${a.id}')">📷 Join Call</button>`
        : '—';
      const cancelBtn = a.status === 'upcoming'
        ? `<button class="tbl-btn tbl-red" onclick="cancelAppt('${a.id}',this)">Cancel</button>`
        : '—';
      tr.innerHTML = `
        <td><strong>${a.doctorName || '—'}</strong></td>
        <td>${a.specialty || '—'}</td>
        <td>${fmtDate(a.date)}</td>
        <td>${a.time_slot}</td>
        <td><span class="chip chip-${a.status}">${a.status}</span></td>
        <td>${callBtn}</td>
        <td>${cancelBtn}</td>`;
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" class="tbl-empty" style="color:var(--ro)">Failed to load appointments.</td></tr>`;
  }
}

async function cancelAppt(id, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await post(`/api/appointments/${id}/cancel`);
    toast('Appointment cancelled', 'success');
    await loadPatientAppts();
  } catch(e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Cancel';
  }
}

// ════════════════════════════════════════════
//  DOCTOR DASHBOARD
// ════════════════════════════════════════════
async function showDoctorAdmin() {
  hide('authScreen');
  hide('patientDash');
  show('doctorAdmin');
  setNavUser();
  showChatFab();

  try {
    allDoctors = await get('/api/doctors');
    const sel  = $('adminDoctorFilter');
    sel.innerHTML = `<option value="">All Doctors</option>`;
    allDoctors.forEach(d => {
      const opt       = document.createElement('option');
      opt.value       = d.id;
      opt.textContent = d.name;
      if (d.email === currentUser.email) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch(e) { toast('Could not load doctors', 'error'); }

  await loadAdminStats();
  await loadAdminAppts();
}

async function loadAdminStats() {
  try {
    const s = await get('/api/admin/stats');
    $('aTotal').textContent    = s.total;
    $('aToday').textContent    = s.today;
    $('aUpcoming').textContent = s.upcoming;
    $('aPatients').textContent = s.patients;
  } catch {}
}

async function loadAdminAppts() {
  const tbody    = $('adminTableBody');
  const doctorId = val('adminDoctorFilter');
  tbody.innerHTML = `<tr><td colspan="9" class="tbl-empty">Loading…</td></tr>`;
  try {
    const url   = '/api/admin/appointments' + (doctorId ? `?doctor_id=${doctorId}` : '');
    const appts = await get(url);
    if (!appts.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="tbl-empty">No appointments found.</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    appts.forEach(a => {
      const tr = document.createElement('tr');
      const callBtn = a.status === 'upcoming'
        ? `<button class="tbl-btn tbl-blue" onclick="joinCall('${a.id}')">📷 Join</button>`
        : '—';
      tr.innerHTML = `
        <td><strong>${a.patient_name || '—'}</strong></td>
        <td>${a.patient_email || '—'}</td>
        <td>${a.doctorName || '—'}</td>
        <td>${fmtDate(a.date)}</td>
        <td>${a.time_slot}</td>
        <td>${a.notes || '—'}</td>
        <td><span class="chip chip-${a.status}">${a.status}</span></td>
        <td>${callBtn}</td>
        <td><div class="tbl-actions">
          ${a.status === 'upcoming' ? `<button class="tbl-btn tbl-green" onclick="markDone('${a.id}',this)">✓ Done</button>` : ''}
          ${a.status !== 'cancelled' ? `<button class="tbl-btn tbl-red" onclick="adminCancel('${a.id}',this)">Cancel</button>` : ''}
        </div></td>`;
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="9" class="tbl-empty" style="color:var(--ro)">Failed to load.</td></tr>`;
  }
}

async function markDone(id, btn) {
  btn.disabled    = true;
  btn.textContent = '…';
  try {
    await post(`/api/admin/appointments/${id}/done`);
    toast('Marked as done', 'success');
    await loadAdminAppts();
    await loadAdminStats();
  } catch(e) {
    toast(e.message, 'error');
    btn.disabled    = false;
    btn.textContent = '✓ Done';
  }
}

async function adminCancel(id, btn) {
  btn.disabled    = true;
  btn.textContent = '…';
  try {
    await post(`/api/appointments/${id}/cancel`);
    toast('Cancelled', 'success');
    await loadAdminAppts();
    await loadAdminStats();
  } catch(e) {
    toast(e.message, 'error');
    btn.disabled    = false;
    btn.textContent = 'Cancel';
  }
}

function setNavUser() {
  const role = currentUser.role === 'doctor' ? 'Doctor' : 'Patient';
  $('navUser').innerHTML = `
    <span class="nu-name">${currentUser.name}</span>
    <span class="nu-role">${role}</span>
    <button class="nu-logout" onclick="logout()">Sign out</button>`;
}

// ─── Init ─────────────────────────────────────────────
async function init() {
  const token = loadToken();
  if (!token) { showLanding(); return; }
  try {
    const data  = await get('/api/auth/me');
    currentUser = data.user;
    showShell();
    if (currentUser.role === 'patient')     await showPatientDash();
    else if (currentUser.role === 'doctor') await showDoctorAdmin();
  } catch {
    clearToken();
    showLanding();
  }
}

init();

// ════════════════════════════════════════════
//  VIDEO CALL
// ════════════════════════════════════════════
let _peer          = null;
let _localStream   = null;
let _activeCall    = null;
let _callRoomData  = null;
let _dataConn      = null;
let _callChatOpen  = false;
let _callChatUnread = 0;

async function joinCall(apptId) {
  try {
    const room = await get(`/api/call/room/${apptId}`);
    _callRoomData = room;
    await startCallScreen(room);
  } catch(e) {
    toast('Could not join call: ' + e.message, 'error');
  }
}

async function startCallScreen(room) {
  show('callScreen');
  $('callScreen').classList.remove('hidden');
  $('callApptInfo').textContent =
    room.date + ' at ' + room.time_slot +
    (room.patient_name ? '  ·  ' + room.patient_name : '');

  setCallStatus('connecting', 'Connecting…');
  setWaiting(true, 'Starting camera…');

  try {
    _localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $('localVideo').srcObject = _localStream;
  } catch(e) {
    toast('Camera/mic access denied. Please allow permissions.', 'error');
    setWaiting(true, '⚠️ Camera access denied. Check browser permissions.');
    return;
  }

  setWaiting(true, 'Waiting for the other person to join…');
  setCallStatus('connecting', 'Waiting…');

  _peer = new Peer(room.peer_id, {
    host: '0.peerjs.com', port: 443, secure: true, path: '/',
    config: { iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]}
  });

  _peer.on('open', id => {
    if (room.role === 'doctor') {
      setWaiting(true, 'Waiting for patient to join…');
      _peer.on('call', call => {
        _activeCall = call;
        call.answer(_localStream);
        handleCallStream(call, room.patient_name || 'Patient');
      });
      _peer.on('connection', conn => {
        _dataConn = conn;
        setupDataConn(conn, room.patient_name || 'Patient');
      });
    } else {
      setWaiting(true, 'Calling doctor…');
      const call = _peer.call(room.other_peer_id, _localStream);
      if (!call) { setWaiting(true, '⚠️ Could not reach doctor. Make sure they joined first.'); return; }
      _activeCall = call;
      handleCallStream(call, 'Doctor');
      const conn = _peer.connect(room.other_peer_id, { reliable: true });
      _dataConn  = conn;
      setupDataConn(conn, 'Doctor');
    }
  });

  _peer.on('error', err => {
    if (err.type === 'peer-unavailable') {
      setWaiting(true, "The other person hasn't joined yet. They'll connect automatically.");
      setTimeout(() => {
        if (_peer && !_activeCall && room.role === 'patient') {
          const call = _peer.call(room.other_peer_id, _localStream);
          if (call) { _activeCall = call; handleCallStream(call, 'Doctor'); }
        }
      }, 4000);
    } else {
      setWaiting(true, '⚠️ Connection error: ' + err.type + '. Try refreshing.');
    }
  });

  _peer.on('disconnected', () => {
    setCallStatus('connecting', 'Reconnecting…');
    _peer.reconnect();
  });
}

function handleCallStream(call, remoteName) {
  call.on('stream', remoteStream => {
    $('remoteVideo').srcObject = remoteStream;
    $('remoteName').textContent = remoteName;
    setWaiting(false);
    setCallStatus('connected', 'In call · ' + remoteName);
  });
  call.on('close', () => {
    setCallStatus('ended', 'Call ended');
    setWaiting(true, 'The other person has left the call.');
    $('remoteVideo').srcObject = null;
  });
  call.on('error', err => toast('Call error: ' + err.message, 'error'));
}

function endCall() {
  _dataConn?.close();   _dataConn   = null;
  _activeCall?.close(); _activeCall = null;
  if (_peer) { _peer.destroy(); _peer = null; }
  _localStream?.getTracks().forEach(t => t.stop());
  _localStream = null;
  $('localVideo').srcObject  = null;
  $('remoteVideo').srcObject = null;
  _callChatOpen   = false;
  _callChatUnread = 0;
  hide('callChatSidebar');
  $('callChatMessages').innerHTML = `<div class="call-chat-info">Messages are only visible during this call.</div>`;
  $('callChatBadge')?.remove();
  hide('callScreen');
  toast('Call ended', 'success');
}

function toggleMic() {
  if (!_localStream) return;
  const track = _localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = $('btnMic');
  btn.textContent = track.enabled ? '🎙 Mute' : '🔇 Unmute';
  btn.classList.toggle('muted', !track.enabled);
}

function toggleCam() {
  if (!_localStream) return;
  const track = _localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = $('btnCam');
  btn.textContent = track.enabled ? '📷 Camera' : '🚫 Camera';
  btn.classList.toggle('muted', !track.enabled);
}

function setCallStatus(state, text) {
  $('callStatus').className = 'call-status ' + state;
  $('callStatusText').textContent = text;
}

function setWaiting(visible, text) {
  const el = $('waitingOverlay');
  if (visible) {
    el.classList.remove('hidden');
    if (text) $('waitingText').textContent = text;
  } else {
    el.classList.add('hidden');
  }
}

// Draggable local PiP
(function initPip() {
  let el, dragging = false, ox, oy;
  document.addEventListener('DOMContentLoaded', () => {
    el = document.querySelector('.video-local');
    if (!el) return;
    el.addEventListener('mousedown', e => {
      dragging = true;
      const r  = el.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      el.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const pw = el.parentElement.offsetWidth;
      const ph = el.parentElement.offsetHeight;
      let x = Math.max(8, Math.min(pw - el.offsetWidth  - 8, e.clientX - ox));
      let y = Math.max(8, Math.min(ph - el.offsetHeight - 8, e.clientY - oy));
      el.style.right  = 'auto';
      el.style.bottom = 'auto';
      el.style.left   = x + 'px';
      el.style.top    = y + 'px';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      if (el) el.style.cursor = 'grab';
    });
  });
})();

// ════════════════════════════════════════════
//  IN-CALL CHAT
// ════════════════════════════════════════════
function setupDataConn(conn, remoteName) {
  conn.on('open',  () => appendCallSystemMsg(remoteName + ' connected to chat'));
  conn.on('data',  data => {
    try {
      const msg = typeof data === 'string' ? JSON.parse(data) : data;
      appendCallChatBubble('them', msg.text, msg.sender || remoteName);
      if (!_callChatOpen) { _callChatUnread++; renderCallChatBadge(); }
    } catch(e) { console.error('[Chat] Bad message:', e); }
  });
  conn.on('close', () => appendCallSystemMsg(remoteName + ' left the chat'));
  conn.on('error', err => console.error('[Chat] conn error:', err));
}

function toggleCallChat() {
  _callChatOpen = !_callChatOpen;
  const sidebar = $('callChatSidebar');
  if (_callChatOpen) {
    sidebar.classList.remove('hidden');
    _callChatUnread = 0;
    renderCallChatBadge();
    setTimeout(() => $('callChatInput').focus(), 150);
    const msgs = $('callChatMessages');
    msgs.scrollTop = msgs.scrollHeight;
  } else {
    sidebar.classList.add('hidden');
  }
  $('btnChat').classList.toggle('muted', _callChatOpen);
}

function renderCallChatBadge() {
  const btn = $('btnChat');
  let badge = $('callChatBadge');
  if (_callChatUnread > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id        = 'callChatBadge';
      badge.className = 'cbtn-chat-badge';
      btn.style.position = 'relative';
      btn.appendChild(badge);
    }
    badge.textContent = _callChatUnread > 9 ? '9+' : String(_callChatUnread);
  } else {
    badge?.remove();
  }
}

function sendCallChatMessage() {
  const input = $('callChatInput');
  const text  = input.value.trim();
  if (!text) return;

  if (!_dataConn || !_dataConn.open) {
    appendCallChatBubble('me', text, 'You');
    input.value = '';
    appendCallSystemMsg('⚠️ Other party may not be connected to chat yet.');
    return;
  }

  const payload = { text, sender: currentUser?.name || 'You', ts: Date.now() };
  try {
    _dataConn.send(JSON.stringify(payload));
    appendCallChatBubble('me', text, 'You');
    input.value = '';
    $('callChatMessages').scrollTop = $('callChatMessages').scrollHeight;
  } catch(e) {
    appendCallSystemMsg('⚠️ Could not send message: ' + e.message);
  }
}

function appendCallChatBubble(side, text, senderName) {
  const msgs   = $('callChatMessages');
  const wrap   = document.createElement('div');
  wrap.className = 'cc-msg ' + side;
  const bubble = document.createElement('div');
  bubble.className   = 'cc-bubble';
  bubble.textContent = text;
  const meta   = document.createElement('div');
  meta.className   = 'cc-meta';
  meta.textContent = (side === 'them' ? senderName + '  ·  ' : '') +
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendCallSystemMsg(text) {
  const msgs = $('callChatMessages');
  const el   = document.createElement('div');
  el.className   = 'cc-system';
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

// ════════════════════════════════════════════
//  AI CHATBOT
// ════════════════════════════════════════════
let _chatOpen    = false;
let _chatHistory = [];
let _chatLoading = false;

function showChatFab() { show('chatFab'); }
function hideChatFab()  { hide('chatFab'); if (_chatOpen) closeChat(); }
function toggleChat()   { _chatOpen ? closeChat() : openChat(); }

function openChat() {
  _chatOpen = true;
  show('chatPanel');
  hide('chatUnread');
  $('chatPanel').classList.remove('hidden');

  if (currentUser) {
    const isDoc = currentUser.role === 'doctor';
    $('chatSubtitle').textContent = isDoc ? 'Clinical assistant' : 'Your medical assistant';
    $('chatWelcomeText').textContent = isDoc
      ? `Hi Dr. ${currentUser.name.split(' ')[0]}! I can help you manage your schedule and appointments.`
      : `Hi ${currentUser.name.split(' ')[0]}! I'm here to help with your appointments and health questions.`;
    if (isDoc) {
      $('chatSuggestions').innerHTML = `
        <button onclick="sendSuggestion(this)">Show today's appointments</button>
        <button onclick="sendSuggestion(this)">Summarise upcoming schedule</button>
        <button onclick="sendSuggestion(this)">Any appointments needing attention?</button>`;
    }
  }
  setTimeout(() => $('chatInput').focus(), 200);
}

function closeChat() { _chatOpen = false; hide('chatPanel'); }

function clearChat() {
  _chatHistory = [];
  $('chatMessages').innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">✦</div>
      <p id="chatWelcomeText">Chat cleared. How can I help you?</p>
      <div class="chat-suggestions" id="chatSuggestions">
        <button onclick="sendSuggestion(this)">Show my upcoming appointments</button>
        <button onclick="sendSuggestion(this)">How do I prepare for my visit?</button>
        <button onclick="sendSuggestion(this)">What should I tell my doctor?</button>
      </div>
    </div>`;
}

function sendSuggestion(btn) {
  const text = btn.textContent;
  $('chatSuggestions')?.remove();
  document.querySelector('.chat-welcome')?.remove();
  sendMessage(text);
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
}

function autoResizeChatInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function sendChatMessage() {
  const input = $('chatInput');
  const text  = input.value.trim();
  if (!text || _chatLoading) return;
  input.value        = '';
  input.style.height = 'auto';
  document.querySelector('.chat-welcome')?.remove();
  sendMessage(text);
}

async function sendMessage(text) {
  if (_chatLoading) return;
  _chatLoading = true;
  appendChatBubble('user', text);
  _chatHistory.push({ role: 'user', content: text });
  $('chatSendBtn').disabled = true;
  const typingId = addTypingIndicator();

  try {
    const data = await post('/api/chat', { messages: _chatHistory });
    removeTypingIndicator(typingId);
    _chatHistory.push({ role: 'assistant', content: data.reply });
    appendChatBubble('ai', data.reply);
    if (!_chatOpen) show('chatUnread');
  } catch(e) {
    removeTypingIndicator(typingId);
    appendChatError(e.message || "Sorry, I couldn't get a response. Please try again.");
    _chatHistory.pop();
  } finally {
    _chatLoading = false;
    $('chatSendBtn').disabled = false;
    $('chatInput').focus();
  }
}

function appendChatBubble(role, text) {
  const msgs   = $('chatMessages');
  const wrap   = document.createElement('div');
  wrap.className = 'chat-msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = formatChatText(text);
  const time   = document.createElement('div');
  time.className   = 'chat-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrap.appendChild(bubble);
  wrap.appendChild(time);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendChatError(msg) {
  const msgs = $('chatMessages');
  const el   = document.createElement('div');
  el.className   = 'chat-error';
  el.textContent = '⚠️ ' + msg;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTypingIndicator() {
  const msgs = $('chatMessages');
  const el   = document.createElement('div');
  const id   = 'typing_' + Date.now();
  el.id        = id;
  el.className = 'chat-typing';
  el.innerHTML = '<span></span><span></span><span></span>';
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeTypingIndicator(id) { $(id)?.remove(); }

function formatChatText(text) {
  let safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
  safe = safe.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  safe = safe.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  safe = safe.replace(/\n\n/g, '</p><p>');
  safe = safe.replace(/\n/g, '<br>');
  return '<p>' + safe + '</p>';
}
