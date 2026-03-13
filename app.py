from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
import bcrypt, os, jwt, random, string, smtplib, json
from email.mime.text import MIMEText
from datetime import datetime, timedelta
import google.generativeai as genai

load_dotenv()

app    = Flask(__name__, static_folder="static", static_url_path="/static")
SECRET = os.getenv("SECRET_KEY", "dev-secret-key")
CORS(app)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# ── Email / OTP config ────────────────────────
SMTP_HOST  = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT  = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER  = os.getenv("SMTP_USER", "")
SMTP_PASS  = os.getenv("SMTP_PASS", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER)

# In-memory OTP store: email -> {otp, expires, name}
otp_store = {}

def generate_otp():
    return "".join(random.choices(string.digits, k=6))

def send_otp_email(to_email, otp, name):
    """Send OTP via SMTP. In dev (no SMTP config), logs to console and returns True."""
    subject = "DocDrop – Your verification code"
    body    = f"""Hi {name},

Your DocDrop signup verification code is:

    {otp}

This code expires in 10 minutes. If you didn't request this, ignore this email.

– DocDrop Team"""
    if not SMTP_USER or not SMTP_PASS:
        # Dev mode: print to console so the developer can see the OTP
        print(f"\n[DEV] OTP for {to_email}: {otp}\n", flush=True)
        return True
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"]    = FROM_EMAIL
        msg["To"]      = to_email
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(FROM_EMAIL, [to_email], msg.as_string())
        return True
    except Exception as e:
        print(f"[Email error] {e}")
        return False

client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"))
db     = client[os.getenv("DB_NAME", "docdrop")]

doctors_col      = db["doctors"]
patients_col     = db["patients"]
appointments_col = db["appointments"]

# ── Seed doctors ──────────────────────────────
DOCTORS_SEED = [
    {"name":"Dr. Sarah Chen",  "specialty":"General",     "email":"sarah@docdrop.com",  "initials":"SC","color":"#c8f135","colorBg":"rgba(200,241,53,0.12)"},
    {"name":"Dr. Marcus Webb", "specialty":"Cardiology",  "email":"marcus@docdrop.com", "initials":"MW","color":"#ff4ecd","colorBg":"rgba(255,78,205,0.12)"},
    {"name":"Dr. Priya Nair",  "specialty":"Dermatology", "email":"priya@docdrop.com",  "initials":"PN","color":"#4f8bff","colorBg":"rgba(79,139,255,0.12)"},
    {"name":"Dr. James Okon",  "specialty":"Neurology",   "email":"james@docdrop.com",  "initials":"JO","color":"#ff7a35","colorBg":"rgba(255,122,53,0.12)"},
    {"name":"Dr. Lena Müller", "specialty":"Pediatrics",  "email":"lena@docdrop.com",   "initials":"LM","color":"#2dd4bf","colorBg":"rgba(45,212,191,0.12)"},
    {"name":"Dr. Ravi Patel",  "specialty":"Orthopedics", "email":"ravi@docdrop.com",   "initials":"RP","color":"#a78bfa","colorBg":"rgba(167,139,250,0.12)"},
]

def seed_doctors():
    for d in DOCTORS_SEED:
        if not doctors_col.find_one({"email": d["email"]}):
            d["password"] = bcrypt.hashpw("doc123".encode(), bcrypt.gensalt())
            doctors_col.insert_one(d)
    print("Doctors seeded")

seed_doctors()

# ── JWT ───────────────────────────────────────
def make_token(payload):
    payload["exp"] = datetime.utcnow() + timedelta(days=7)
    return jwt.encode(payload, SECRET, algorithm="HS256")

def get_current_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        return jwt.decode(auth.split(" ", 1)[1], SECRET, algorithms=["HS256"])
    except Exception:
        return None

def require_auth(role=None):
    user = get_current_user()
    if not user:
        return jsonify({"error": "Not logged in"}), 401
    if role and user.get("role") != role:
        return jsonify({"error": "Forbidden"}), 403
    return None

def serialize(doc):
    doc["id"] = str(doc.pop("_id"))
    doc.pop("password", None)
    return doc

# ── Frontend ──────────────────────────────────
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

