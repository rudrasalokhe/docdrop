// DocDrop — Frontend JS
let currentUser = null;
let allDoctors  = [];
let _signupData = {};
let _otpTimer   = null;

// ── Token helpers ──────────────────────────────
function saveToken(t) { sessionStorage.setItem("token", t); }
function loadToken()  { return sessionStorage.getItem("token"); }
function clearToken() { sessionStorage.removeItem("token"); }

// ── API helper ─────────────────────────────────
async function api(path, method, body) {
  const token = loadToken();
  const opts  = { method: method || "GET", headers: { "Content-Type": "application/json" } };
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}
function get(path)        { return api(path, "GET"); }
function post(path, body) { return api(path, "POST", body || {}); }

// ── Util ───────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hide(id) { document.getElementById(id).classList.add("hidden"); }
function val(id)  { return document.getElementById(id).value.trim(); }

function toast(msg, type) {
  const el = document.getElementById("toast");
  document.getElementById("toastIcon").textContent = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  document.getElementById("toastMsg").textContent  = msg;
  el.className     = type || "";
  el.style.display = "flex";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = "none"; }, 3500);
}

function fmtDate(d) {
  return new Date(d + "T00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
}

function togglePw() {
  const inp = document.getElementById("aPass");
  inp.type  = inp.type === "password" ? "text" : "password";
}

function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

function toggleMobileNav() {
  document.getElementById("mobileNav").classList.toggle("open");
}

// ── Shell switching ────────────────────────────
function showLanding() {
  document.getElementById("landingPage").style.display = "";
  document.getElementById("appShell").classList.remove("visible");
  document.getElementById("appShell").classList.add("hidden");
  document.body.style.overflow = "";
}

function showShell() {
  document.getElementById("landingPage").style.display = "none";
  const shell = document.getElementById("appShell");
  shell.classList.remove("hidden");
  shell.classList.add("visible");
}

function backToLanding() {
  clearToken();
  currentUser = null;
  clearOtpTimer();
  showLanding();
}

// ════════════════════════════════════════════
//  ROUTING
// ════════════════════════════════════════════

function showApp(role, mode) {
  showShell();
  hide("patientDash"); hide("doctorAdmin");
  show("authScreen");
  show("authStep1");
  hide("authStep2");
  document.getElementById("navUser").innerHTML = "";

  const isDoc = role === "doctor";
  document.getElementById("authTitle").textContent    = isDoc ? "Doctor Login" : (mode === "signup" ? "Create account" : "Welcome back");
  document.getElementById("authSubtitle").textContent = isDoc ? "Sign in to your doctor account." : "Access your patient account.";
  document.getElementById("nameField").style.display  = (isDoc || mode === "login") ? "none" : "";

  const btns = document.getElementById("authBtns");
  const hint = document.getElementById("authHint");

  if (isDoc) {
    btns.innerHTML     = `<button class="btn-cta" onclick="loginDoctor()" style="flex:1;margin:0">Login</button>`;
    hint.textContent   = "Demo: sarah@docdrop.com / doc123";
    hint.style.display = "block";
  } else {
    if (mode === "signup") {
      document.getElementById("nameField").style.display = "";
      btns.innerHTML = `
        <button class="btn-secondary" onclick="switchAuthMode('login')" style="margin:0">Log in instead</button>
        <button class="btn-cta"       onclick="initiateSignup()" style="margin:0">Sign Up →</button>`;
    } else {
      btns.innerHTML = `
        <button class="btn-secondary" onclick="switchAuthMode('signup')" style="margin:0">Create account</button>
        <button class="btn-cta"       onclick="loginPatient()" style="margin:0">Log in →</button>`;
    }
    hint.style.display = "none";
  }
}

function switchAuthMode(mode) {
  const role = "patient";
  showApp(role, mode);
  // Preserve filled values
}

// ════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════

async function loginPatient() {
  const email = val("aEmail"), pass = val("aPass");
  if (!email || !pass) return toast("Enter email and password", "error");
  try {
    const data  = await post("/api/auth/login/patient", { email, password: pass });
    saveToken(data.token);
    currentUser = data.user;
    await showPatientDash();
  } catch(e) { toast(e.message, "error"); }
}

async function initiateSignup() {
  const name = val("aName"), email = val("aEmail"), pass = val("aPass");
  if (!email || !pass) return toast("Email and password required", "error");
  if (pass.length < 4)  return toast("Password must be at least 4 characters", "error");

  const btn = document.querySelector("#authBtns .btn-cta");
  btn.textContent = "Sending code...";
  btn.disabled    = true;

  try {
    const res = await post("/api/auth/send-otp", { email, name });
    _signupData = { name, email, password: pass };

    hide("authStep1");
    show("authStep2");
    document.getElementById("otpSubtext").textContent = `We sent a 6-digit code to ${email}. Expires in 10 minutes.`;

    document.querySelectorAll(".otp-digit").forEach(i => { i.value = ""; i.classList.remove("filled"); });
    document.getElementById("verifyOtpBtn").disabled = true;
    startOtpTimer(600);
    document.querySelectorAll(".otp-digit")[0].focus();

  } catch(e) {
    toast(e.message, "error");
  } finally {
    btn.textContent = "Sign Up →";
    btn.disabled    = false;
  }
}

async function verifyOtpAndSignup() {
  const digits = [...document.querySelectorAll(".otp-digit")].map(i => i.value).join("");
  if (digits.length < 6) return toast("Enter the full 6-digit code", "error");

  const btn = document.getElementById("verifyOtpBtn");
  btn.textContent = "Verifying...";
  btn.disabled    = true;

  try {
    const data = await post("/api/auth/signup", {
      name: _signupData.name, email: _signupData.email,
      password: _signupData.password, otp: digits,
    });
    clearOtpTimer();
    saveToken(data.token);
    currentUser = data.user;
    toast("Account created! Welcome 🎉", "success");
    await showPatientDash();
  } catch(e) {
    toast(e.message, "error");
  } finally {
    btn.textContent = "Verify & Create Account";
    btn.disabled    = false;
  }
}

async function resendOtp() {
  const btn = document.getElementById("resendBtn");
  btn.disabled = true; btn.textContent = "Sending...";
  try {
    const res = await post("/api/auth/send-otp", { email: _signupData.email, name: _signupData.name });
    toast("New code sent!", "success");
    document.querySelectorAll(".otp-digit").forEach(i => { i.value = ""; i.classList.remove("filled"); });
    document.getElementById("verifyOtpBtn").disabled = true;
    startOtpTimer(600);
  } catch(e) { toast(e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Resend code"; }
}

function backToStep1() {
  clearOtpTimer();
  hide("authStep2");
  show("authStep1");
}

function otpNext(input, idx) {
  input.value = input.value.replace(/[^0-9]/g, "").slice(-1);
  input.classList.toggle("filled", input.value !== "");
  const digits = [...document.querySelectorAll(".otp-digit")];
  if (input.value && idx < 5) digits[idx + 1].focus();
  document.getElementById("verifyOtpBtn").disabled = !digits.every(i => i.value !== "");
}

function otpBack(input, e, idx) {
  if (e.key === "Backspace" && !input.value && idx > 0) {
    const digits = [...document.querySelectorAll(".otp-digit")];
    digits[idx - 1].focus();
    digits[idx - 1].value = "";
    digits[idx - 1].classList.remove("filled");
    document.getElementById("verifyOtpBtn").disabled = true;
  }
}

function startOtpTimer(seconds) {
  clearOtpTimer();
  hide("resendBtn");
  const timerEl = document.getElementById("otpTimer");
  const resendEl = document.getElementById("resendBtn");
  let remaining = seconds;
  function tick() {
    const m = Math.floor(remaining / 60).toString().padStart(2, "0");
    const s = (remaining % 60).toString().padStart(2, "0");
    timerEl.textContent = `Expires in ${m}:${s}`;
    if (remaining <= 0) { timerEl.textContent = "Code expired."; resendEl.classList.remove("hidden"); clearOtpTimer(); return; }
    remaining--;
  }
  tick();
  _otpTimer = setInterval(tick, 1000);
  setTimeout(() => { if (_otpTimer) resendEl.classList.remove("hidden"); }, 60000);
}

function clearOtpTimer() {
  if (_otpTimer) { clearInterval(_otpTimer); _otpTimer = null; }
}

async function loginDoctor() {
  const email = val("aEmail"), pass = val("aPass");
  if (!email || !pass) return toast("Enter email and password", "error");
  try {
    const data  = await post("/api/auth/login/doctor", { email, password: pass });
    saveToken(data.token);
    currentUser = data.user;
    await showDoctorAdmin();
  } catch(e) { toast(e.message, "error"); }
}

async function logout() {
  clearToken(); currentUser = null; clearOtpTimer();
  hideChatFab();
  _chatHistory = [];
  showLanding();
}

// ════════════════════════════════════════════
//  PATIENT DASHBOARD
// ════════════════════════════════════════════

async function showPatientDash() {
  hide("authScreen"); hide("doctorAdmin");
  show("patientDash");
  setNavUser();
  showChatFab();
  document.getElementById("pDate").min = new Date().toISOString().split("T")[0];
  try {
    allDoctors = await get("/api/doctors");
    const sel  = document.getElementById("doctorSelect");
    sel.innerHTML = `<option value="">— choose a doctor —</option>`;
    allDoctors.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.name + " — " + d.specialty;
      sel.appendChild(opt);
    });
  } catch(e) { toast("Could not load doctors", "error"); }
  await loadPatientAppts();
}

async function bookAppointment() {
  const doctorId = val("doctorSelect"), date = val("pDate"),
        timeSlot = val("slotSelect"),   notes = val("pNotes");
  if (!doctorId) return toast("Please select a doctor", "error");
  if (!date)     return toast("Please choose a date", "error");
  if (!timeSlot) return toast("Please choose a time slot", "error");

  const btn = document.getElementById("bookBtn");
  btn.innerHTML = "⏳ Booking...";
  btn.disabled  = true;

  try {
    await post("/api/appointments/book", { doctor_id: doctorId, date, time_slot: timeSlot, notes });
    toast("Appointment booked successfully ✓", "success");
    document.getElementById("doctorSelect").value = "";
    document.getElementById("pDate").value        = "";
    document.getElementById("slotSelect").value   = "";
    document.getElementById("pNotes").value       = "";
    await loadPatientAppts();
  } catch(e) {
    toast(e.message, "error");
  } finally {
    btn.innerHTML = "📅 Book Appointment";
    btn.disabled  = false;
  }
}

async function loadPatientAppts() {
  const tbody = document.getElementById("patientTableBody");
  tbody.innerHTML = `<tr><td colspan="8" style="color:var(--text-2)">Loading...</td></tr>`;
  try {
    const appts = await get("/api/appointments/patient");
    if (!appts.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--text-2);text-align:center;padding:28px">No appointments yet. Book your first one!</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    appts.forEach(a => {
      const tr = document.createElement("tr");
      const callBtn = a.status === "upcoming"
        ? `<button class="tbl-btn tbl-blue" onclick="joinCall('${a.id}')">&#128247; Join Call</button>`
        : "—";
      tr.innerHTML = `
        <td><strong>${a.doctorName||"—"}</strong></td>
        <td>${a.specialty||"—"}</td>
        <td>${fmtDate(a.date)}</td>
        <td>${a.time_slot}</td>
        <td><span class="chip chip-${a.status}">${a.status}</span></td>
        <td>${callBtn}</td>
        <td>${a.status==="upcoming"
          ? `<button class="tbl-btn tbl-red" onclick="cancelAppt('${a.id}',this)">Cancel</button>`
          : "—"}</td>`;
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red)">Failed to load appointments.</td></tr>`;
  }
}

