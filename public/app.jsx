/* =====================================================================
   app.jsx — the whole front-end in ONE file (React 18 + Tailwind v4)
   Every screen and every tab takes its data from the API (server.js).
   The website never talks to Firebase directly: the server does.
   The order screens that were designed at 1440px wide are placed with
   the Figma coordinates inside a "Stage" that scales down on small screens.
   ===================================================================== */
const { useState, useEffect, useRef, useContext, createContext } = React;

/* ---------- small helpers ------------------------------------------- */
const K = 1440 / 1024;                       // Figma screenshots were taken at 1024px wide
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", year: "numeric" });
const STATUS_COLOR = { processing: "#bb5a34", shipping: "#87442f", delivered: "#3a7d44" };
const homeFor = (u) => (u && u.role === "admin" ? "/admin" : u && u.role === "seller" ? "/seller" : "/");

let refreshing = null;
async function api(path, opts = {}) {        // one function for every API call
  const send = (token) => fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let res = await send(localStorage.getItem("mk_token"));
  const isAuthCall = path.startsWith("/api/auth/login") || path.startsWith("/api/auth/register") || path.startsWith("/api/auth/refresh");
  if (res.status === 401 && !isAuthCall && localStorage.getItem("mk_refresh")) {     // Firebase tokens last 1 hour: renew once, then retry
    refreshing = refreshing || fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: localStorage.getItem("mk_refresh") }) })
      .then((r) => (r.ok ? r.json() : null)).finally(() => { refreshing = null; });
    const d = await refreshing;
    if (d) { localStorage.setItem("mk_token", d.token); localStorage.setItem("mk_refresh", d.refreshToken); res = await send(d.token); }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !isAuthCall && localStorage.getItem("mk_token")) window.dispatchEvent(new Event("mk-logout"));
    const e = new Error(data.error?.message || "حدث خطأ، حاول مرة أخرى."); e.field = data.error?.field; e.status = res.status; throw e;
  }
  return data;
}

function useApi(path) {                      // GET something when the screen / tab opens;  reload() asks again
  const [state, set] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!path) return;
    api(path).then((data) => alive && set({ data, error: null, loading: false }))
             .catch((error) => alive && set({ data: null, error, loading: false }));
    return () => { alive = false; };
  }, [path, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

let siteCache = null, sitePromise = null;    // menu, footer, FAQ … come from GET /api/site (loaded once)
function useSite() {
  const [site, set] = useState(siteCache);
  useEffect(() => {
    if (siteCache) return;
    sitePromise = sitePromise || api("/api/site").then((d) => (siteCache = d));
    sitePromise.then(set).catch(() => {});
  }, []);
  return site;
}

function useRoute() {                        // tiny hash router:  #/orders/ORD-1042?x=1
  const read = () => { const [path, q] = (location.hash.slice(1) || "/").split("?"); return { path, query: Object.fromEntries(new URLSearchParams(q || "")) }; };
  const [r, set] = useState(read);
  useEffect(() => { const f = () => set(read()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return r;
}
const go = (to) => { location.hash = to; };

/* ---------- auth context -------------------------------------------- */
const Auth = createContext(null);
function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);               // undefined = still checking
  const clear = () => { localStorage.removeItem("mk_token"); localStorage.removeItem("mk_refresh"); setUser(null); };
  useEffect(() => {
    addEventListener("mk-logout", clear);
    if (!localStorage.getItem("mk_token")) setUser(null);
    else api("/api/auth/me").then((d) => setUser(d.user)).catch(clear);
    return () => removeEventListener("mk-logout", clear);
  }, []);
  const signIn = ({ token, refreshToken, user }) => { localStorage.setItem("mk_token", token); refreshToken ? localStorage.setItem("mk_refresh", refreshToken) : localStorage.removeItem("mk_refresh"); setUser(user); };
  const signOut = () => { clear(); go("/"); };
  return <Auth.Provider value={{ user, setUser, signIn, signOut }}>{children}</Auth.Provider>;
}
const useAuth = () => useContext(Auth);

/* ---------- animation helpers --------------------------------------- */
function useSeen(ref) {                      // true once the element scrolls into view
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el); return () => io.disconnect();
  }, []);
  return seen;
}
function Reveal({ as: Tag = "div", delay = 0, className = "", children, ...rest }) {
  const ref = useRef(null); const seen = useSeen(ref);
  return <Tag ref={ref} className={`reveal ${seen ? "show" : ""} ${className}`} style={{ transitionDelay: delay + "ms" }} {...rest}>{children}</Tag>;
}
function CountUp({ to, prefix = "", suffix = "" }) {
  const ref = useRef(null); const seen = useSeen(ref); const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return; const t0 = performance.now();
    let raf; const tick = (t) => { const p = Math.min(1, (t - t0) / 1200); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [seen, to]);
  return <span ref={ref}>{prefix}{n}{suffix}</span>;
}