# ── Auth ──────────────────────────────────────
@app.route("/api/auth/signup", methods=["POST"])
def signup():
    data  = request.json
    name  = data.get("name","").strip()
    email = data.get("email","").strip().lower()
    pw    = data.get("password","")
    otp   = data.get("otp","").strip()

    if not email or not pw:
        return jsonify({"error":"Email and password required"}), 400
    if len(pw) < 4:
        return jsonify({"error":"Password must be at least 4 characters"}), 400
    if patients_col.find_one({"email":email}):
        return jsonify({"error":"Account already exists"}), 409

    entry = otp_store.get(email)
    if not entry:
        return jsonify({"error":"No OTP sent. Please request a code first."}), 400
    if datetime.utcnow() > entry["expires"]:
        otp_store.pop(email, None)
        return jsonify({"error":"OTP expired. Please request a new one."}), 400
    if entry["otp"] != otp:
        return jsonify({"error":"Incorrect verification code."}), 400

    otp_store.pop(email, None)

    hashed = bcrypt.hashpw(pw.encode(), bcrypt.gensalt())
    res    = patients_col.insert_one({"name":name or email.split("@")[0],"email":email,"password":hashed,"created_at":datetime.utcnow()})
    p      = patients_col.find_one({"_id":res.inserted_id})
    user   = {"id":str(p["_id"]),"name":p["name"],"email":email,"role":"patient"}
    return jsonify({"ok":True,"token":make_token(user.copy()),"user":user}), 201


@app.route("/api/auth/send-otp", methods=["POST"])
def send_otp():
    data  = request.json
    email = data.get("email","").strip().lower()
    name  = data.get("name","").strip() or email.split("@")[0]

    if not email:
        return jsonify({"error":"Email required"}), 400
    if patients_col.find_one({"email":email}):
        return jsonify({"error":"Account already exists with this email."}), 409

    otp = generate_otp()
    otp_store[email] = {
        "otp":     otp,
        "expires": datetime.utcnow() + timedelta(minutes=10),
        "name":    name,
    }

    ok = send_otp_email(email, otp, name)
    if not ok:
        otp_store.pop(email, None)
        return jsonify({"error":"Failed to send verification email. Check SMTP settings."}), 500

    return jsonify({"ok": True})


@app.route("/api/auth/login/patient", methods=["POST"])
def login_patient():
    data  = request.json
    email = data.get("email","").strip().lower()
    pw    = data.get("password","")
    p     = patients_col.find_one({"email":email})
    if not p:                                           return jsonify({"error":"No account found"}), 404
    if not bcrypt.checkpw(pw.encode(), p["password"]): return jsonify({"error":"Wrong password"}), 401
    user = {"id":str(p["_id"]),"name":p["name"],"email":email,"role":"patient"}
    return jsonify({"ok":True,"token":make_token(user.copy()),"user":user})

@app.route("/api/auth/login/doctor", methods=["POST"])
def login_doctor():
    data  = request.json
    email = data.get("email","").strip().lower()
    pw    = data.get("password","")
    d     = doctors_col.find_one({"email":email})
    if not d:                                           return jsonify({"error":"Doctor not found"}), 404
    if not bcrypt.checkpw(pw.encode(), d["password"]): return jsonify({"error":"Wrong password"}), 401
    user = {"id":str(d["_id"]),"name":d["name"],"email":email,"role":"doctor"}
    return jsonify({"ok":True,"token":make_token(user.copy()),"user":user})

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    return jsonify({"ok":True})

@app.route("/api/auth/me", methods=["GET"])
def me():
    user = get_current_user()
    if not user: return jsonify({"error":"Not logged in"}), 401
    return jsonify({"user":user})

# ── Doctors ───────────────────────────────────
@app.route("/api/doctors", methods=["GET"])
def get_doctors():
    docs = list(doctors_col.find({},{"password":0}))
    return jsonify([serialize(d) for d in docs])

# ── Appointments: patient ─────────────────────
@app.route("/api/appointments/patient", methods=["GET"])
def patient_appointments():
    err = require_auth("patient")
    if err: return err
    user  = get_current_user()
    appts = list(appointments_col.find({"patient_id":user["id"]}))
    result = []
    for a in appts:
        a["id"] = str(a.pop("_id"))
        try:
            doc = doctors_col.find_one({"_id":ObjectId(a["doctor_id"])},{"password":0})
            if doc: a["doctorName"]=doc["name"]; a["specialty"]=doc["specialty"]
        except: pass
        result.append(a)
    result.sort(key=lambda x:(x["date"],x["time_slot"]))
    return jsonify(result)

