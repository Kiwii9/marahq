// =====================================================================
//  server.js  —  the whole API in ONE file (Node.js + Express)
//  Run:  npm install   then   npm start   →   http://localhost:3000
//
//  DATA + LOGIN can live in two places (chosen automatically at start-up):
//    • Firebase  → Firebase Authentication (login) + Cloud Firestore (data)
//                  (used when firebase.config.json + serviceAccountKey.json are filled in)
//    • Local     → db.json file + our own password hashing (works with zero setup)
//  The website never talks to Firebase directly: it only calls /api/...
//  Roles:  buyer · seller · admin
// =====================================================================
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "50kb" }));                  // read JSON bodies (we never accept real files)
app.use(express.static(path.join(__dirname, "public")));   // serves the website (public/index.html)

// ---------- 1) STATIC CONTENT (texts the website shows) --------------
const SITE = {
  brand: "مراح كيو",
  nav: [{ label: "الرئيسية", to: "/" }, { label: "عرض الطلب", to: "/orders" }, { label: "تصفح", to: "/browse" }],
  drawer: [{ label: "الرئيسية", to: "/" }, { label: "تصفح المواشي", to: "/browse" }, { label: "طلباتي", to: "/orders" }, { label: "الأسئلة الشائعة", to: "/faq" }],
  dashboards: { buyer: { label: "لوحة المشتري", to: "/buyer" }, seller: { label: "لوحة البائع", to: "/seller" }, admin: { label: "لوحة الإدارة", to: "/admin" } },
  footer: {
    quickTitle: "روابط سريعة", contactTitle: "للتواصل",
    links: [{ label: "الرئيسية", to: "/" }, { label: "تصفح المواشي", to: "/browse" }, { label: "الأسئلة الشائعة", to: "/faq" }, { label: "جدول الطلبات", to: "/orders" }],
    social: [{ label: "إنستغرام", icon: "instagram" }, { label: "واتساب", icon: "whatsapp" }, { label: "تيك توك", icon: "tiktok" }, { label: "إكس", icon: "x" }, { label: "قناة أخرى", icon: "5" }],
  },
  faqTitle: "الأسئلة الشائعة",
  faq: [
    { q: "كم رسوم التسجيل؟", a: "التسجيل مجاني بالكامل." },
    { q: "كم أدفع لتأكيد الحجز؟", a: "5% فقط من قيمة الطلب لتأمين الصفقة." },
    { q: "كيف أستلم طلبي؟", a: "عبر التوصيل لباب المنزل (50 ريال) أو الاستلام الشخصي من البائع مجاناً." },
    { q: "هل البائعون موثّقون؟", a: "نعم، يرفع كل بائع مستنداته ونراجعها قبل تفعيل الحساب." },
  ],
};
const CONTENT = {
  brand: "مراح كيو",
  hero: { title: "سوقك الموثوق لبيع وشراء المواشي والأضاحي", subtitle: "تصفح مربّين موثّقين واحجز أضحيتك أو ماشيتك بثقة، مع ضمان استرداد عند الإخلال بالحجز." },
  howTitle: "طريقة عمل مراح كيو",
  steps: [
    { id: "browse", title: "تصفح", text: "استعرض آلاف المواشي والأضاحي من بائعين موثّقين" },
    { id: "book", title: "احجز", text: "أكّد حجزك بدفع 5% فقط لتأمين الصفقة" },
    { id: "receive", title: "استلم", text: "عبر التوصيل لباب منزلك أو الاستلام الشخصي." },
  ],
  categoriesTitle: "تصفح حسب الفئة",
  latestTitle: "أحدث الإعلانات",
  stats: [
    { value: 0, prefix: "", suffix: " ريال", label: "رسوم تسجيل" },
    { value: 100, prefix: "", suffix: "%", label: "حجز امن" },
    { value: 500, prefix: "+", suffix: "", label: "بائع موثّق" },
  ],
  cta: { title: "جاهز تبدأ؟", button: "سجل الان !" },
  footer: { quickTitle: "روابط سريعة", contactTitle: "للتواصل" },
};
const CATEGORIES = [{ id: "sheep", name: "غنم", image: "category-sheep.png" }, { id: "cattle", name: "بقر", image: "category-cattle.png" }, { id: "camel", name: "حاشي", image: "category-camel.png" }];
const DEFAULT_IMG = { sheep: ["animal-naimi.png", "photo-naimi.png"], cattle: ["animal-ajl-lubani.png", "photo-ajl.png"], camel: ["animal-hashi-lubani.png", "photo-hashi.png"] };
const PRICING = { deliveryFee: 50, vatRate: 0.15, depositRate: 0.05 };
const SELLER_DOCS = {
  solo: [{ kind: "national_id", label: "الهوية الوطنية أو الإقامة" }, { kind: "seller_permit", label: "تصريح البائع" }],
  business: [{ kind: "commercial_register", label: "السجل التجاري" }, { kind: "vat_certificate", label: "شهادة ضريبة القيمة المضافة" }, { kind: "signatory_id", label: "هوية المفوّض بالتوقيع" }],
};
const STATUS = { processing: "قيد التجهيز", shipping: "جاري التوصيل", delivered: "تم التسليم" };