/* ---------- the 1440px "Stage" (pixel-exact screens) ----------------- */
function Stage({ h = 1024, bg = "#fff", children }) {
  const zoomFor = () => Math.min(1, window.innerWidth / 1440);
  const [z, setZ] = useState(zoomFor);
  useEffect(() => { const f = () => setZ(zoomFor()); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return (
    <div className="stage-wrap" style={{ background: bg, height: h * z }}>
      <div className="stage" style={{ width: 1440, height: h, zoom: z }}>{children}</div>
    </div>
  );
}
// absolute-position helpers. Numbers are Figma-screenshot pixels (1024 wide) -> converted to 1440.
const Bx = ({ l, t, r, b, style, children, ...p }) => <div {...p} style={{ position: "absolute", left: l * K, top: t * K, width: (r - l) * K, height: (b - t) * K, ...style }}>{children}</div>;
const Tr = ({ r, y, s = 16, w = 700, c = "#000", style, children }) => <div style={{ position: "absolute", right: 1440 - r * K, top: y * K, transform: "translateY(-50%)", fontSize: s, fontWeight: w, color: c, whiteSpace: "nowrap", lineHeight: 1.2, textAlign: "right", ...style }}>{children}</div>;
const Tc = ({ x, y, s = 16, w = 400, c = "#000", style, children }) => <div style={{ position: "absolute", left: x * K, top: y * K, transform: "translate(-50%,-50%)", fontSize: s, fontWeight: w, color: c, whiteSpace: "nowrap", lineHeight: 1.2, textAlign: "center", ...style }}>{children}</div>;

/* ---------- icons ---------------------------------------------------- */
const Ico = ({ d, size = 24, sw = 2, color = "currentColor", children }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children || <path d={d} />}</svg>;
const ArrowLeft = (p) => <Ico {...p}><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></Ico>;
const UserCircle = (p) => <Ico {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="10" r="3" /><path d="M7 20.66V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.66" /></Ico>;
const Chevron = (p) => <Ico {...p}><path d="m6 9 6 6 6-6" /></Ico>;
const Truck = (p) => <Ico {...p}><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" /></Ico>;
const Pin = (p) => <Ico {...p}><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></Ico>;

/* ---------- header + drawer (same on every screen) ------------------- */
function Header({ path, dy = 0 }) {
  const { user, signOut } = useAuth();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const dash = user && site?.dashboards?.[user.role];
  // for sellers/admins the "orders" button opens their own dashboard instead
  const nav = (site?.nav || []).map((n) => {
    const toDash = n.to === "/orders" && dash && user.role !== "buyer";
    const to = toDash ? dash.to : n.to;
    return { label: toDash ? dash.label : n.label, to, cur: to === "/" ? path === "/" : to === "/browse" ? path === "/browse" || path === "/orders/new" : path.startsWith(to) };
  });
  return (
    <>
      <header className="site-header" style={{ position: "relative", zIndex: 5 }}>
        <a className="site-header__logo" href="#/" aria-label="مراح كيو — الرئيسية" style={{ transform: `translateY(${dy}px)` }}><span></span></a>
        <nav className="site-header__nav" aria-label="التنقل الرئيسي" style={{ transform: `translateY(${dy}px)` }}>
          {nav.map((n) => <a key={n.to} className="btn" href={"#" + n.to} aria-current={n.cur ? "page" : undefined}>{n.label}</a>)}
        </nav>
        <button className="site-header__menu" type="button" aria-label="فتح القائمة الجانبية" onClick={() => setOpen(true)} style={{ transform: `translateY(${dy}px)` }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></svg>
        </button>
      </header>
      {open && (
        <>
          <div className="drawer-back" onClick={() => setOpen(false)} />
          <aside className="drawer" role="dialog" aria-label="القائمة">
            <button onClick={() => setOpen(false)} className="text-brown text-2xl mb-4" aria-label="إغلاق">✕</button>
            <p className="font-bold text-brown-dark">{user ? `${user.profile?.firstName || ""} ${user.profile?.lastName || ""}`.trim() || user.email : "مرحباً بك"}</p>
            {user && <p className="text-sm text-gray mb-4" dir="ltr" style={{ textAlign: "right" }}>{user.email}</p>}
            <ul className="mt-4 flex flex-col gap-3">
              {dash && <li><a href={"#" + dash.to} onClick={() => setOpen(false)} className="block py-2 text-primary font-bold hover:underline">{dash.label}</a></li>}
              {(site?.drawer || []).filter((d) => !(d.to === "/orders" && user && user.role !== "buyer")).map((d) =>
                <li key={d.to}><a href={"#" + d.to} onClick={() => setOpen(false)} className="block py-2 text-brown-dark font-semibold hover:text-primary">{d.label}</a></li>)}
            </ul>
            <div className="mt-6">
              {user ? <button className="btn" onClick={() => { setOpen(false); signOut(); }}>تسجيل الخروج</button>
                    : <a className="btn" href="#/login" onClick={() => setOpen(false)}>تسجيل الدخول</a>}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

/* ---------- footers --------------------------------------------------- */
function StageFooter({ top = 626 }) {        // the 143px footer used on the form / orders / details screens
  const f = useSite()?.footer;
  return (
    <>
      <Bx l={0} t={top} r={1024} b={top + 103} style={{ background: "#5d3d32" }} />
      <Tc x={745} y={641} s={20} c="#fff">{f?.quickTitle}</Tc>
      {(f?.links || []).map((l, i) => <a key={l.to} href={"#" + l.to} style={{ position: "absolute", left: 745 * K, top: [657, 679, 698, 713][i] * K, transform: "translate(-50%,-50%)", color: "#e2bea4", fontSize: 16, lineHeight: 1.2, whiteSpace: "nowrap" }}>{l.label}</a>)}
      <Tc x={266} y={661} s={20} c="#fff">{f?.contactTitle}</Tc>
      {(f?.social || []).map((s, i) => <a key={s.icon} href="#/" aria-label={s.label} style={{ position: "absolute", left: (231 + i * 24) * K - 12, top: 683 * K - 12, width: 24, height: 24 }}><img src={`assets/social-${s.icon}.svg`} alt="" width="24" height="24" /></a>)}
    </>
  );
}
function PageFooter() {                      // normal-flow footer for the dashboards
  const f = useSite()?.footer;
  if (!f) return null;
  return (
    <footer className="footer footer--static">
      <nav className="footer__col footer__links" aria-label={f.quickTitle}>
        <h3>{f.quickTitle}</h3>
        <ul>{f.links.map((l) => <li key={l.to}><a href={"#" + l.to}>{l.label}</a></li>)}</ul>
      </nav>
      <div className="footer__col footer__contact">
        <h3>{f.contactTitle}</h3>
        <ul className="footer__social">{f.social.map((s) => <li key={s.icon}><a href="#/" aria-label={s.label}><img src={`assets/social-${s.icon}.svg`} alt="" /></a></li>)}</ul>
      </div>
    </footer>
  );
}

function Breadcrumb({ items, r, y, bar }) {  // الرئيسية › تصفح › إتمام الطلب
  return (
    <>
      {bar && <Bx l={0} t={57} r={1024} b={100} style={{ background: "#faf6f2" }} />}
      <Tr r={r} y={y} s={14} c="#54545c">
        {items.map(([t, to], i) => <span key={i}>{i > 0 && " › "}{to ? <a href={"#" + to}>{t}</a> : t}</span>)}
      </Tr>
    </>
  );
}

/* ====================================================================
   1) LANDING PAGE
   ==================================================================== */
function Home({ route }) {
  const { data: c } = useApi("/api/content");
  const { data: listings } = useApi("/api/listings");
  const f = useSite()?.footer;
  const { user } = useAuth();
  useEffect(() => {
    if (route.path === "/browse" && c) setTimeout(() => document.getElementById("browse")?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [route.path, !!c]);
  const book = (id) => go("/orders/new?listing=" + id);
  const pickRole = (r) => { sessionStorage.setItem("mk_role", r); go(user ? homeFor(user) === "/" ? "/orders/new" : homeFor(user) : "/signup"); };
  const icons = {
    browse: <svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>,
    book: <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>,
    receive: <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>,
  };
  return (
    <div style={{ background: "#faf6f2" }}>
      <Header path={route.path} />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__photo" aria-hidden="true"><img src="assets/hero-photo.png" alt="" /></div>
          <p className="hero__wordmark" role="img" aria-label="مراح كيو"><img src="assets/hero-wordmark.png" alt="" /><span></span></p>
          <h1 className="hero__title" id="hero-title">{c?.hero.title}</h1>
          <p className="hero__sub">{c?.hero.subtitle}</p>
          <div className="hero__actions">
            <button className="btn" onClick={() => pickRole("buyer")}>سجّل كمشتري</button>
            <button className="btn btn--outline" onClick={() => pickRole("seller")}>سجل كبائع</button>
          </div>
          <div className="hero__driver" aria-hidden="true"><span className="back"></span><span className="front"></span></div>
        </section>

        {c && <>
          <section className="how" aria-labelledby="how-title" style={{ background: "#fff" }}>
            <Reveal as="h2" id="how-title">{c.howTitle}</Reveal>
            <ol className="how__row">
              {c.steps.map((s, i) => (
                <Reveal as="li" key={s.id} delay={i * 150} className="how__col">
                  <span className="how__icon" aria-hidden="true">{icons[s.id]}</span>
                  <h3>{s.title}</h3><p>{s.text}</p>
                </Reveal>
              ))}
            </ol>
          </section>

          <section className="cats" id="browse" aria-labelledby="cats-title">
            <Reveal as="h2" id="cats-title">{c.categoriesTitle}</Reveal>
            <ul className="cats__grid">
              {c.categories.map((cat, i) => (
                <Reveal as="li" key={cat.id} delay={i * 120}>
                  <a className="cat" href={"#/orders/new?category=" + cat.id}>
                    <span className="cat__inner">
                      <span className="cat__name">{cat.name}</span>
                      <span className="cat__block" aria-hidden="true"></span>
                      <span className={"cat__img" + (cat.id === "sheep" ? " cat__img--lg" : "")} aria-hidden="true"><img src={"assets/" + cat.image} alt="" /></span>
                    </span>
                  </a>
                </Reveal>
              ))}
            </ul>
          </section>

          <section className="latest" aria-labelledby="latest-title">
            <Reveal as="h2" id="latest-title">{c.latestTitle}</Reveal>
            <ul className="latest__track" tabIndex={0} role="region" aria-label="أحدث الإعلانات — مرّر لعرض المزيد">
              {(listings || []).map((l) => (
                <li className="card" key={l.id}>
                  <div className="card__tile"><img src={"assets/" + l.image} alt={l.name} /></div>
                  <p className="card__farm">{l.seller}</p>
                  <h3 className="card__title">{l.name}</h3>
                  <div className="card__stars" role="img" aria-label={`التقييم ${l.rating} من 5`}>
                    {[1, 2, 3, 4, 5].map((n) => <img key={n} src={`assets/star-${n <= l.rating ? "filled" : "empty"}.svg`} alt="" />)}
                  </div>
                  <div className="card__foot">
                    <button className="btn btn--sm" type="button" onClick={() => book(l.id)}>احجز الان</button>
                    <span className="card__price">{fmt(l.price)} ر.س</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="stats" aria-label="لماذا مراح كيو">
            <dl className="stats__grid">
              {c.stats.map((s, i) => (
                <Reveal key={s.label} delay={i * 120} className="stat">
                  <dd><CountUp to={s.value} prefix={s.prefix} suffix={s.suffix} /></dd><dt>{s.label}</dt>
                </Reveal>
              ))}
            </dl>
          </section>

          <section className="cta" aria-labelledby="cta-title">
            <img className="cta__splatter" src="assets/cta-splatter.svg" alt="" />
            <div className="cta__content">
              <h2 id="cta-title">{c.cta.title}</h2>
              <button className="cta__button" onClick={() => go(user ? (homeFor(user) === "/" ? "/orders/new" : homeFor(user)) : "/signup")}>{c.cta.button}</button>
            </div>
            {f && (
              <footer className="footer">
                <nav className="footer__col footer__links" aria-label={f.quickTitle}>
                  <h3>{f.quickTitle}</h3>
                  <ul>{f.links.map((l) => <li key={l.to}><a href={"#" + l.to}>{l.label}</a></li>)}</ul>
                </nav>
                <div className="footer__col footer__contact">
                  <h3>{f.contactTitle}</h3>
                  <ul className="footer__social">
                    {f.social.map((s) => <li key={s.icon}><a href="#/" aria-label={s.label}><img src={`assets/social-${s.icon}.svg`} alt="" /></a></li>)}
                  </ul>
                </div>
              </footer>
            )}
          </section>
        </>}
      </main>
    </div>
  );
}

/* ====================================================================
   2) LOGIN + SIGNUP + ONBOARDING share one page layout.
      The background circles/blob are drawn here in SVG (complete shapes,
      nothing cut off by the frame), in the same colours as the design.
   ==================================================================== */
function AuthLayout({ children, wide }) {
  return (
    <div className="auth-page">
      <div className="auth-bg" aria-hidden="true">
        <svg className="auth-bg__blob" viewBox="0 0 600 560">
          <defs>
            <linearGradient id="blobGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ecd2bc" /><stop offset="1" stopColor="#dcb394" /></linearGradient>
            <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="-6" dy="8" stdDeviation="11" floodColor="#8a5a3c" floodOpacity=".28" /></filter>
          </defs>
          <path filter="url(#softShadow)" fill="url(#blobGrad)" d="M70 100C110 0 330 20 430 48C560 86 596 190 556 292C518 388 468 440 398 498C330 552 190 536 122 468C44 392 28 200 70 100Z" />
        </svg>
        <svg className="auth-bg__circles" viewBox="0 0 520 520">
          <defs><filter id="ringShadow" x="-15%" y="-15%" width="130%" height="130%"><feDropShadow dx="6" dy="4" stdDeviation="9" floodColor="#7a5238" floodOpacity=".25" /></filter></defs>
          <circle cx="260" cy="260" r="250" fill="#e2bea4" filter="url(#ringShadow)" />
          <circle cx="236" cy="284" r="190" fill="#ecd3c1" filter="url(#ringShadow)" />
          <circle cx="214" cy="306" r="130" fill="#f4e7de" filter="url(#ringShadow)" />
        </svg>
      </div>
      <a href="#/" className="auth-logo" aria-label="مراح كيو — الرئيسية"><span></span></a>
      <div className={"auth-card pop " + (wide ? "auth-card--wide" : "")}>{children}</div>
    </div>
  );
}

const RULES = [["إضافة حرف صغير", (p) => /[a-z]/.test(p)], ["إضافة حرف كبير", (p) => /[A-Z]/.test(p)], ["إضافة رقم", (p) => /\d/.test(p)], ["إضافة رمز خاص (!#@%$^&*_+-}{)", (p) => /[^A-Za-z0-9]/.test(p)], ["إضافة 8 احرف على الأقل", (p) => p.length >= 8]];

function AuthScreen({ mode }) {
  const { user, signIn } = useAuth();
  const signup = mode === "signup";
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [shake, setShake] = useState(0);
  useEffect(() => { if (user) go(user.profileComplete ? homeFor(user) : "/onboarding"); }, [user]);

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { signIn(await api(signup ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: { email, password } })); }
    catch (x) { setErr(x.message); setShake((n) => n + 1); }
    setBusy(false);
  };
  return (
    <AuthLayout>
      <form onSubmit={submit} key={shake} className={shake ? "shake" : ""} noValidate>
        <label className="auth-label" htmlFor="email">البريد الالكتروني</label>
        <input id="email" className="auth-input" type="email" autoComplete="email" placeholder="Someone@example" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="auth-label" htmlFor="pw" style={{ marginTop: 18, fontSize: signup ? 18 : 16 }}>كلمة المرور</label>
        {signup && (
          <ul className="auth-rules" aria-label="شروط كلمة المرور">
            <li>شروط كلمة المرور</li>
            {RULES.map(([t, ok]) => <li key={t} className={ok(password) ? "ok" : ""}>{t}</li>)}
          </ul>
        )}
        <input id="pw" className="auth-input" type="password" autoComplete={signup ? "new-password" : "current-password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {signup ? (
          <>
            <button type="submit" className="auth-btn auth-btn--full" disabled={busy}>{busy ? <span className="spinner auth-spin" /> : <>تسجيل <ArrowLeft size={16} color="#fde7d9" /></>}</button>
            <a href="#/login" className="auth-link">لديك حساب بالفعل؟</a>
          </>
        ) : (
          <>
            <div className="auth-row">
              <button type="submit" className="auth-btn" disabled={busy}>{busy ? <span className="spinner auth-spin" /> : <>تسجيل الدخول <ArrowLeft size={16} color="#fde7d9" /></>}</button>
              <a href="#/signup" className="auth-btn auth-btn--new">مستعمل جديد <UserCircle size={16} color="#5d3d32" /></a>
            </div>
            <a href="#/login" className="auth-link" onClick={(e) => { e.preventDefault(); setErr("إعادة تعيين كلمة المرور غير مفعّلة في النسخة التجريبية."); }}>نسيت كلمة المرور؟</a>
          </>
        )}
        {err && <p role="alert" className="auth-err fade-up">{err}</p>}
      </form>
    </AuthLayout>
  );
}

/* ====================================================================
   3) ONBOARDING (after signup): info -> buyer/seller -> solo/business
      -> demo documents -> review -> success
   ==================================================================== */
function Onboarding() {
  const { user, setUser } = useAuth();
  const { data: docsInfo } = useApi("/api/seller-documents");
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", city: "", role: sessionStorage.getItem("mk_role") || "", sellerType: "", businessName: "", crNumber: "" });
  const [files, setFiles] = useState({});          // kind -> {fileName, fileSize, progress}
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const set = (k, v) => { setF((o) => ({ ...o, [k]: v })); setErr({}); };
  useEffect(() => { if (user && user.profileComplete && !done) go(homeFor(user)); }, [user]);

  const seller = f.role === "seller", business = f.sellerType === "business";
  const steps = ["بياناتك", "نوع الحساب", ...(seller ? ["نوع البائع", "المستندات"] : []), "مراجعة"];
  const last = step === steps.length - 1;
  const needed = seller && docsInfo ? docsInfo[f.sellerType] || [] : [];

  const validate = () => {
    const e = {}, name = steps[step];
    if (name === "بياناتك") {
      if (f.firstName.trim().length < 2) e.firstName = "الاسم الأول مطلوب.";
      if (f.lastName.trim().length < 2) e.lastName = "اسم العائلة مطلوب.";
      if (!/^(?:\+966|00966|0)?5\d{8}$/.test(f.phone.replace(/[\s-]/g, ""))) e.phone = "رقم الجوال غير صالح (05XXXXXXXX).";
      if (f.city.trim().length < 2) e.city = "المدينة مطلوبة.";
    }
    if (name === "نوع الحساب" && !f.role) e.role = "اختر مشتري أو بائع.";
    if (name === "نوع البائع" && !f.sellerType) e.sellerType = "اختر فردي أو منشأة.";
    if (name === "المستندات") {
      if (business && f.businessName.trim().length < 2) e.businessName = "اسم المنشأة مطلوب.";
      if (business && !/^\d{10}$/.test(f.crNumber)) e.crNumber = "السجل التجاري 10 أرقام.";
      needed.forEach((d) => { if (!files[d.kind] || files[d.kind].progress < 100) e[d.kind] = "أرفق: " + d.label; });
    }
    setErr(e); return !Object.keys(e).length;
  };
  const next = () => { if (validate()) setStep((s) => s + 1); };
  const pick = (kind, file) => {                  // DEMO: we only read the name + size; the file never leaves the browser
    if (!file) return;
    setFiles((o) => ({ ...o, [kind]: { fileName: file.name, fileSize: file.size, progress: 0 } })); setErr({});
    let p = 0; const id = setInterval(() => { p = Math.min(100, p + 8 + Math.random() * 10); setFiles((o) => ({ ...o, [kind]: { ...o[kind], progress: Math.round(p) } })); if (p >= 100) clearInterval(id); }, 90);
  };
  const submit = async () => {
    setBusy(true); setErr({});
    try {
      const body = { ...f, documents: needed.map((d) => ({ kind: d.kind, fileName: files[d.kind]?.fileName, fileSize: files[d.kind]?.fileSize })) };
      const d = await api("/api/profile", { method: "PUT", body }); setDone(true); setUser(d.user);
      setTimeout(() => go(d.user.role === "buyer" ? "/orders/new" : homeFor(d.user)), 2600);
    } catch (x) { setErr({ [x.field || "form"]: x.message }); }
    setBusy(false);
  };

  const input = (k, label, p = {}) => (
    <label className="block mb-3">
      <span className="block text-sm font-semibold text-brown-dark mb-1">{label}</span>
      <input value={f[k]} onChange={(e) => set(k, e.target.value)} {...p} className={`w-full h-11 px-3 rounded-lg bg-white border ${err[k] ? "border-red-500" : "border-tan"} shadow-[2px_3px_4px_rgba(0,0,0,.2)] outline-none focus:border-primary transition`} />
      {err[k] && <span className="text-xs text-red-600 mt-1 block">{err[k]}</span>}
    </label>
  );
  const choice = (k, val, title, sub) => (
    <button type="button" onClick={() => set(k, val)} className={`w-full text-right p-4 rounded-xl border-2 mb-3 transition hover:-translate-y-0.5 ${f[k] === val ? "border-primary bg-[#fff0e6]" : "border-gray-200 bg-white"}`}>
      <span className="block font-bold text-brown-dark text-lg">{title}</span><span className="block text-sm text-gray">{sub}</span>
    </button>
  );
  const body = steps[step];
  return (
    <AuthLayout wide>
      {done ? (
        <div className="text-center py-8">
          <svg className="mx-auto" width="96" height="96" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none" stroke="#bb5a34" strokeWidth="3" /><path className="draw" pathLength="100" d="M14 27l8 8 16-17" fill="none" stroke="#bb5a34" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2 className="text-2xl font-bold text-brown-dark mt-4 fade-up">تم إنشاء حسابك!</h2>
          <p className="text-gray mt-2 fade-up">{seller ? "مستنداتك قيد المراجعة من الإدارة (عرض تجريبي)." : "يمكنك الآن حجز مواشيك."}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6" aria-label={`الخطوة ${step + 1} من ${steps.length}`}>
            {steps.map((s, i) => <div key={s} className="flex-1"><div className={`h-1.5 rounded-full transition-all duration-500 ${i <= step ? "bg-primary" : "bg-tan/40"}`} /><span className={`text-xs ${i === step ? "text-brown-dark font-bold" : "text-gray"}`}>{s}</span></div>)}
          </div>
          <div key={step} className="slide-in min-h-[260px]">
            {body === "بياناتك" && <>
              <h2 className="text-xl font-bold text-brown-dark mb-4">عرّفنا بنفسك</h2>
              <div className="grid grid-cols-2 gap-3">{input("firstName", "الاسم الأول")}{input("lastName", "اسم العائلة")}</div>
              {input("phone", "رقم الجوال", { placeholder: "05XXXXXXXX", dir: "ltr", inputMode: "tel" })}
              {input("city", "المدينة")}
            </>}
            {body === "نوع الحساب" && <>
              <h2 className="text-xl font-bold text-brown-dark mb-4">كيف ستستخدم مراح كيو؟</h2>
              {choice("role", "buyer", "مشتري", "أتصفح وأحجز المواشي والأضاحي")}
              {choice("role", "seller", "بائع", "أعرض مواشيّ للبيع")}
              {err.role && <p className="text-xs text-red-600">{err.role}</p>}
            </>}
            {body === "نوع البائع" && <>
              <h2 className="text-xl font-bold text-brown-dark mb-4">هل تبيع كفرد أم كمنشأة؟</h2>
              {choice("sellerType", "solo", "فردي", "بصفتي الشخصية — هوية وتصريح بائع")}
              {choice("sellerType", "business", "منشأة", "سجل تجاري وشهادة ضريبية")}
              {err.sellerType && <p className="text-xs text-red-600">{err.sellerType}</p>}
            </>}
            {body === "المستندات" && <>
              <h2 className="text-xl font-bold text-brown-dark mb-1">المستندات</h2>
              <p className="text-xs text-gray mb-3">عرض تجريبي: نحتفظ باسم الملف وحجمه فقط، ولا يُرفع الملف.</p>
              {business && <div className="grid grid-cols-2 gap-3">{input("businessName", "اسم المنشأة")}{input("crNumber", "رقم السجل التجاري", { dir: "ltr", inputMode: "numeric", maxLength: 10 })}</div>}
              {needed.map((d) => {
                const fl = files[d.kind];
                return (
                  <label key={d.kind} className={`block mb-3 p-3 rounded-lg border-2 border-dashed cursor-pointer transition ${err[d.kind] ? "border-red-400" : "border-tan"} hover:bg-[#fff8f2]`}>
                    <span className="block text-sm font-semibold text-brown-dark">{d.label}</span>
                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => pick(d.kind, e.target.files[0])} />
                    {fl ? <>
                      <span className="block text-xs text-gray mt-1" dir="ltr" style={{ textAlign: "right" }}>{fl.fileName} · {Math.max(1, Math.round(fl.fileSize / 1024))} KB</span>
                      <span className="block h-1.5 bg-tan/40 rounded mt-2 overflow-hidden"><span className="block h-full bg-primary transition-all" style={{ width: fl.progress + "%" }} /></span>
                    </> : <span className="block text-xs text-primary mt-1">اضغط لاختيار ملف</span>}
                    {err[d.kind] && <span className="text-xs text-red-600 block mt-1">{err[d.kind]}</span>}
                  </label>
                );
              })}
            </>}
            {body === "مراجعة" && <>
              <h2 className="text-xl font-bold text-brown-dark mb-4">راجع بياناتك</h2>
              <dl className="text-sm grid grid-cols-[110px_1fr] gap-y-2">
                <dt className="text-gray">الاسم</dt><dd className="font-semibold">{f.firstName} {f.lastName}</dd>
                <dt className="text-gray">الجوال</dt><dd className="font-semibold" dir="ltr" style={{ textAlign: "right" }}>{f.phone}</dd>
                <dt className="text-gray">المدينة</dt><dd className="font-semibold">{f.city}</dd>
                <dt className="text-gray">نوع الحساب</dt><dd className="font-semibold">{seller ? (business ? `بائع — منشأة (${f.businessName})` : "بائع — فردي") : "مشتري"}</dd>
                {needed.map((d) => <React.Fragment key={d.kind}><dt className="text-gray">{d.label}</dt><dd className="font-semibold" dir="ltr" style={{ textAlign: "right" }}>{files[d.kind]?.fileName}</dd></React.Fragment>)}
              </dl>
              {Object.entries(err).map(([k, m]) => <p key={k} className="text-sm text-red-600 mt-3">{m}</p>)}
            </>}
          </div>
          <div className="flex gap-3 mt-4">
            {step > 0 && <button type="button" className="btn btn--outline" style={{ minWidth: 100 }} onClick={() => setStep(step - 1)}>رجوع</button>}
            <button type="button" className="btn flex-1" disabled={busy} onClick={last ? submit : next}>{busy ? "جاري الحفظ..." : last ? "إنهاء" : "التالي"}</button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}

/* ====================================================================
   4) ORDER FORM (إتمام الطلب)
   ==================================================================== */
const BOXSTYLE = { background: "#faf6f2", border: "1px solid #e2bea4", borderRadius: 10 };
function OrderForm({ route }) {
  const { user } = useAuth();
  const { data: all } = useApi("/api/listings" + (route.query.category ? "?category=" + route.query.category : ""));
  const { data: pricing } = useApi("/api/pricing");
  const [listingId, setListingId] = useState(route.query.listing || "");
  const [open, setOpen] = useState(false);
  const [delivery, setDelivery] = useState("delivery");
  const [phone, setPhone] = useState(user?.profile?.phone || ""); const [address, setAddress] = useState(""); const [notes, setNotes] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [shake, setShake] = useState(0);
  const l = (all || []).find((x) => x.id === listingId);
  const isDel = delivery === "delivery";
  const p = l && pricing ? (() => { const fee = isDel ? pricing.deliveryFee : 0, vat = Math.round(l.price * pricing.vatRate * 100) / 100, total = l.price + fee + vat; return { fee, vat, total, deposit: Math.round(total * pricing.depositRate * 100) / 100 }; })() : null;

  const send = async () => {
    setErr(""); setBusy(true);
    try { const o = await api("/api/orders", { method: "POST", body: { listingId, deliveryType: delivery, phone, address, notes } }); go("/orders/" + o.id); }
    catch (x) { setErr(x.message); setShake((n) => n + 1); }
    setBusy(false);
  };
  const dcard = (id, l_, r_, title, sub, icon) => {
    const on = delivery === id;
    return (
      <button type="button" onClick={() => setDelivery(id)} aria-pressed={on} style={{ position: "absolute", left: l_ * K, top: 119 * K, width: (r_ - l_) * K, height: 58 * K, background: "#fff", border: `2px solid ${on ? "#bb5a34" : "#e8e4e0"}`, borderRadius: 12, transition: "border-color .2s, transform .2s", padding: 0, textAlign: "right" }} className="hover:-translate-y-0.5">
        <span style={{ position: "absolute", right: 14, top: 12, fontWeight: 700, fontSize: 17, color: "#000" }}>{title}</span>
        <span style={{ position: "absolute", right: 14, top: 38, fontWeight: 400, fontSize: 12, color: "#222", whiteSpace: "nowrap" }}>{sub}</span>
        <span style={{ position: "absolute", left: 12, top: 18, color: on ? "#bb5a34" : "#a0a0a0" }}>{icon}</span>
      </button>
    );
  };
  return (
    <Stage bg="#fffdfc">
      <Header path={route.path} dy={-7} />
      <Breadcrumb bar r={990} y={79} items={[["الرئيسية", "/"], ["تصفح", "/browse"], ["إتمام الطلب"]]} />

      {/* animal picker + photo */}
      <Tr r={680} y={143} s={17}>اختر نوع الحيوان</Tr>
      <div style={{ position: "absolute", left: 610 * K, top: 160 * K, minWidth: 61 * K, zIndex: 20 }}>
        <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%", height: 26 * K, padding: "0 10px", background: "#fff", border: "1px solid #e2bea4", borderRadius: 6, color: "#87442f", fontSize: 15 }}>
          <span>{l ? l.name : "اختار"}</span><Chevron size={18} />
        </button>
        {open && (
          <ul role="listbox" className="pop" style={{ position: "absolute", top: "100%", right: 0, minWidth: "100%", marginTop: 4, background: "#fff", border: "1px solid #e2bea4", borderRadius: 8, boxShadow: "0 8px 20px rgba(0,0,0,.15)", overflow: "hidden" }}>
            {(all || []).map((x) => <li key={x.id} role="option" aria-selected={x.id === listingId}><button type="button" onClick={() => { setListingId(x.id); setOpen(false); }} className="hover:bg-[#fff0e6]" style={{ display: "block", width: "100%", textAlign: "right", padding: "8px 14px", fontSize: 15, whiteSpace: "nowrap" }}>{x.name} — {fmt(x.price)} ر.س</button></li>)}
          </ul>
        )}
      </div>
      <Bx l={692} t={132} r={950} b={389} style={{ background: l ? "#e2bea4" : "#e6e6e6", border: l ? "0" : "2px dashed #9a9a9a", borderRadius: 10, overflow: "hidden" }}>
        {l && <img key={l.id} className="pop" src={"assets/" + l.photo} alt={l.name} style={{ width: "100%", height: "100%", objectFit: "cover", maxWidth: "none" }} />}
      </Bx>
      <Bx l={593} t={401} r={950} b={402} style={{ background: "#e6e2de" }} />
      <Tr r={948} y={423} s={14} c="#54545c">سعر الحيوان : {l ? fmt(l.price) + " ريال" : ""}</Tr>
      {p && <>
        <Tr r={948} y={441} s={14} c="#54545c" style={{ animation: "fadeUp .4s both" }}>قيمة التوصيل : {fmt(p.fee)} ريال</Tr>
        <Tr r={948} y={459} s={14} c="#54545c" style={{ animation: "fadeUp .4s .05s both" }}>الضريبة المضافة : {fmt(p.vat)} ريال</Tr>
        <Tr r={948} y={503} s={24} c="#54545c" style={{ animation: "fadeUp .4s .1s both" }}>الاجمالي : {fmt(p.total)} ريال</Tr>
        <Tr r={948} y={530} s={14} c="#87442f" style={{ animation: "fadeUp .4s .15s both" }}>العربون المطلوب للحجز (5%) : {fmt(p.deposit)} ريال</Tr>
      </>}

      {/* delivery type */}
      <Tr r={544} y={144} s={20} c="#5d3d32">نوع التوصيل :</Tr>
      {dcard("delivery", 305, 447, "توصيل", "التوصيل لباب منزلك", <Truck size={34} sw={1.6} />)}
      {dcard("pickup", 134, 276, "استلام شخصي", "استلمها مباشرة من البائع", <Pin size={34} sw={1.4} />)}

      {/* contact info */}
      <Tr r={547} y={255} s={20} c="#5d3d32">معلومات التواصل :</Tr>
      <Tr r={473} y={281} s={16}>رقم الهاتف :</Tr>
      <Bx l={139} t={260} r={383} b={301}><input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" aria-label="رقم الهاتف" style={{ ...BOXSTYLE, width: "100%", height: "100%", padding: "0 14px", fontSize: 16, textAlign: "right", outline: "none" }} /></Bx>
      <Tr r={473} y={346} s={16} style={{ opacity: isDel ? 1 : .35 }}>العنوان الوطني :</Tr>
      <Bx l={139} t={325} r={383} b={366}><input value={address} disabled={!isDel} onChange={(e) => setAddress(e.target.value)} aria-label="العنوان الوطني" style={{ ...BOXSTYLE, width: "100%", height: "100%", padding: "0 14px", fontSize: 16, outline: "none", opacity: isDel ? 1 : .35 }} /></Bx>
      <Tr r={473} y={404} s={16}>تفاصيل اخرى :</Tr>
      <Bx l={139} t={396} r={383} b={502}><textarea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="تفاصيل اخرى" style={{ ...BOXSTYLE, width: "100%", height: "100%", padding: "10px 14px", fontSize: 16, resize: "none", outline: "none", fontFamily: "inherit" }} /></Bx>

      {/* submit */}
      <Bx l={25} t={571} r={138} b={603} key={shake} className={shake ? "shake" : ""}>
        <button type="button" onClick={send} disabled={busy || !listingId} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: "100%", background: "#fff", border: "2px solid #87442f", borderRadius: 10, color: "#87442f", fontWeight: 700, fontSize: 16, opacity: !listingId ? .55 : 1, transition: "background .2s, color .2s" }} className="hover:!bg-[#87442f] hover:!text-white">
          {busy ? <span className="spinner" style={{ width: 16, height: 16, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }} /> : <>إرسال الطلب <ArrowLeft size={16} /></>}
        </button>
      </Bx>
      {err && <div role="alert" className="fade-up" style={{ position: "absolute", left: 25 * K, top: 612 * K, width: 360, color: "#b3261e", fontSize: 14, fontWeight: 600 }}>{err}</div>}
      <StageFooter />
    </Stage>
  );
}

/* ====================================================================
   5) ORDERS TABLE (طلباتي)
   ==================================================================== */
function Orders({ route }) {
  const { data: orders, error, loading } = useApi("/api/orders");
  const cols = [["رقم الطلب", 959, 920], ["المنتج", 792, 785], ["البائع", 645, 658], ["الحالة", 509, 517], ["التاريخ", 378, 366], ["السعر", 229, 211]];
  return (
    <Stage bg="#faf6f2">
      <Header path={route.path} dy={0} />
      <Breadcrumb r={963} y={91} items={[["الرئيسية", "/"], ["طلباتي"]]} />
      <Tr r={902} y={147} s={36} w={600}>طلباتي</Tr>
      {cols.map(([t, r]) => <Tr key={t} r={r} y={210} s={20} w={700}>{t}</Tr>)}
      <Bx l={65} t={237.5} r={959} b={241} style={{ background: "#dedad7", borderRadius: 2 }} />
      {loading && <Tc x={512} y={300} s={18} c="#87442f">جاري التحميل…</Tc>}
      {error && <Tc x={512} y={300} s={18} c="#b3261e">{error.message}</Tc>}
      {orders && orders.length === 0 && <Tc x={512} y={300} s={18} c="#54545c">لا توجد طلبات بعد. <a href="#/orders/new" style={{ color: "#bb5a34", textDecoration: "underline" }}>احجز الآن</a></Tc>}
      {(orders || []).map((o, i) => {
        const top = 267 + i * 80.5, vals = ["#" + o.id, o.listing.name, o.listing.seller, o.statusLabel, fmtDate(o.date), fmt(o.pricing.total) + " ر.س"];
        return (
          <a key={o.id} href={"#/orders/" + o.id} className="order-row slide-in" style={{ position: "absolute", left: 63 * K, top: top * K, width: 898 * K, height: 58 * K, background: "#fff", borderRadius: 14, display: "block", animationDelay: i * 90 + "ms", transition: "transform .2s, box-shadow .2s" }}>
            {vals.map((v, j) => <span key={j} style={{ position: "absolute", left: cols[j][2] * K - 63 * K, top: "50%", transform: "translate(-50%,-50%)", fontSize: 15, whiteSpace: "nowrap", color: j === 3 ? STATUS_COLOR[o.status] : "#000", fontWeight: j === 3 ? 600 : 400 }}>{v}</span>)}
            <span className="row-arrow" style={{ position: "absolute", left: 81 * K - 63 * K - 15, top: "50%", marginTop: -15, color: "#87442f", transition: "transform .2s" }}><ArrowLeft size={30} sw={1.6} /></span>
          </a>
        );
      })}
    </Stage>
  );
}

/* ====================================================================
   6) ORDER DETAILS
   ==================================================================== */
function OrderDetails({ route, id }) {
  const { data: o, error, loading } = useApi("/api/orders/" + encodeURIComponent(id));
  if (error) return <NotFound route={route} msg={error.message} />;
  const valBox = (l_, t_, b_, text, align = "center") => (
    <Bx l={l_} t={t_} r={383} b={b_} style={{ ...BOXSTYLE, display: "flex", alignItems: "center", justifyContent: align === "center" ? "center" : "flex-end", padding: "4px 10px", fontSize: 14, lineHeight: 1.45, textAlign: "right", animation: "fadeUp .5s both" }}>{text}</Bx>
  );
  return (
    <Stage bg="#fffdfc">
      <Header path={route.path} dy={-7} />
      <Breadcrumb bar r={993} y={79} items={[["الرئيسية", "/"], ["طلباتي", "/orders"], ["#" + id]]} />
      {loading && <Tc x={512} y={300} s={18} c="#87442f">جاري التحميل…</Tc>}
      {o && <>
        <Tr r={552} y={130} s={21} c="#5d3d32">حالة الطلب : <span style={{ color: STATUS_COLOR[o.status] }}>[ {o.statusLabel} ]</span></Tr>
        <Tr r={547} y={160} s={20} c="#5d3d32">رقم الطلب : <span style={{ color: "#000", fontWeight: 400, fontSize: 16 }} dir="ltr">#{o.id}</span></Tr>
        <Tr r={544} y={187} s={20} c="#5d3d32">التاريخ : <span style={{ color: "#000", fontWeight: 400, fontSize: 16 }}>{fmtDate(o.date)}</span></Tr>
        <Tr r={544} y={220} s={20} c="#5d3d32">نوع التوصيل : <span style={{ color: "#000", fontWeight: 400, fontSize: 16 }}>{o.deliveryLabel}</span></Tr>
        <Tr r={547} y={255} s={20} c="#5d3d32">معلومات التواصل :</Tr>
        <Tr r={473} y={289} s={16}>رقم الهاتف :</Tr>
        {valBox(273, 267, 309, <span dir="ltr">{o.phone}</span>)}
        {o.deliveryType === "delivery" && <>
          <Tr r={473} y={346} s={16}>العنوان الوطني :</Tr>
          {valBox(169, 325, 367, o.address)}
        </>}
        {o.notes && <>
          <Tr r={473} y={404} s={16}>تفاصيل اخرى :</Tr>
          {valBox(169, 396, 442, o.notes, "end")}
        </>}

        <Tr r={695} y={141} s={12} w={500} c="#222">النوع: {o.listing.kind}</Tr>
        <Tr r={695} y={164} s={12} w={500} c="#222">العمر: {o.listing.age}</Tr>
        <Tr r={695} y={187} s={12} w={500} c="#222">السعر: {fmt(o.listing.price)} ريال</Tr>
        <Bx l={707} t={132} r={965} b={389} style={{ background: "#e2bea4", borderRadius: 10, overflow: "hidden" }}><img className="pop" src={"assets/" + o.listing.photo} alt={o.listing.name} style={{ width: "100%", height: "100%", objectFit: "cover", maxWidth: "none" }} /></Bx>
        <Bx l={593} t={401} r={965} b={402} style={{ background: "#e6e2de" }} />
        <Tr r={963} y={423} s={14} c="#54545c">سعر الحيوان : {fmt(o.pricing.price)} ريال</Tr>
        <Tr r={963} y={441} s={14} c="#54545c">قيمة التوصيل : {fmt(o.pricing.deliveryFee)} ريال</Tr>
        <Tr r={963} y={459} s={14} c="#54545c">الضريبة المضافة : {fmt(o.pricing.vat)} ريال</Tr>
        <Tr r={961} y={503} s={26} c="#6b6b72">الاجمالي : {fmt(o.pricing.total)} ريال</Tr>
      </>}
      <StageFooter />
    </Stage>
  );
}

/* ====================================================================
   7) DASHBOARDS — buyer, seller, admin.
      Every TAB is its own component that calls its own API endpoint
      when it opens (see the path passed to useApi in each one).
   ==================================================================== */
const VERIFY = { pending_review: ["قيد المراجعة", "#b7791f"], active: ["موثّق", "#3a7d44"], rejected: ["مرفوض", "#b3261e"], none: ["—", "#888"] };
const LISTING_STATUS = { active: ["منشور", "#3a7d44"], hidden: ["مخفي", "#888"], blocked: ["موقوف", "#b3261e"] };
const Pill = ({ text, color }) => <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold text-white whitespace-nowrap" style={{ background: color }}>{text}</span>;
const Panel = ({ title, children, action }) => (
  <section className="bg-white rounded-2xl border border-[#f0e6dd] shadow-sm p-5 mb-5">
    {(title || action) && <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-lg text-brown-dark">{title}</h2>{action}</div>}
    {children}
  </section>
);
const Stat = ({ label, value, hint, i = 0 }) => (
  <div className="bg-white rounded-2xl border border-[#f0e6dd] shadow-sm p-4 pop" style={{ animationDelay: i * 70 + "ms" }}>
    <p className="text-sm text-gray">{label}</p>
    <p className="text-3xl font-bold text-brown mt-1">{value}</p>
    {hint && <p className="text-xs text-gray mt-1">{hint}</p>}
  </div>
);
function Async({ q, children }) {            // shows loading / error / the tab's content
  if (q.loading) return <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl bg-tan/30 animate-pulse" />)}</div>;
  if (q.error) return <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-4">{q.error.message}</p>;
  return children(q.data);
}
const Table = ({ head, rows, empty = "لا توجد بيانات." }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm text-right">
      <thead><tr className="text-gray border-b border-[#f0e6dd]">{head.map((h) => <th key={h} className="py-2 px-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
      <tbody>{rows.length ? rows : <tr><td colSpan={head.length} className="py-6 text-center text-gray">{empty}</td></tr>}</tbody>
    </table>
  </div>
);
const Td = ({ children, className = "" }) => <td className={"py-2.5 px-2 border-b border-[#f7f0ea] " + className}>{children}</td>;
const StatusBreakdown = ({ byStatus, labels }) => (
  <div className="flex flex-wrap gap-3">
    {Object.keys(labels).map((k) => <div key={k} className="flex items-center gap-2 bg-[#faf6f2] rounded-xl px-3 py-2"><Pill text={labels[k]} color={STATUS_COLOR[k]} /><b className="text-brown-dark">{byStatus[k] || 0}</b></div>)}
  </div>
);
const Field = ({ label, children }) => <label className="block"><span className="block text-xs font-semibold text-brown-dark mb-1">{label}</span>{children}</label>;
const inputCls = "w-full h-10 px-3 rounded-lg bg-white border border-tan outline-none focus:border-primary text-sm";

function DashShell({ route, title, subtitle, tabs, render }) {
  const tab = tabs.some((t) => t.id === route.query.tab) ? route.query.tab : tabs[0].id;
  return (
    <div style={{ background: "#faf6f2", minHeight: "100vh" }}>
      <Header path={route.path} />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="fade-up"><h1 className="text-3xl font-bold text-brown-dark">{title}</h1><p className="text-gray mt-1">{subtitle}</p></div>
        <div role="tablist" className="flex gap-2 mt-6 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <a key={t.id} role="tab" aria-selected={tab === t.id} href={`#${route.path}?tab=${t.id}`}
               className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap transition ${tab === t.id ? "bg-primary text-white shadow" : "bg-white text-brown-dark hover:bg-tan/30"}`}>{t.label}</a>
          ))}
        </div>
        <div key={tab} className="slide-in mt-6">{render(tab)}</div>
      </main>
      <PageFooter />
    </div>
  );
}
const useDashboardGuard = (role) => { const { user } = useAuth(); return user && user.role === role; };

/* ----- buyer ----- */
function BuyerOverview() {
  const q = useApi("/api/buyer/stats");
  return <Async q={q}>{(s) => (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
        <Stat i={0} label="عدد الطلبات" value={s.orders} />
        <Stat i={1} label="إجمالي قيمة الطلبات" value={fmt(s.totalSpent) + " ر.س"} />
        <Stat i={2} label="العرابين (5%)" value={fmt(s.deposits) + " ر.س"} hint="تأمين الحجز" />
      </div>
      <Panel title="حالة طلباتك"><StatusBreakdown byStatus={s.byStatus} labels={s.statusLabels} /></Panel>
      <Panel title="آخر طلب" action={<a className="btn btn--sm" href="#/orders/new">طلب جديد</a>}>
        {s.latest ? (
          <a href={"#/orders/" + s.latest.id} className="flex items-center gap-4 hover:bg-[#faf6f2] rounded-xl p-2 transition">
            <img src={"assets/" + s.latest.listing.image} alt="" className="w-16 h-16 rounded-xl object-cover bg-tan/40" />
            <div className="flex-1"><b className="text-brown-dark">{s.latest.listing.name}</b><p className="text-sm text-gray">#{s.latest.id} · {fmtDate(s.latest.date)}</p></div>
            <Pill text={s.latest.statusLabel} color={STATUS_COLOR[s.latest.status]} />
          </a>
        ) : <p className="text-gray">لم تطلب شيئاً بعد. <a className="text-primary underline" href="#/browse">تصفح المواشي</a></p>}
      </Panel>
    </>
  )}</Async>;
}
function BuyerOrders() {
  const q = useApi("/api/orders");
  return <Async q={q}>{(os) => (
    <Panel title="طلباتي">
      <Table head={["رقم الطلب", "المنتج", "البائع", "الحالة", "التاريخ", "الإجمالي"]} empty="لا توجد طلبات بعد."
        rows={os.map((o) => <tr key={o.id} className="hover:bg-[#faf6f2] cursor-pointer" onClick={() => go("/orders/" + o.id)}>
          <Td><a className="text-primary font-bold" href={"#/orders/" + o.id}>#{o.id}</a></Td><Td>{o.listing.name}</Td><Td>{o.listing.seller}</Td>
          <Td><Pill text={o.statusLabel} color={STATUS_COLOR[o.status]} /></Td><Td>{fmtDate(o.date)}</Td><Td className="font-bold">{fmt(o.pricing.total)} ر.س</Td></tr>)} />
    </Panel>
  )}</Async>;
}
function AccountTab() {
  const q = useApi("/api/auth/me");
  return <Async q={q}>{({ user: u }) => (
    <Panel title="بيانات الحساب">
      <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
        <dt className="text-gray">الاسم</dt><dd className="font-semibold">{u.profile?.firstName} {u.profile?.lastName}</dd>
        <dt className="text-gray">البريد</dt><dd className="font-semibold" dir="ltr" style={{ textAlign: "right" }}>{u.email}</dd>
        <dt className="text-gray">الجوال</dt><dd className="font-semibold" dir="ltr" style={{ textAlign: "right" }}>{u.profile?.phone}</dd>
        <dt className="text-gray">المدينة</dt><dd className="font-semibold">{u.profile?.city}</dd>
        <dt className="text-gray">نوع الحساب</dt><dd className="font-semibold">{{ buyer: "مشتري", seller: "بائع", admin: "مدير" }[u.role]}</dd>
        {u.role === "seller" && <><dt className="text-gray">حالة التوثيق</dt><dd><Pill text={VERIFY[u.verification.status][0]} color={VERIFY[u.verification.status][1]} /></dd></>}
        {u.verification?.documents?.length > 0 && <><dt className="text-gray">المستندات</dt><dd><ul className="space-y-1">{u.verification.documents.map((d) => <li key={d.kind}>{d.label}: <span dir="ltr" className="text-gray">{d.fileName}</span></li>)}</ul></dd></>}
      </dl>
    </Panel>
  )}</Async>;
}
function BuyerDash({ route }) {
  const { user } = useAuth();
  return <DashShell route={route} title={`أهلاً ${user.profile?.firstName || ""}`} subtitle="لوحة المشتري — طلباتك وحجوزاتك"
    tabs={[{ id: "overview", label: "نظرة عامة" }, { id: "orders", label: "طلباتي" }, { id: "account", label: "حسابي" }]}
    render={(t) => (t === "overview" ? <BuyerOverview /> : t === "orders" ? <BuyerOrders /> : <AccountTab />)} />;
}

/* ----- seller ----- */
function SellerOverview() {
  const q = useApi("/api/seller/stats");
  return <Async q={q}>{(s) => {
    const [vt, vc] = VERIFY[s.verification.status];
    return (
      <>
        <div className="rounded-2xl p-4 mb-5 text-white fade-up" style={{ background: vc }} role="status">
          <b>حالة التوثيق: {vt}</b>
          <p className="text-sm opacity-95">{s.verification.status === "pending_review" ? "مستنداتك عند الإدارة للمراجعة. يمكنك نشر الإعلانات بعد الموافقة." : s.verification.status === "rejected" ? `تم رفض الطلب${s.verification.note ? ": " + s.verification.note : "."}` : "حسابك موثّق ويمكنك نشر الإعلانات."}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <Stat i={0} label="إعلاناتي" value={s.listings} hint={`${s.activeListings} منشور`} />
          <Stat i={1} label="الطلبات الواردة" value={s.orders} />
          <Stat i={2} label="قيمة المبيعات" value={fmt(s.revenue) + " ر.س"} hint="بدون التوصيل والضريبة" />
          <Stat i={3} label="قيد التجهيز" value={s.byStatus.processing || 0} />
        </div>
        <Panel title="حالة الطلبات"><StatusBreakdown byStatus={s.byStatus} labels={s.statusLabels} /></Panel>
      </>
    );
  }}</Async>;
}
function SellerListings() {
  const q = useApi("/api/seller/listings");
  const cats = useApi("/api/content");
  const [f, setF] = useState({ name: "", category: "sheep", age: "", price: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await api("/api/seller/listings", { method: "POST", body: f }); setF({ name: "", category: "sheep", age: "", price: "" }); q.reload(); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const patch = async (id, body) => { try { await api("/api/seller/listings/" + id, { method: "PATCH", body }); q.reload(); } catch (x) { alert(x.message); } };
  return (
    <>
      <Panel title="إعلان جديد">
        <form onSubmit={add} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <Field label="اسم الحيوان"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="الفئة"><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(cats.data?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="العمر"><input className={inputCls} placeholder="مثال: 8 أشهر" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })} /></Field>
          <Field label="السعر (ر.س)"><input className={inputCls} type="number" min="100" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <button className="btn" disabled={busy}>{busy ? "..." : "نشر الإعلان"}</button>
        </form>
        {err && <p role="alert" className="text-red-700 text-sm mt-3 shake">{err}</p>}
      </Panel>
      <Async q={q}>{(ls) => (
        <Panel title="إعلاناتي">
          <Table head={["الحيوان", "الفئة", "العمر", "السعر", "الحالة", ""]} empty="لا توجد إعلانات بعد."
            rows={ls.map((l) => <ListingRow key={l.id} l={l} patch={patch} />)} />
        </Panel>
      )}</Async>
    </>
  );
}
function ListingRow({ l, patch }) {
  const [price, setPrice] = useState(l.price);
  const [st, sc] = LISTING_STATUS[l.status] || LISTING_STATUS.hidden;
  return (
    <tr>
      <Td><div className="flex items-center gap-2"><img src={"assets/" + l.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-tan/40" /><b>{l.name}</b></div></Td>
      <Td>{{ sheep: "غنم", cattle: "بقر", camel: "حاشي" }[l.category]}</Td><Td>{l.age}</Td>
      <Td><div className="flex items-center gap-1"><input type="number" className="w-24 h-8 px-2 rounded-lg border border-tan text-sm" value={price} onChange={(e) => setPrice(e.target.value)} />{Number(price) !== l.price && <button className="text-primary font-bold text-xs" onClick={() => patch(l.id, { price })}>حفظ</button>}</div></Td>
      <Td><Pill text={st} color={sc} /></Td>
      <Td>{l.status !== "blocked" && <button className="text-brown underline text-xs" onClick={() => patch(l.id, { status: l.status === "active" ? "hidden" : "active" })}>{l.status === "active" ? "إخفاء" : "نشر"}</button>}</Td>
    </tr>
  );
}
function SellerOrders() {
  const q = useApi("/api/seller/orders");
  return <Async q={q}>{(os) => (
    <Panel title="الطلبات الواردة">
      <Table head={["رقم الطلب", "المنتج", "المشتري", "المدينة", "الاستلام", "الحالة", "قيمة الحيوان"]} empty="لا توجد طلبات واردة بعد."
        rows={os.map((o) => <tr key={o.id} className="hover:bg-[#faf6f2] cursor-pointer" onClick={() => go("/orders/" + o.id)}>
          <Td><a className="text-primary font-bold" href={"#/orders/" + o.id}>#{o.id}</a></Td><Td>{o.listing.name}</Td><Td>{o.buyer?.name}</Td><Td>{o.buyer?.city}</Td>
          <Td>{o.deliveryType === "delivery" ? "توصيل" : "استلام شخصي"}</Td><Td><Pill text={o.statusLabel} color={STATUS_COLOR[o.status]} /></Td><Td className="font-bold">{fmt(o.pricing.price)} ر.س</Td></tr>)} />
    </Panel>
  )}</Async>;
}
function SellerDash({ route }) {
  const { user } = useAuth();
  return <DashShell route={route} title={user.profile?.businessName || `أهلاً ${user.profile?.firstName || ""}`} subtitle="لوحة البائع — إعلاناتك وطلباتك"
    tabs={[{ id: "overview", label: "نظرة عامة" }, { id: "listings", label: "إعلاناتي" }, { id: "orders", label: "الطلبات الواردة" }, { id: "account", label: "حسابي" }]}
    render={(t) => (t === "overview" ? <SellerOverview /> : t === "listings" ? <SellerListings /> : t === "orders" ? <SellerOrders /> : <AccountTab />)} />;
}

/* ----- admin ----- */
function AdminOverview() {
  const q = useApi("/api/admin/stats");
  return <Async q={q}>{(s) => (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Stat i={0} label="المستخدمون" value={s.users} hint={`${s.byRole.buyer || 0} مشتري · ${s.byRole.seller || 0} بائع`} />
        <Stat i={1} label="بائعون بانتظار التوثيق" value={s.pendingSellers} />
        <Stat i={2} label="الإعلانات" value={s.listings} hint={`${s.activeListings} منشور`} />
        <Stat i={3} label="قيمة الطلبات" value={fmt(s.sales) + " ر.س"} hint={`${s.orders} طلب`} />
      </div>
      <Panel title="حالة الطلبات"><StatusBreakdown byStatus={s.byStatus} labels={s.statusLabels} /></Panel>
      <p className="text-xs text-gray">التخزين الحالي: {s.storage === "firebase" ? "Firebase (Authentication + Firestore)" : "ملف محلي db.json"}</p>
    </>
  )}</Async>;
}
function AdminVerifications() {
  const q = useApi("/api/admin/verifications");
  const [note, setNote] = useState({});
  const decide = async (id, decision) => { try { await api("/api/admin/verifications/" + id, { method: "POST", body: { decision, note: note[id] || "" } }); q.reload(); } catch (x) { alert(x.message); } };
  return <Async q={q}>{(list) => (
    <div className="space-y-4">
      {list.length === 0 && <Panel><p className="text-gray text-center py-4">لا يوجد بائعون.</p></Panel>}
      {list.map((s) => {
        const [vt, vc] = VERIFY[s.verification.status];
        return (
          <Panel key={s.id}>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <b className="text-lg text-brown-dark">{s.business}</b><Pill text={vt} color={vc} />
              <span className="text-sm text-gray">{s.sellerType === "business" ? "منشأة" : "فردي"} · {s.city}{s.crNumber ? ` · سجل ${s.crNumber}` : ""}</span>
              <span className="text-sm text-gray" dir="ltr">{s.email}</span>
            </div>
            <ul className="grid md:grid-cols-3 gap-2 text-sm mb-3">
              {s.verification.documents.map((d) => <li key={d.kind} className="bg-[#faf6f2] rounded-lg p-2"><span className="block text-gray text-xs">{d.label}</span><span dir="ltr">{d.fileName}</span> <span dir="ltr" className="text-xs text-gray inline-block">· {Math.max(1, Math.round(d.fileSize / 1024))} KB</span></li>)}
            </ul>
            {s.verification.status !== "active" && (
              <div className="flex flex-wrap gap-2 items-center">
                <button className="btn btn--sm" onClick={() => decide(s.id, "approve")}>اعتماد</button>
                <input className="h-8 px-2 rounded-lg border border-tan text-sm flex-1 min-w-[160px]" placeholder="سبب الرفض (اختياري)" value={note[s.id] || ""} onChange={(e) => setNote({ ...note, [s.id]: e.target.value })} />
                <button className="btn btn--sm btn--outline" onClick={() => decide(s.id, "reject")}>رفض</button>
              </div>
            )}
            {s.verification.status === "active" && <button className="text-sm text-red-700 underline" onClick={() => decide(s.id, "reject")}>سحب التوثيق</button>}
            {s.verification.note && <p className="text-sm text-gray mt-2">ملاحظة: {s.verification.note}</p>}
          </Panel>
        );
      })}
    </div>
  )}</Async>;
}
function AdminOrders() {
  const q = useApi("/api/admin/orders");
  const [labels] = useState({ processing: "قيد التجهيز", shipping: "جاري التوصيل", delivered: "تم التسليم" });
  const set = async (id, status) => { try { await api("/api/admin/orders/" + id, { method: "PATCH", body: { status } }); q.reload(); } catch (x) { alert(x.message); } };
  return <Async q={q}>{(os) => (
    <Panel title="كل الطلبات">
      <Table head={["رقم الطلب", "المشتري", "المنتج", "البائع", "الإجمالي", "التاريخ", "الحالة"]}
        rows={os.map((o) => <tr key={o.id}>
          <Td><a className="text-primary font-bold" href={"#/orders/" + o.id}>#{o.id}</a></Td><Td>{o.buyer}</Td><Td>{o.listing.name}</Td><Td>{o.listing.seller}</Td>
          <Td className="font-bold">{fmt(o.pricing.total)} ر.س</Td><Td>{fmtDate(o.date)}</Td>
          <Td><select aria-label="الحالة" className="h-8 rounded-lg border border-tan text-sm px-1" style={{ color: STATUS_COLOR[o.status] }} value={o.status} onChange={(e) => set(o.id, e.target.value)}>{Object.keys(labels).map((k) => <option key={k} value={k}>{labels[k]}</option>)}</select></Td></tr>)} />
    </Panel>
  )}</Async>;
}
function AdminListings() {
  const q = useApi("/api/admin/listings");
  const set = async (id, status) => { try { await api("/api/admin/listings/" + id, { method: "PATCH", body: { status } }); q.reload(); } catch (x) { alert(x.message); } };
  return <Async q={q}>{(ls) => (
    <Panel title="كل الإعلانات">
      <Table head={["الحيوان", "البائع", "السعر", "الحالة"]}
        rows={ls.map((l) => <tr key={l.id}><Td><div className="flex items-center gap-2"><img src={"assets/" + l.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-tan/40" /><b>{l.name}</b></div></Td><Td>{l.seller}</Td><Td>{fmt(l.price)} ر.س</Td>
          <Td><select aria-label="حالة الإعلان" className="h-8 rounded-lg border border-tan text-sm px-1" style={{ color: (LISTING_STATUS[l.status] || [])[1] }} value={l.status} onChange={(e) => set(l.id, e.target.value)}>{Object.entries(LISTING_STATUS).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}</select></Td></tr>)} />
    </Panel>
  )}</Async>;
}
function AdminUsers() {
  const q = useApi("/api/admin/users");
  return <Async q={q}>{(us) => (
    <Panel title="المستخدمون">
      <Table head={["الاسم", "البريد", "النوع", "التوثيق", "منذ"]}
        rows={us.map((u) => <tr key={u.id}><Td><b>{u.name}</b></Td><Td><span dir="ltr">{u.email}</span></Td><Td>{{ buyer: "مشتري", seller: "بائع", admin: "مدير" }[u.role] || "لم يكمل التسجيل"}</Td>
          <Td>{u.role === "seller" ? <Pill text={VERIFY[u.verification.status][0]} color={VERIFY[u.verification.status][1]} /> : "—"}</Td><Td>{u.createdAt && fmtDate(u.createdAt)}</Td></tr>)} />
    </Panel>
  )}</Async>;
}
function AdminDash({ route }) {
  return <DashShell route={route} title="لوحة الإدارة" subtitle="إدارة المستخدمين والتوثيق والطلبات والإعلانات"
    tabs={[{ id: "overview", label: "نظرة عامة" }, { id: "verify", label: "توثيق البائعين" }, { id: "orders", label: "الطلبات" }, { id: "listings", label: "الإعلانات" }, { id: "users", label: "المستخدمون" }]}
    render={(t) => ({ overview: <AdminOverview />, verify: <AdminVerifications />, orders: <AdminOrders />, listings: <AdminListings />, users: <AdminUsers /> }[t])} />;
}

/* ====================================================================
   8) FAQ + 404 (simple pages)
   ==================================================================== */
function Faq({ route }) {
  const site = useSite();
  return (
    <Stage bg="#faf6f2">
      <Header path={route.path} />
      <Breadcrumb r={963} y={91} items={[["الرئيسية", "/"], [site?.faqTitle || ""]]} />
      <Tr r={902} y={147} s={36} w={600}>{site?.faqTitle}</Tr>
      <div style={{ position: "absolute", left: 140, right: 140, top: 230 }}>
        {(site?.faq || []).map((x, i) => <div key={x.q} className="slide-in" style={{ animationDelay: i * 90 + "ms", background: "#fff", borderRadius: 14, padding: "18px 24px", marginBottom: 18 }}><h3 style={{ fontWeight: 700, fontSize: 20, color: "#5d3d32" }}>{x.q}</h3><p style={{ marginTop: 6, fontSize: 16, color: "#54545c" }}>{x.a}</p></div>)}
      </div>
      <StageFooter />
    </Stage>
  );
}
function NotFound({ route, msg }) {
  return (
    <Stage bg="#faf6f2">
      <Header path={route.path} />
      <Tc x={512} y={260} s={80} w={700} c="#bb5a34">404</Tc>
      <Tc x={512} y={330} s={22} w={600} c="#5d3d32">{msg || "الصفحة غير موجودة."}</Tc>
      <a className="btn" href="#/" style={{ position: "absolute", left: 512 * K - 80, top: 380 * K }}>العودة للرئيسية</a>
      <StageFooter />
    </Stage>
  );
}

/* ====================================================================
   ROUTER + guards (who may open which page)
   ==================================================================== */
function App() {
  const route = useRoute(); const { user } = useAuth(); const p = route.path;
  useEffect(() => { if (p !== "/browse") window.scrollTo(0, 0); }, [p]);

  const dash = { "/buyer": "buyer", "/seller": "seller", "/admin": "admin" }[p];
  const needsLogin = p.startsWith("/orders") || p === "/onboarding" || !!dash;
  const buyerOnly = p === "/orders" || p === "/orders/new";
  useEffect(() => {
    if (user === undefined) return;
    if (needsLogin && !user) go("/login");
    else if (user && !user.profileComplete && (p.startsWith("/orders") || dash)) go("/onboarding");
    else if (user && user.profileComplete && dash && user.role !== dash) go(user.role === "buyer" ? "/buyer" : homeFor(user));
    else if (user && user.profileComplete && buyerOnly && user.role !== "buyer") go(homeFor(user));
  }, [p, user]);
  if (user === undefined) return <div className="p-10 text-center text-brown">…</div>;
  if (needsLogin && !user) return null;

  if (p === "/" || p === "/browse") return <Home route={route} />;
  if (p === "/login") return <AuthScreen mode="login" />;
  if (p === "/signup") return <AuthScreen mode="signup" />;
  if (p === "/onboarding") return <Onboarding />;
  if (p === "/faq") return <Faq route={route} />;
  if (dash && user.role === dash) return dash === "buyer" ? <BuyerDash route={route} /> : dash === "seller" ? <SellerDash route={route} /> : <AdminDash route={route} />;
  if (dash) return null;
  if (p === "/orders") return <Orders route={route} />;
  if (p === "/orders/new") return <OrderForm route={route} />;
  if (p.startsWith("/orders/")) return <OrderDetails route={route} id={decodeURIComponent(p.slice(8))} />;
  return <NotFound route={route} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<AuthProvider><App /></AuthProvider>);