@app.route("/api/appointments/book", methods=["POST"])
def book_appointment():
    err = require_auth("patient")
    if err: return err
    user      = get_current_user()
    data      = request.json
    doctor_id = data.get("doctor_id")
    date      = data.get("date")
    time_slot = data.get("time_slot")
    notes     = data.get("notes","").strip()
    if not doctor_id or not date or not time_slot:
        return jsonify({"error":"doctor_id, date and time_slot required"}), 400
    try:    doctor = doctors_col.find_one({"_id":ObjectId(doctor_id)})
    except: return jsonify({"error":"Invalid doctor id"}), 400
    if not doctor: return jsonify({"error":"Doctor not found"}), 404
    if appointments_col.find_one({"doctor_id":doctor_id,"date":date,"time_slot":time_slot,"status":{"$ne":"cancelled"}}):
        return jsonify({"error":"That slot is already booked"}), 409
    res  = appointments_col.insert_one({"doctor_id":doctor_id,"patient_id":user["id"],"patient_name":user["name"],"patient_email":user["email"],"date":date,"time_slot":time_slot,"notes":notes,"status":"upcoming","created_at":datetime.utcnow()})
    appt = appointments_col.find_one({"_id":res.inserted_id})
    appt["id"]=str(appt.pop("_id")); appt["doctorName"]=doctor["name"]; appt["specialty"]=doctor["specialty"]
    return jsonify(appt), 201

@app.route("/api/appointments/<appt_id>/cancel", methods=["POST"])
def cancel_appointment(appt_id):
    err = require_auth()
    if err: return err
    user = get_current_user()
    try:    appt = appointments_col.find_one({"_id":ObjectId(appt_id)})
    except: return jsonify({"error":"Invalid id"}), 400
    if not appt: return jsonify({"error":"Not found"}), 404
    if user["role"]=="patient" and appt["patient_id"]!=user["id"]:
        return jsonify({"error":"Forbidden"}), 403
    appointments_col.update_one({"_id":ObjectId(appt_id)},{"$set":{"status":"cancelled"}})
    return jsonify({"ok":True})

# ── Appointments: doctor admin ────────────────
@app.route("/api/admin/appointments", methods=["GET"])
def admin_all_appointments():
    err = require_auth("doctor")
    if err: return err
    q = {"status":{"$ne":"cancelled"}}
    if request.args.get("doctor_id"): q["doctor_id"]=request.args["doctor_id"]
    appts = list(appointments_col.find(q))
    result = []
    for a in appts:
        a["id"]=str(a.pop("_id"))
        try:
            doc = doctors_col.find_one({"_id":ObjectId(a["doctor_id"])},{"password":0})
            if doc: a["doctorName"]=doc["name"]; a["specialty"]=doc["specialty"]
        except: pass
        result.append(a)
    result.sort(key=lambda x:(x["date"],x["time_slot"]))
    return jsonify(result)

@app.route("/api/admin/appointments/<appt_id>/done", methods=["POST"])
def mark_done(appt_id):
    err = require_auth("doctor")
    if err: return err
    try: appointments_col.update_one({"_id":ObjectId(appt_id)},{"$set":{"status":"done"}})
    except: return jsonify({"error":"Invalid id"}), 400
    return jsonify({"ok":True})

@app.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    err = require_auth("doctor")
    if err: return err
    today = datetime.utcnow().strftime("%Y-%m-%d")
    all_a = list(appointments_col.find({"status":{"$ne":"cancelled"}}))
    return jsonify({"total":len(all_a),"today":sum(1 for a in all_a if a.get("date")==today),"upcoming":sum(1 for a in all_a if a.get("date","")>today),"patients":len(set(a["patient_id"] for a in all_a))})

@app.route("/api/slots/taken", methods=["GET"])
def taken_slots():
    did  = request.args.get("doctor_id")
    date = request.args.get("date")
    if not did or not date: return jsonify({"error":"doctor_id and date required"}), 400
    taken = appointments_col.find({"doctor_id":did,"date":date,"status":{"$ne":"cancelled"}},{"time_slot":1})
    return jsonify([t["time_slot"] for t in taken])