// ---------- helpers ---------------------------------------------------
const hash = (pw, salt = crypto.randomBytes(8).toString("hex")) => salt + ":" + crypto.scryptSync(pw, salt, 32).toString("hex");
const checkPw = (pw, stored) => hash(pw, stored.split(":")[0]) === stored;   // passwords are never stored as plain text
const round2 = (n) => Math.round(n * 100) / 100;
const fail = (res, status, message, field) => res.status(status).json({ error: { message, field } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => { console.error(e); fail(res, 500, "خطأ في الخادم."); });
const PW_OK = (p) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
const PHONE = /^(?:\+966|00966|0)?5\d{8}$/;
const fullName = (u) => (u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.email);
const sellerLabel = (u) => (u.profile && u.profile.businessName) || fullName(u);

// ---------- 2) SEED DATA (first run only) -----------------------------
function seedData() {
  const mk = (id, email, role, profile, status, docs = [], pw) => ({ id, email, role, profile, profileComplete: !!profile, verification: { status, documents: docs, note: "" }, createdAt: "2026-09-01", _pw: pw || crypto.randomBytes(9).toString("base64") + "aA1!" });
  const doc = (kind, label, fileName) => ({ kind, label, fileName, fileSize: 120000, demo: true });
  const users = [
    mk("demo", "demo@marahq.test", "buyer", { firstName: "سارة", lastName: "الدوسري", phone: "0501112223", city: "الرياض" }, "active", [], "Demo@12345"),
    mk("admin", "admin@marahq.test", "admin", { firstName: "مدير", lastName: "المنصة", phone: "0500000000", city: "الدمام" }, "active", [], "Admin@12345"),
    mk("seller-sab3", "seller@marahq.test", "seller", { firstName: "عبدالله", lastName: "السبيعي", phone: "0555550001", city: "الأحساء", sellerType: "business", businessName: "سبع ضلوع", crNumber: "2050123456" }, "active",
      [doc("commercial_register", "السجل التجاري", "cr.pdf"), doc("vat_certificate", "شهادة ضريبة القيمة المضافة", "vat.pdf"), doc("signatory_id", "هوية المفوّض بالتوقيع", "id.pdf")], "Seller@12345"),
    mk("seller-lubani", "lubani@marahq.test", "seller", { firstName: "فهد", lastName: "اللباني", phone: "0555550002", city: "القصيم", sellerType: "business", businessName: "متجر لباني", crNumber: "1010987654" }, "active",
      [doc("commercial_register", "السجل التجاري", "cr.pdf"), doc("vat_certificate", "شهادة ضريبة القيمة المضافة", "vat.pdf"), doc("signatory_id", "هوية المفوّض بالتوقيع", "id.pdf")]),
    mk("seller-hamza", "hamza@marahq.test", "seller", { firstName: "حمزة", lastName: "القحطاني", phone: "0555550003", city: "أبها", sellerType: "solo", businessName: "مزرعة حمزة" }, "active",
      [doc("national_id", "الهوية الوطنية أو الإقامة", "id.png"), doc("seller_permit", "تصريح البائع", "permit.pdf")]),
    mk("seller-new", "pending@marahq.test", "seller", { firstName: "ناصر", lastName: "الراعي", phone: "0555550004", city: "حائل", sellerType: "business", businessName: "مؤسسة الراعي", crNumber: "3030303030" }, "pending_review",
      [doc("commercial_register", "السجل التجاري", "cr-raai.pdf"), doc("vat_certificate", "شهادة ضريبة القيمة المضافة", "vat-raai.pdf"), doc("signatory_id", "هوية المفوّض بالتوقيع", "id-raai.jpg")], "Seller@12345"),
  ];
  const L = (id, name, kind, category, age, price, rating, sellerId, image, photo) => ({ id, name, kind, category, age, price, rating, sellerId, seller: sellerLabel(users.find((u) => u.id === sellerId)), image, photo, status: "active", createdAt: "2026-09-10" });
  const listings = [
    L("naimi", "نعيمي", "خروف نعيمي", "sheep", "8 أشهر", 1750, 3, "seller-sab3", "animal-naimi.png", "photo-naimi.png"),
    L("ajl", "عجل لباني", "عجل لباني", "cattle", "14 شهراً", 3400, 3, "seller-lubani", "animal-ajl-lubani.png", "photo-ajl.png"),
    L("tays", "تيس", "تيس", "sheep", "10 أشهر", 1390, 5, "seller-sab3", "animal-tays.png", "animal-tays.png"),
    L("hashi", "حاشي لباني", "حاشي لباني", "camel", "18 شهراً", 5950, 4, "seller-hamza", "animal-hashi-lubani.png", "photo-hashi.png"),
    L("hori", "حري", "حري", "sheep", "9 أشهر", 1900, 4, "seller-sab3", "animal-hori.png", "animal-hori.png"),
  ];
  const O = (id, listingId, status, address, notes) => ({ id, userId: "demo", listingId, status, date: "2026-09-18", deliveryType: "delivery", phone: "+96651112223333", address, notes });
  const orders = [
    O("ORD-1042", "naimi", "processing", "RRRD2929, النزهة , شارع الملك فهد , 23432", "أريد التسليم قبل الساعة 8 صباحًا، ويفضل أن يكون في يوم السبت."),
    O("ORD-1043", "hashi", "shipping", "EHTP2929، حي الشاطئ، شارع الخليج , 22331", "يرجى الاتصال قبل الوصول."),
    O("ORD-1044", "ajl", "delivered", "RRRD2929, النزهة , شارع الملك فهد , 23432", "أريد التسليم قبل الساعة 8 صباحًا، ويفضل أن يكون في يوم السبت."),
  ];
  return { users, listings, orders };
}

// ---------- 3) STORAGE: one small interface, two implementations -------
//   store.getUser / findUserByEmail / putUser / listUsers
//   store.getListing / putListing / listListings
//   store.getOrder / putOrder / listOrders
let store, FIREBASE = null;

function localStore() {
  const DB_FILE = path.join(__dirname, "db.json");        // everything is saved here so it survives restarts
  let db;
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  else {
    const s = seedData();
    db = { users: s.users.map(({ _pw, ...u }) => ({ ...u, password: hash(_pw) })), listings: s.listings, orders: s.orders };
  }
  const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  const put = (arr, item) => { const i = arr.findIndex((x) => x.id === item.id); i >= 0 ? (arr[i] = item) : arr.push(item); save(); };
  save();
  return {
    mode: "local",
    getUser: async (id) => db.users.find((u) => u.id === id) || null,
    findUserByEmail: async (e) => db.users.find((u) => u.email === e) || null,
    putUser: async (u) => put(db.users, u), listUsers: async () => db.users,
    getListing: async (id) => db.listings.find((l) => l.id === id) || null,
    putListing: async (l) => put(db.listings, l), listListings: async () => db.listings,
    getOrder: async (id) => db.orders.find((o) => o.id === id) || null,
    putOrder: async (o) => put(db.orders, o), listOrders: async () => db.orders,
  };
}

function firebaseStore(admin) {                            // Cloud Firestore: collections "users", "listings", "orders"
  const fsdb = admin.firestore();
  fsdb.settings({ ignoreUndefinedProperties: true });
  const c = (n) => fsdb.collection(n);
  const all = async (n) => (await c(n).get()).docs.map((d) => d.data());
  const one = async (n, id) => { const d = await c(n).doc(String(id)).get(); return d.exists ? d.data() : null; };
  const put = (n, item) => c(n).doc(String(item.id)).set(item);
  return {
    mode: "firebase",
    getUser: (id) => one("users", id),
    findUserByEmail: async (e) => { const q = await c("users").where("email", "==", e).limit(1).get(); return q.empty ? null : q.docs[0].data(); },
    putUser: (u) => put("users", u), listUsers: () => all("users"),
    getListing: (id) => one("listings", id), putListing: (l) => put("listings", l), listListings: () => all("listings"),
    getOrder: (id) => one("orders", id), putOrder: (o) => put("orders", o), listOrders: () => all("orders"),
  };
}

async function seedFirebase(admin, st) {                   // first run on an empty Firestore: create the demo accounts + data
  if ((await st.listUsers()).length) return;
  console.log("Firebase is empty — creating demo accounts and data…");
  const s = seedData();
  for (const { _pw, ...u } of s.users) {
    await admin.auth().createUser({ uid: u.id, email: u.email, password: _pw }).catch((e) => { if (e.code !== "auth/uid-already-exists" && e.code !== "auth/email-already-exists") throw e; });
    await st.putUser(u);
  }
  for (const l of s.listings) await st.putListing(l);
  for (const o of s.orders) await st.putOrder(o);
}

// ---------- 4) LOGIN: Firebase Authentication OR local sessions --------
const sessions = new Map();                                // local mode: token -> userId
let fbAdmin = null, fbApiKey = null;
const FB_REST = "https://identitytoolkit.googleapis.com/v1/accounts:";

async function fbCall(url, body) {                         // talks to Firebase Authentication's REST API
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { const e = new Error((d.error && d.error.message) || "FIREBASE_ERROR"); e.code = (e.message || "").split(" ")[0]; throw e; }
  return d;
}
const publicUser = (u) => ({ id: u.id, email: u.email, role: u.role, profileComplete: u.profileComplete, profile: u.profile, verification: u.verification });

async function ensureUser(id, email) {                     // a Firebase Auth account that has no Firestore profile yet
  let u = await store.getUser(id);
  if (!u) { u = { id, email, role: null, profileComplete: false, profile: null, verification: { status: "none", documents: [] }, createdAt: new Date().toISOString().slice(0, 10) }; await store.putUser(u); }
  return u;
}

async function auth(req, res, next) {                      // middleware: "you must be logged in"
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    let uid = null;
    if (FIREBASE) { try { uid = (await fbAdmin.auth().verifyIdToken(token)).uid; } catch { uid = null; } }
    else uid = sessions.get(token);
    const user = uid && (await store.getUser(uid));
    if (!user) return fail(res, 401, "سجّل الدخول للمتابعة.");
    req.user = user; next();
  } catch (e) { console.error(e); fail(res, 500, "خطأ في الخادم."); }
}
const only = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : fail(res, 403, "ليس لديك صلاحية لهذه الصفحة."));