async function cancelAppt(id, btn) {
  btn.disabled = true;
  try {
    await post("/api/appointments/" + id + "/cancel");
    toast("Appointment cancelled", "success");
    await loadPatientAppts();
  } catch(e) { toast(e.message, "error"); btn.disabled = false; }
}

// ════════════════════════════════════════════
//  DOCTOR ADMIN
// ════════════════════════════════════════════

async function showDoctorAdmin() {
  hide("authScreen"); hide("patientDash");
  show("doctorAdmin");
  setNavUser();
  showChatFab();
  try {
    allDoctors = await get("/api/doctors");
    const sel  = document.getElementById("adminDoctorFilter");
    sel.innerHTML = `<option value="">All Doctors</option>`;
    allDoctors.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.id; opt.textContent = d.name;
      if (d.email === currentUser.email) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch(e) { toast("Could not load doctors", "error"); }
  await loadAdminStats();
  await loadAdminAppts();
}

async function loadAdminStats() {
  try {
    const s = await get("/api/admin/stats");
    document.getElementById("aTotal").textContent    = s.total;
    document.getElementById("aToday").textContent    = s.today;
    document.getElementById("aUpcoming").textContent = s.upcoming;
    document.getElementById("aPatients").textContent = s.patients;
  } catch {}
}

async function loadAdminAppts() {
  const tbody    = document.getElementById("adminTableBody");
  const doctorId = val("adminDoctorFilter");
  tbody.innerHTML = `<tr><td colspan="9" style="color:var(--text-2)">Loading...</td></tr>`;
  try {
    const url   = "/api/admin/appointments" + (doctorId ? "?doctor_id=" + doctorId : "");
    const appts = await get(url);
    if (!appts.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="color:var(--text-2);text-align:center;padding:28px">No appointments found.</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    appts.forEach(a => {
      const tr = document.createElement("tr");
      const adminCallBtn = a.status === "upcoming"
        ? `<button class="tbl-btn tbl-blue" onclick="joinCall('${a.id}')">&#128247; Join</button>`
        : "—";
      tr.innerHTML = `
        <td><strong>${a.patient_name||"—"}</strong></td>
        <td>${a.patient_email||"—"}</td>
        <td>${a.doctorName||"—"}</td>
        <td>${fmtDate(a.date)}</td>
        <td>${a.time_slot}</td>
        <td>${a.notes||"—"}</td>
        <td><span class="chip chip-${a.status}">${a.status}</span></td>
        <td>${adminCallBtn}</td>
        <td><div class="tbl-actions">
          ${a.status==="upcoming" ? `<button class="tbl-btn tbl-green" onclick="markDone('${a.id}',this)">&#10003; Done</button>` : ""}
          ${a.status!=="cancelled" ? `<button class="tbl-btn tbl-red" onclick="adminCancel('${a.id}',this)">Cancel</button>` : ""}
        </div></td>`;
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--red)">Failed to load.</td></tr>`;
  }
}

async function markDone(id, btn) {
  btn.disabled = true;
  try {
    await post("/api/admin/appointments/" + id + "/done");
    toast("Marked as done", "success");
    await loadAdminAppts(); await loadAdminStats();
  } catch(e) { toast(e.message, "error"); btn.disabled = false; }
}

async function adminCancel(id, btn) {
  btn.disabled = true;
  try {
    await post("/api/appointments/" + id + "/cancel");
    toast("Cancelled", "success");
    await loadAdminAppts(); await loadAdminStats();
  } catch(e) { toast(e.message, "error"); btn.disabled = false; }
}

// ── Nav ──────────────────────────────────────
function setNavUser() {
  const role = currentUser.role === "doctor" ? "Doctor" : "Patient";
  document.getElementById("navUser").innerHTML =
    `<span class="nu-name">${currentUser.name}</span>
     <span class="nu-role">${role}</span>
     <button class="nu-logout" onclick="logout()">Logout</button>`;
}

// ── Init ─────────────────────────────────────
async function init() {
  const token = loadToken();
  if (!token) { showLanding(); return; }
  try {
    const data  = await get("/api/auth/me");
    currentUser = data.user;
    showShell();
    if (currentUser.role === "patient")     await showPatientDash();
    else if (currentUser.role === "doctor") await showDoctorAdmin();
  } catch {
    clearToken();
    showLanding();
  }
}

init();

// ════════════════════════════════════════════
//  VIDEO CALL
// ════════════════════════════════════════════

let _peer         = null;
let _localStream  = null;
let _activeCall   = null;
let _callRoomData = null;
let _pipDragging  = false;
let _dataConn     = null;
let _callChatOpen = false;
let _callChatUnread = 0;

async function joinCall(apptId) {
  try {
    const room = await get(`/api/call/room/${apptId}`);
    _callRoomData = room;
    await startCallScreen(room);
  } catch(e) {
    toast("Could not join call: " + e.message, "error");
  }
}

async function startCallScreen(room) {
  // Show call screen
  show("callScreen");
  document.getElementById("callScreen").classList.remove("hidden");

  // Set appointment info in header
  document.getElementById("callApptInfo").textContent =
    room.date + " at " + room.time_slot +
    (room.patient_name ? "  ·  " + room.patient_name : "");

  setCallStatus("connecting", "Connecting...");
  setWaiting(true, "Starting camera...");

  // Get local media
  try {
    _localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("localVideo").srcObject = _localStream;
  } catch(e) {
    toast("Camera/mic access denied. Please allow permissions.", "error");
    setWaiting(true, "⚠️ Camera access denied. Check browser permissions.");
    return;
  }

  setWaiting(true, "Waiting for the other person to join...");
  setCallStatus("connecting", "Waiting...");

  // Init PeerJS with the deterministic peer ID
  _peer = new Peer(room.peer_id, {
    host: "0.peerjs.com",
    port: 443,
    secure: true,
    path: "/",
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ]
    }
  });

  _peer.on("open", (id) => {
    console.log("[DocDrop Call] My peer ID:", id);

    if (room.role === "doctor") {
      // Doctor: wait for patient to call in AND accept data connection
      setWaiting(true, "Waiting for patient to join...");
      _peer.on("call", (call) => {
        _activeCall = call;
        call.answer(_localStream);
        handleCallStream(call, room.patient_name || "Patient");
      });
      _peer.on("connection", (conn) => {
        _dataConn = conn;
        setupDataConn(conn, room.patient_name || "Patient");
      });
    } else {
      // Patient: call the doctor and open data channel
      setWaiting(true, "Calling doctor...");
      const call = _peer.call(room.other_peer_id, _localStream);
      if (!call) {
        setWaiting(true, "⚠️ Could not reach doctor. Make sure they joined first.");
        return;
      }
      _activeCall = call;
      handleCallStream(call, "Doctor");
      // Open data channel to doctor
      const conn = _peer.connect(room.other_peer_id, { reliable: true });
      _dataConn = conn;
      setupDataConn(conn, "Doctor");
    }
  });

  _peer.on("error", (err) => {
    console.error("[DocDrop Call] PeerJS error:", err);
    if (err.type === "peer-unavailable") {
      setWaiting(true, "The other person hasn't joined yet. They'll connect automatically when they do.");
      // Retry after 4s
      setTimeout(() => {
        if (_peer && !_activeCall) {
          if (room.role === "patient") {
            const call = _peer.call(room.other_peer_id, _localStream);
            if (call) { _activeCall = call; handleCallStream(call, "Doctor"); }
          }
        }
      }, 4000);
    } else {
      setWaiting(true, "⚠️ Connection error: " + err.type + ". Try refreshing.");
    }
  });

  _peer.on("disconnected", () => {
    setCallStatus("connecting", "Reconnecting...");
    _peer.reconnect();
  });
}

function handleCallStream(call, remoteName) {
  call.on("stream", (remoteStream) => {
    document.getElementById("remoteVideo").srcObject = remoteStream;
    document.getElementById("remoteName").textContent = remoteName;
    setWaiting(false);
    setCallStatus("connected", "In call · " + remoteName);
  });

  call.on("close", () => {
    setCallStatus("ended", "Call ended");
    setWaiting(true, "The other person has left the call.");
    document.getElementById("remoteVideo").srcObject = null;
  });

  call.on("error", (err) => {
    console.error("[DocDrop Call] Call error:", err);
    toast("Call error: " + err.message, "error");
  });
}

function endCall() {
  if (_dataConn)     { _dataConn.close();    _dataConn    = null; }
  if (_activeCall)   { _activeCall.close();  _activeCall  = null; }
  if (_peer)         { _peer.destroy();       _peer        = null; }
  if (_localStream)  {
    _localStream.getTracks().forEach(t => t.stop());
    _localStream = null;
  }
  document.getElementById("localVideo").srcObject  = null;
  document.getElementById("remoteVideo").srcObject = null;
  // Reset call chat state
  _callChatOpen   = false;
  _callChatUnread = 0;
  hide("callChatSidebar");
  document.getElementById("callChatMessages").innerHTML =
    `<div class="call-chat-info">Messages are only visible during this call and are not saved.</div>`;
  const badge = document.getElementById("callChatBadge");
  if (badge) badge.remove();
  hide("callScreen");
  toast("Call ended", "success");
}

function toggleMic() {
  if (!_localStream) return;
  const track = _localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = document.getElementById("btnMic");
  btn.textContent = track.enabled ? "🎙️" : "🔇";
  btn.classList.toggle("muted", !track.enabled);
}

function toggleCam() {
  if (!_localStream) return;
  const track = _localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = document.getElementById("btnCam");
  btn.textContent = track.enabled ? "📷" : "🚫";
  btn.classList.toggle("muted", !track.enabled);
}

function setCallStatus(state, text) {
  const el = document.getElementById("callStatus");
  el.className = "call-status " + state;
  document.getElementById("callStatusText").textContent = text;
}

function setWaiting(show, text) {
  const overlay = document.getElementById("waitingOverlay");
  if (show) {
    overlay.classList.remove("hidden");
    if (text) document.getElementById("waitingText").textContent = text;
  } else {
    overlay.classList.add("hidden");
  }
}

// Draggable local video PiP
(function initPip() {
  let el, dragging = false, ox, oy;
  document.addEventListener("DOMContentLoaded", () => {
    el = document.querySelector(".video-local");
    if (!el) return;
    el.addEventListener("mousedown", (e) => {
      dragging = true;
      const r = el.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      el.style.cursor = "grabbing";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const pw = el.parentElement.offsetWidth;
      const ph = el.parentElement.offsetHeight;
      let x = e.clientX - ox;
      let y = e.clientY - oy;
      x = Math.max(8, Math.min(pw - el.offsetWidth  - 8, x));
      y = Math.max(8, Math.min(ph - el.offsetHeight - 8, y));
      el.style.right  = "auto";
      el.style.bottom = "auto";
      el.style.left   = x + "px";
      el.style.top    = y + "px";
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
      if (el) el.style.cursor = "grab";
    });
  });
})();

// ════════════════════════════════════════════
//  DOCDROP AI CHATBOT
// ════════════════════════════════════════════

let _chatOpen     = false;
let _chatHistory  = [];   // [{role, content}]
let _chatLoading  = false;

// Show/hide the FAB when the user is logged in
function showChatFab() {
  show("chatFab");
}
function hideChatFab() {
  hide("chatFab");
  if (_chatOpen) closeChat();
}

function toggleChat() {
  if (_chatOpen) closeChat();
  else           openChat();
}

function openChat() {
  _chatOpen = true;
  show("chatPanel");
  hide("chatUnread");
  document.getElementById("chatPanel").classList.remove("hidden");
  // Update subtitle based on user role
  if (currentUser) {
    const role = currentUser.role === "doctor" ? "Clinical assistant" : "Your medical assistant";
    document.getElementById("chatSubtitle").textContent = role;
    const welcomeMsg = currentUser.role === "doctor"
      ? `Hi Dr. ${currentUser.name.split(" ")[0]}! I have access to your appointment schedule and can help you manage your day.`
      : `Hi ${currentUser.name.split(" ")[0]}! I'm your DocDrop AI assistant. I have access to your appointments and can help you prepare for visits or answer health questions.`;
    document.getElementById("chatWelcomeText").textContent = welcomeMsg;
    // Role-specific suggestions
    if (currentUser.role === "doctor") {
      document.getElementById("chatSuggestions").innerHTML = `
        <button onclick="sendSuggestion(this)">Show today's appointments</button>
        <button onclick="sendSuggestion(this)">Summarise upcoming schedule</button>
        <button onclick="sendSuggestion(this)">Any appointments needing attention?</button>`;
    }
  }
  setTimeout(() => document.getElementById("chatInput").focus(), 200);
}

function closeChat() {
  _chatOpen = false;
  hide("chatPanel");
}

function clearChat() {
  _chatHistory = [];
  const msgs = document.getElementById("chatMessages");
  msgs.innerHTML = `
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
  // Remove suggestion chips once one is clicked
  const sugg = document.getElementById("chatSuggestions");
  if (sugg) sugg.remove();
  // Also remove the welcome wrapper if it exists and is empty
  const welcome = document.querySelector(".chat-welcome");
  if (welcome) welcome.remove();
  sendMessage(text);
}

function chatKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function autoResizeChatInput(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 100) + "px";
}

function sendChatMessage() {
  const input = document.getElementById("chatInput");
  const text  = input.value.trim();
  if (!text || _chatLoading) return;
  input.value = "";
  input.style.height = "auto";
  // Remove welcome block if still there
  const welcome = document.querySelector(".chat-welcome");
  if (welcome) welcome.remove();
  sendMessage(text);
}

async function sendMessage(text) {
  if (_chatLoading) return;
  _chatLoading = true;

  // Add user bubble
  appendChatBubble("user", text);
  _chatHistory.push({ role: "user", content: text });

  // Disable send
  document.getElementById("chatSendBtn").disabled = true;

  // Show typing indicator
  const typingId = addTypingIndicator();

  try {
    const data = await post("/api/chat", { messages: _chatHistory });
    removeTypingIndicator(typingId);
    const reply = data.reply;
    _chatHistory.push({ role: "assistant", content: reply });
    appendChatBubble("ai", reply);
    // If chat is closed, show unread badge
    if (!_chatOpen) {
      show("chatUnread");
    }
  } catch (e) {
    removeTypingIndicator(typingId);
    appendChatError(e.message || "Sorry, I couldn't get a response. Please try again.");
    // Remove last user message from history to allow retry
    _chatHistory.pop();
  } finally {
    _chatLoading = false;
    document.getElementById("chatSendBtn").disabled = false;
    document.getElementById("chatInput").focus();
  }
}

function appendChatBubble(role, text) {
  const msgs  = document.getElementById("chatMessages");
  const wrap  = document.createElement("div");
  wrap.className = "chat-msg " + role;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  // Render markdown-like text (bold, lists, line breaks)
  bubble.innerHTML = formatChatText(text);

  const time = document.createElement("div");
  time.className  = "chat-time";
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendChatError(msg) {
  const msgs = document.getElementById("chatMessages");
  const el   = document.createElement("div");
  el.className   = "chat-error";
  el.textContent = "⚠️ " + msg;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTypingIndicator() {
  const msgs = document.getElementById("chatMessages");
  const el   = document.createElement("div");
  const id   = "typing_" + Date.now();
  el.id        = id;
  el.className = "chat-typing";
  el.innerHTML = "<span></span><span></span><span></span>";
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatChatText(text) {
  // Escape HTML
  let safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold: **text**
  safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Bullet lists
  safe = safe.replace(/^[-•] (.+)$/gm, "<li>$1</li>");
  safe = safe.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
  // Numbered lists
  safe = safe.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  // Paragraphs from double newlines
  safe = safe.replace(/\n\n/g, "</p><p>");
  // Single newlines
  safe = safe.replace(/\n/g, "<br>");
  return "<p>" + safe + "</p>";
}

// ── Chatbot FAB hooks are called directly from showPatientDash, showDoctorAdmin, logout ──

// ════════════════════════════════════════════
//  IN-CALL CHAT (PeerJS DataConnection)
// ════════════════════════════════════════════

function setupDataConn(conn, remoteName) {
  conn.on("open", () => {
    console.log("[DocDrop Chat] Data channel open with", remoteName);
    appendCallSystemMsg(remoteName + " connected to chat");
  });

  conn.on("data", (data) => {
    try {
      const msg = typeof data === "string" ? JSON.parse(data) : data;
      appendCallChatBubble("them", msg.text, msg.sender || remoteName);
      // If sidebar is closed, show unread badge on the Chat button
      if (!_callChatOpen) {
        _callChatUnread++;
        renderCallChatBadge();
      }
    } catch(e) {
      console.error("[DocDrop Chat] Bad message:", e);
    }
  });

  conn.on("close", () => {
    appendCallSystemMsg(remoteName + " left the chat");
  });

  conn.on("error", (err) => {
    console.error("[DocDrop Chat] Data conn error:", err);
  });
}

function toggleCallChat() {
  _callChatOpen = !_callChatOpen;
  const sidebar = document.getElementById("callChatSidebar");
  if (_callChatOpen) {
    sidebar.classList.remove("hidden");
    // Clear unread
    _callChatUnread = 0;
    renderCallChatBadge();
    setTimeout(() => document.getElementById("callChatInput").focus(), 150);
    // Scroll to bottom
    const msgs = document.getElementById("callChatMessages");
    msgs.scrollTop = msgs.scrollHeight;
  } else {
    sidebar.classList.add("hidden");
  }
  // Update button active state
  const btn = document.getElementById("btnChat");
  btn.classList.toggle("muted", _callChatOpen);
}

function renderCallChatBadge() {
  const btn = document.getElementById("btnChat");
  let badge = document.getElementById("callChatBadge");
  if (_callChatUnread > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "callChatBadge";
      badge.className = "cbtn-chat-badge";
      btn.style.position = "relative";
      btn.appendChild(badge);
    }
    badge.textContent = _callChatUnread > 9 ? "9+" : _callChatUnread;
  } else {
    if (badge) badge.remove();
  }
}

function sendCallChatMessage() {
  const input = document.getElementById("callChatInput");
  const text  = input.value.trim();
  if (!text) return;

  if (!_dataConn || _dataConn.open === false) {
    // Gracefully show the message locally even if data channel isn't ready
    appendCallChatBubble("me", text, "You");
    input.value = "";
    appendCallSystemMsg("⚠️ Other party may not be connected to chat yet.");
    return;
  }

  const payload = {
    text:   text,
    sender: currentUser ? currentUser.name : "You",
    ts:     Date.now(),
  };

  try {
    _dataConn.send(JSON.stringify(payload));
    appendCallChatBubble("me", text, "You");
    input.value = "";
    // Scroll to bottom
    const msgs = document.getElementById("callChatMessages");
    msgs.scrollTop = msgs.scrollHeight;
  } catch(e) {
    appendCallSystemMsg("⚠️ Could not send message: " + e.message);
  }
}

function appendCallChatBubble(side, text, senderName) {
  const msgs = document.getElementById("callChatMessages");
  const wrap = document.createElement("div");
  wrap.className = "cc-msg " + side;

  const bubble = document.createElement("div");
  bubble.className = "cc-bubble";
  bubble.textContent = text;

  const meta = document.createElement("div");
  meta.className = "cc-meta";
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  meta.textContent = (side === "them" ? senderName + "  ·  " : "") + timeStr;

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendCallSystemMsg(text) {
  const msgs = document.getElementById("callChatMessages");
  const el   = document.createElement("div");
  el.className   = "cc-system";
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}