# ── Video Call ────────────────────────────────
@app.route("/api/call/room/<appt_id>", methods=["GET"])
def get_call_room(appt_id):
    err = require_auth()
    if err: return err
    user = get_current_user()

    try:
        appt = appointments_col.find_one({"_id": ObjectId(appt_id)})
    except:
        return jsonify({"error": "Invalid appointment id"}), 400
    if not appt:
        return jsonify({"error": "Appointment not found"}), 404

    if user["role"] == "patient" and appt["patient_id"] != user["id"]:
        return jsonify({"error": "Forbidden"}), 403
    if appt.get("status") == "cancelled":
        return jsonify({"error": "Appointment is cancelled"}), 400

    room_id       = f"docdrop-{appt_id}"
    peer_id       = f"{room_id}-{'doc' if user['role'] == 'doctor' else 'pat'}"
    other_peer_id = f"{room_id}-{'pat' if user['role'] == 'doctor' else 'doc'}"

    return jsonify({
        "room_id":       room_id,
        "peer_id":       peer_id,
        "other_peer_id": other_peer_id,
        "role":          user["role"],
        "appt_id":       appt_id,
        "patient_name":  appt.get("patient_name", "Patient"),
        "date":          appt.get("date"),
        "time_slot":     appt.get("time_slot"),
    })

# ── Chatbot ───────────────────────────────────
@app.route("/api/chat", methods=["POST"])
def chat():
    err = require_auth()
    if err: return err
    user = get_current_user()

    if not GEMINI_API_KEY:
        return jsonify({"error": "Chatbot not configured — add GEMINI_API_KEY to .env"}), 503

    data     = request.json
    messages = data.get("messages", [])
    if not messages:
        return jsonify({"error": "messages required"}), 400

    appt_context = []
    try:
        if user["role"] == "patient":
            appts = list(appointments_col.find({"patient_id": user["id"]}))
        else:
            appts = list(appointments_col.find({"status": {"$ne": "cancelled"}}))

        for a in appts:
            entry = {
                "id":        str(a["_id"]),
                "date":      a.get("date"),
                "time_slot": a.get("time_slot"),
                "status":    a.get("status"),
                "notes":     a.get("notes", ""),
            }
            try:
                doc = doctors_col.find_one({"_id": ObjectId(a["doctor_id"])}, {"password": 0})
                if doc:
                    entry["doctor_name"]      = doc["name"]
                    entry["doctor_specialty"] = doc["specialty"]
            except Exception:
                pass
            if user["role"] == "doctor":
                entry["patient_name"]  = a.get("patient_name")
                entry["patient_email"] = a.get("patient_email")
            appt_context.append(entry)
    except Exception as e:
        print(f"[Chat] Could not load appointments: {e}")

    today_str = datetime.utcnow().strftime("%Y-%m-%d")

    if user["role"] == "patient":
        system_prompt = f"""You are a helpful medical assistant for DocDrop, a telemedicine platform.
You are chatting with a patient named {user['name']} (email: {user['email']}).
Today's date is {today_str}.

Here are their current appointments (JSON):
{json.dumps(appt_context, indent=2)}

You can help the patient with:
- Reviewing their upcoming or past appointments
- Understanding appointment details (date, time, doctor, specialty)
- Advice on what to prepare for their consultation
- General health and wellness guidance (always remind them to consult their doctor for medical decisions)
- Rescheduling or cancellation reminders (guide them to use the dashboard)
- Answering questions about their doctors' specialties
- Providing general information about medical specialties

Always be warm, empathetic, and professional. Keep responses concise and clear.
Never diagnose conditions or prescribe medications. Always recommend professional medical advice for health concerns.
If asked about something outside your scope, politely redirect to their assigned doctor."""

    else:
        system_prompt = f"""You are a clinical assistant for DocDrop, a telemedicine platform.
You are chatting with Dr. {user['name']} (email: {user['email']}).
Today's date is {today_str}.

Here are the upcoming/active appointments you need to manage (JSON):
{json.dumps(appt_context, indent=2)}

You can help the doctor with:
- Reviewing their appointment schedule (upcoming, today, past)
- Summarising patient notes for each appointment
- Identifying appointment conflicts or gaps
- Suggesting preparation tips for specific specialties
- Drafting follow-up reminders or notes
- Providing a daily/weekly schedule overview
- Answering questions about their patient list

Be professional, efficient, and clinically precise. Always maintain patient confidentiality mindset."""

    try:
        model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction=system_prompt,
        )
        gemini_history = []
        for msg in messages[:-1]:
            gemini_history.append({
                "role":  "user" if msg["role"] == "user" else "model",
                "parts": [msg["content"]],
            })
        chat_session = model.start_chat(history=gemini_history)
        response     = chat_session.send_message(messages[-1]["content"])
        reply        = response.text
        return jsonify({"reply": reply})
    except Exception as e:
        print(f"[Chat] Gemini error: {e}")
        return jsonify({"error": "AI service error: " + str(e)}), 500


if __name__ == '__main__':
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