// ---------- 5) PRICING + VIEWS ----------------------------------------
async function orderView(o) {                              // the SERVER calculates prices, never the browser
  const l = await store.getListing(o.listingId);
  const deliveryFee = o.deliveryType === "delivery" ? PRICING.deliveryFee : 0;
  const vat = round2(l.price * PRICING.vatRate);
  const total = round2(l.price + deliveryFee + vat);
  return { ...o, statusLabel: STATUS[o.status], listing: l,
    deliveryLabel: o.deliveryType === "delivery" ? "توصيل لموقع المشتري" : "استلام شخصي من البائع",
    pricing: { price: l.price, deliveryFee, vat, total, deposit: round2(total * PRICING.depositRate) } };
}
const byNewest = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);   // stable: same day keeps the original order
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.id.replace(/\D/g, "")) - Number(a.id.replace(/\D/g, "")));
const countBy = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});

// ---------- 6) PUBLIC ROUTES (no login needed) -----------------------
app.get("/api/site", (_req, res) => res.json(SITE));
app.get("/api/content", wrap(async (_req, res) => {
  const ls = (await store.listListings()).filter((l) => l.status === "active");
  res.json({ ...CONTENT, categories: CATEGORIES.map((c) => ({ ...c, count: ls.filter((l) => l.category === c.id).length })) });
}));
app.get("/api/listings", wrap(async (req, res) => {
  const ls = (await store.listListings()).filter((l) => l.status === "active" && (!req.query.category || l.category === req.query.category));
  res.json(ls.sort(byNewest));
}));
app.get("/api/pricing", (_req, res) => res.json(PRICING));
app.get("/api/seller-documents", (_req, res) => res.json(SELLER_DOCS));
app.get("/api/health", (_req, res) => res.json({ ok: true, storage: store.mode }));

// ---------- 7) ACCOUNTS ----------------------------------------------
const loginOk = (res, user, extra, code = 200) => res.status(code).json({ ...extra, user: publicUser(user) });

app.post("/api/auth/register", wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase(), pw = String(req.body.password || "");
  if (!/^\S+@\S+\.\S+$/.test(email)) return fail(res, 400, "البريد الإلكتروني غير صالح.", "email");
  if (!PW_OK(pw)) return fail(res, 400, "كلمة المرور لا تحقق الشروط.", "password");
  if (FIREBASE) {
    try {
      const d = await fbCall(`${FB_REST}signUp?key=${fbApiKey}`, { email, password: pw, returnSecureToken: true });
      const user = await ensureUser(d.localId, email);
      return loginOk(res, user, { token: d.idToken, refreshToken: d.refreshToken }, 201);
    } catch (e) {
      if (e.code === "EMAIL_EXISTS") return fail(res, 409, "هذا البريد مسجّل مسبقاً.", "email");
      console.error(e.message); return fail(res, 400, "تعذّر إنشاء الحساب في Firebase.", "email");
    }
  }
  if (await store.findUserByEmail(email)) return fail(res, 409, "هذا البريد مسجّل مسبقاً.", "email");
  const user = { id: crypto.randomUUID(), email, password: hash(pw), role: null, profileComplete: false, profile: null, verification: { status: "none", documents: [] }, createdAt: new Date().toISOString().slice(0, 10) };
  await store.putUser(user);
  const token = crypto.randomBytes(24).toString("hex"); sessions.set(token, user.id);
  loginOk(res, user, { token }, 201);
}));

app.post("/api/auth/login", wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase(), pw = String(req.body.password || "");
  if (FIREBASE) {
    try {
      const d = await fbCall(`${FB_REST}signInWithPassword?key=${fbApiKey}`, { email, password: pw, returnSecureToken: true });
      const user = await ensureUser(d.localId, email);
      return loginOk(res, user, { token: d.idToken, refreshToken: d.refreshToken });
    } catch (e) { return fail(res, 401, "البريد أو كلمة المرور غير صحيحة."); }
  }
  const user = await store.findUserByEmail(email);
  if (!user || !checkPw(pw, user.password)) return fail(res, 401, "البريد أو كلمة المرور غير صحيحة.");
  const token = crypto.randomBytes(24).toString("hex"); sessions.set(token, user.id);
  loginOk(res, user, { token });
}));

app.post("/api/auth/refresh", wrap(async (req, res) => {   // Firebase ID tokens last 1 hour; this swaps the refresh token for a new one
  if (!FIREBASE) return fail(res, 401, "سجّل الدخول للمتابعة.");
  try {
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${fbApiKey}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(String(req.body.refreshToken || ""))}` });
    const d = await r.json(); if (!r.ok) throw new Error("refresh");
    res.json({ token: d.id_token, refreshToken: d.refresh_token });
  } catch { fail(res, 401, "انتهت الجلسة، سجّل الدخول من جديد."); }
}));
app.get("/api/auth/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- 8) ONBOARDING (name, buyer/seller, solo/business, DEMO documents) ----
app.put("/api/profile", auth, wrap(async (req, res) => {
  const b = req.body, u = req.user;
  const need = (v, field, label) => { v = String(v || "").trim(); if (v.length < 2) { fail(res, 400, `${label} مطلوب.`, field); return null; } return v; };
  const firstName = need(b.firstName, "firstName", "الاسم الأول"); if (!firstName) return;
  const lastName = need(b.lastName, "lastName", "اسم العائلة"); if (!lastName) return;
  const city = need(b.city, "city", "المدينة"); if (!city) return;
  const phone = String(b.phone || "").replace(/[\s-]/g, "");
  if (!PHONE.test(phone)) return fail(res, 400, "رقم الجوال غير صالح (05XXXXXXXX).", "phone");
  if (u.role === "admin") return fail(res, 403, "حساب الإدارة لا يُعدَّل من هنا.");
  if (!["buyer", "seller"].includes(b.role)) return fail(res, 400, "اختر مشتري أو بائع.", "role");

  const profile = { firstName, lastName, phone, city };
  let verification = { status: "active", documents: [], note: "" };
  if (b.role === "seller") {
    if (!SELLER_DOCS[b.sellerType]) return fail(res, 400, "اختر فردي أو منشأة.", "sellerType");
    profile.sellerType = b.sellerType;
    if (b.sellerType === "business") {
      profile.businessName = String(b.businessName || "").trim();
      if (profile.businessName.length < 2) return fail(res, 400, "اسم المنشأة مطلوب.", "businessName");
      if (!/^\d{10}$/.test(String(b.crNumber))) return fail(res, 400, "السجل التجاري 10 أرقام.", "crNumber");
      profile.crNumber = String(b.crNumber);
    }
    const docs = [];
    for (const nd of SELLER_DOCS[b.sellerType]) {
      const d = (b.documents || []).find((x) => x.kind === nd.kind);
      if (!d || !d.fileName) return fail(res, 400, `أرفق: ${nd.label}`, nd.kind);
      // DEMO ONLY: we keep just the file NAME and SIZE. The file itself never leaves the browser.
      docs.push({ kind: nd.kind, label: nd.label, fileName: path.basename(String(d.fileName)).slice(0, 100), fileSize: Number(d.fileSize) || 0, demo: true });
    }
    verification = { status: "pending_review", documents: docs, note: "" };   // an admin must approve before the seller can publish
  }
  Object.assign(u, { role: b.role, profile, profileComplete: true, verification });
  await store.putUser(u);
  res.json({ user: publicUser(u) });
}));

// ---------- 9) ORDERS (buyers: only your own) --------------------------
app.get("/api/orders", auth, wrap(async (req, res) => {
  const mine = (await store.listOrders()).filter((o) => o.userId === req.user.id).sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")));
  res.json(await Promise.all(mine.map(orderView)));
}));
app.get("/api/orders/:id", auth, wrap(async (req, res) => {
  const o = await store.getOrder(req.params.id);
  if (!o) return fail(res, 404, "الطلب غير موجود.");
  const l = await store.getListing(o.listingId);
  const allowed = o.userId === req.user.id || req.user.role === "admin" || (req.user.role === "seller" && l && l.sellerId === req.user.id);
  allowed ? res.json(await orderView(o)) : fail(res, 404, "الطلب غير موجود.");    // someone else's order = 404
}));
app.post("/api/orders", auth, wrap(async (req, res) => {
  const b = req.body, u = req.user;
  if (!u.profileComplete) return fail(res, 403, "أكمل ملفك الشخصي أولاً.");
  if (u.role !== "buyer") return fail(res, 403, "الطلبات لحسابات المشترين فقط.");
  const l = await store.getListing(String(b.listingId || ""));
  if (!l || l.status !== "active") return fail(res, 400, "اختر الحيوان.", "listingId");
  if (!["delivery", "pickup"].includes(b.deliveryType)) return fail(res, 400, "اختر طريقة الاستلام.", "deliveryType");
  const phone = String(b.phone || "").replace(/[\s-]/g, "");
  if (!PHONE.test(phone)) return fail(res, 400, "رقم الجوال غير صالح.", "phone");
  if (b.deliveryType === "delivery" && String(b.address || "").trim().length < 5) return fail(res, 400, "العنوان مطلوب للتوصيل.", "address");
  const next = Math.max(1000, ...(await store.listOrders()).map((o) => Number(o.id.replace(/\D/g, "")))) + 1;
  const order = { id: "ORD-" + next, userId: u.id, listingId: l.id, status: "processing", date: new Date().toISOString().slice(0, 10),
    deliveryType: b.deliveryType, phone, address: String(b.address || "").trim(), notes: String(b.notes || "").slice(0, 500) };
  await store.putOrder(order);
  res.status(201).json(await orderView(order));
}));

// ---------- 10) BUYER DASHBOARD ---------------------------------------
app.get("/api/buyer/stats", auth, only("buyer"), wrap(async (req, res) => {
  const mine = await Promise.all((await store.listOrders()).filter((o) => o.userId === req.user.id).sort(byDateDesc).map(orderView));
  res.json({
    orders: mine.length, byStatus: countBy(mine, (o) => o.status),
    totalSpent: round2(mine.reduce((s, o) => s + o.pricing.total, 0)),
    deposits: round2(mine.reduce((s, o) => s + o.pricing.deposit, 0)),
    latest: mine[0] || null, statusLabels: STATUS,
  });
}));

// ---------- 11) SELLER DASHBOARD --------------------------------------
const myListings = async (u) => (await store.listListings()).filter((l) => l.sellerId === u.id);
const myOrders = async (u) => {
  const ids = new Set((await myListings(u)).map((l) => l.id));
  return (await store.listOrders()).filter((o) => ids.has(o.listingId)).sort(byDateDesc);
};
app.get("/api/seller/stats", auth, only("seller"), wrap(async (req, res) => {
  const ls = await myListings(req.user), os = await Promise.all((await myOrders(req.user)).map(orderView));
  res.json({ verification: req.user.verification, listings: ls.length, activeListings: ls.filter((l) => l.status === "active").length,
    orders: os.length, byStatus: countBy(os, (o) => o.status), revenue: round2(os.reduce((s, o) => s + o.pricing.price, 0)), statusLabels: STATUS });
}));
app.get("/api/seller/listings", auth, only("seller"), wrap(async (req, res) => res.json((await myListings(req.user)).sort(byNewest))));
app.post("/api/seller/listings", auth, only("seller"), wrap(async (req, res) => {
  const u = req.user, b = req.body;
  if (u.verification.status !== "active") return fail(res, 403, "حسابك قيد المراجعة. يمكنك نشر الإعلانات بعد موافقة الإدارة.");
  const name = String(b.name || "").trim(), age = String(b.age || "").trim(), price = Number(b.price);
  if (name.length < 2) return fail(res, 400, "اسم الحيوان مطلوب.", "name");
  if (!CATEGORIES.some((c) => c.id === b.category)) return fail(res, 400, "اختر الفئة.", "category");
  if (age.length < 1) return fail(res, 400, "العمر مطلوب.", "age");
  if (!(price >= 100 && price <= 200000)) return fail(res, 400, "السعر يجب أن يكون بين 100 و 200000 ريال.", "price");
  const [image, photo] = DEFAULT_IMG[b.category];             // demo: no photo upload, we reuse the category picture
  const l = { id: "L" + Date.now().toString(36), name, kind: name, category: b.category, age, price: round2(price), rating: 0, sellerId: u.id, seller: sellerLabel(u), image, photo, status: "active", createdAt: new Date().toISOString().slice(0, 10) };
  await store.putListing(l); res.status(201).json(l);
}));
app.patch("/api/seller/listings/:id", auth, only("seller"), wrap(async (req, res) => {
  const l = await store.getListing(req.params.id);
  if (!l || l.sellerId !== req.user.id) return fail(res, 404, "الإعلان غير موجود.");
  if (l.status === "blocked") return fail(res, 403, "هذا الإعلان أوقفته الإدارة.");
  if (req.body.price !== undefined) { const p = Number(req.body.price); if (!(p >= 100 && p <= 200000)) return fail(res, 400, "السعر غير صالح.", "price"); l.price = round2(p); }
  if (["active", "hidden"].includes(req.body.status)) l.status = req.body.status;
  await store.putListing(l); res.json(l);
}));
app.get("/api/seller/orders", auth, only("seller"), wrap(async (req, res) => {
  const out = [];
  for (const o of await myOrders(req.user)) { const v = await orderView(o), b = await store.getUser(o.userId); out.push({ ...v, buyer: b ? { name: fullName(b), city: b.profile && b.profile.city } : null }); }
  res.json(out);
}));

// ---------- 12) ADMIN DASHBOARD ---------------------------------------
const adm = [auth, only("admin")];
app.get("/api/admin/stats", ...adm, wrap(async (_req, res) => {
  const us = await store.listUsers(), ls = await store.listListings(), os = await Promise.all((await store.listOrders()).map(orderView));
  res.json({ users: us.length, byRole: countBy(us, (u) => u.role || "none"), pendingSellers: us.filter((u) => u.role === "seller" && u.verification.status === "pending_review").length,
    listings: ls.length, activeListings: ls.filter((l) => l.status === "active").length, orders: os.length, byStatus: countBy(os, (o) => o.status),
    sales: round2(os.reduce((s, o) => s + o.pricing.total, 0)), statusLabels: STATUS, storage: store.mode });
}));
app.get("/api/admin/users", ...adm, wrap(async (_req, res) => res.json((await store.listUsers()).map((u) => ({ ...publicUser(u), name: fullName(u), createdAt: u.createdAt })))));
app.get("/api/admin/verifications", ...adm, wrap(async (_req, res) => {
  const sellers = (await store.listUsers()).filter((u) => u.role === "seller");
  const rank = { pending_review: 0, rejected: 1, active: 2 };
  res.json(sellers.map((u) => ({ id: u.id, email: u.email, name: fullName(u), business: sellerLabel(u), sellerType: u.profile.sellerType, crNumber: u.profile.crNumber, city: u.profile.city, verification: u.verification })).sort((a, b) => rank[a.verification.status] - rank[b.verification.status]));
}));
app.post("/api/admin/verifications/:id", ...adm, wrap(async (req, res) => {
  const u = await store.getUser(req.params.id);
  if (!u || u.role !== "seller") return fail(res, 404, "البائع غير موجود.");
  if (!["approve", "reject"].includes(req.body.decision)) return fail(res, 400, "قرار غير صالح.");
  u.verification = { ...u.verification, status: req.body.decision === "approve" ? "active" : "rejected", note: String(req.body.note || "").slice(0, 200) };
  await store.putUser(u); res.json({ id: u.id, verification: u.verification });
}));
app.get("/api/admin/orders", ...adm, wrap(async (_req, res) => {
  const out = [];
  for (const o of (await store.listOrders()).sort(byDateDesc)) { const v = await orderView(o), b = await store.getUser(o.userId); out.push({ ...v, buyer: b ? fullName(b) : "—" }); }
  res.json(out);
}));
app.patch("/api/admin/orders/:id", ...adm, wrap(async (req, res) => {
  const o = await store.getOrder(req.params.id);
  if (!o) return fail(res, 404, "الطلب غير موجود.");
  if (!STATUS[req.body.status]) return fail(res, 400, "حالة غير صالحة.");
  o.status = req.body.status; await store.putOrder(o); res.json(await orderView(o));
}));
app.get("/api/admin/listings", ...adm, wrap(async (_req, res) => res.json((await store.listListings()).sort(byNewest))));
app.patch("/api/admin/listings/:id", ...adm, wrap(async (req, res) => {
  const l = await store.getListing(req.params.id);
  if (!l) return fail(res, 404, "الإعلان غير موجود.");
  if (!["active", "hidden", "blocked"].includes(req.body.status)) return fail(res, 400, "حالة غير صالحة.");
  l.status = req.body.status; await store.putListing(l); res.json(l);
}));

app.use("/api", (_req, res) => fail(res, 404, "المسار غير موجود."));

// ---------- 13) START: pick Firebase if it is configured, else local ----
async function start() {
  const cfgFile = path.join(__dirname, "firebase.config.json");
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : {};
  fbApiKey = process.env.FIREBASE_API_KEY || cfg.apiKey;
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, cfg.serviceAccount || "serviceAccountKey.json");
  const configured = fbApiKey && !/^PASTE/i.test(fbApiKey) && fs.existsSync(keyFile);
  if (configured) {
    try {
      fbAdmin = require("firebase-admin");
      fbAdmin.initializeApp({ credential: fbAdmin.credential.cert(JSON.parse(fs.readFileSync(keyFile, "utf8"))) });
      store = firebaseStore(fbAdmin); FIREBASE = true;
      await seedFirebase(fbAdmin, store);
    } catch (e) { console.error("Firebase failed to start, using the local database instead:", e.message); FIREBASE = null; store = null; }
  }
  if (!store) store = localStore();
  app.listen(3000, () => console.log(`مراح كيو يعمل على http://localhost:3000   [التخزين: ${store.mode === "firebase" ? "Firebase (Auth + Firestore)" : "ملف محلي db.json"}]`));
}
start();
