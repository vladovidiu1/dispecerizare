import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  Inbox,
  LayoutDashboard,
  Users,
  SlidersHorizontal,
  Settings,
  Search,
  Bell,
  ChevronDown,
  ArrowUpRight,
  ArrowDown,
  MoreHorizontal,
  Plus,
  Mail,
  Clock3,
  CheckCheck,
  ArrowLeft,
  Send,
  X,
  CircleHelp,
  PanelLeftClose,
  Sparkles,
  ChevronRight,
  Paperclip,
  Check,
} from "lucide-react";
import "./style.css";
import { api, backendEnabled } from "./api";
import Login from "./Login";
import AiTest from "./AiTest";
const initial = [
  {
    id: 1048,
    name: "Andreea Popescu",
    initials: "AP",
    color: "purple",
    email: "andreea.popescu@companie.ro",
    subject: "Actualizare date contract",
    text: "Bună ziua, aș dori să actualizez datele companiei din contractul nostru. Ne puteți ajuta cu pașii necesari și documentele pe care trebuie să le trimitem? Mulțumesc pentru ajutor!",
    category: "Administrativ",
    priority: "Medie",
    status: "Nou",
    time: "10:42",
    agent: "Maria Ionescu",
  },
  {
    id: 1047,
    name: "Mihai Dumitrescu",
    initials: "MD",
    color: "blue",
    email: "mihai.d@exemplu.ro",
    subject: "Acces la contul de utilizator",
    text: "Bună ziua, nu mai reușesc să accesez contul. Am încercat resetarea parolei, dar nu primesc mesajul de confirmare.",
    category: "Suport tehnic",
    priority: "Ridicată",
    status: "În lucru",
    time: "10:28",
    agent: "Alex Popa",
  },
  {
    id: 1046,
    name: "Elena Radu",
    initials: "ER",
    color: "orange",
    email: "elena.radu@exemplu.ro",
    subject: "Solicitare ofertă servicii",
    text: "Bună ziua! Suntem interesați de serviciile dumneavoastră și am dori o ofertă personalizată pentru echipa noastră.",
    category: "Vânzări",
    priority: "Medie",
    status: "Nou",
    time: "10:15",
    agent: "Maria Ionescu",
  },
  {
    id: 1045,
    name: "Cristian Stan",
    initials: "CS",
    color: "green",
    email: "cristian@exemplu.ro",
    subject: "Clarificări factură #INV-2024-089",
    text: "Vă rog să ne ajutați cu o detaliere a serviciilor facturate în ultima lună. Avem câteva întrebări despre costurile suplimentare.",
    category: "Facturare",
    priority: "Ridicată",
    status: "În lucru",
    time: "09:56",
    agent: "Ioana Marin",
  },
  {
    id: 1044,
    name: "Ioana Georgescu",
    initials: "IG",
    color: "pink",
    email: "ioana.g@exemplu.ro",
    subject: "Confirmare primire documente",
    text: "Vă mulțumesc pentru documentele trimise. Vă confirm că am primit totul și că informațiile sunt complete.",
    category: "Administrativ",
    priority: "Scăzută",
    status: "Rezolvat",
    time: "09:41",
    agent: "Maria Ionescu",
  },
  {
    id: 1043,
    name: "Radu Marinescu",
    initials: "RM",
    color: "blue",
    email: "radu.m@exemplu.ro",
    subject: "Integrare cu platforma existentă",
    text: "Am avea nevoie de câteva informații despre posibilitățile de integrare cu platforma pe care o folosim în prezent.",
    category: "Suport tehnic",
    priority: "Medie",
    status: "Nou",
    time: "09:24",
    agent: "Alex Popa",
  },
  {
    id: 1042,
    name: "Diana Pavel",
    initials: "DP",
    color: "orange",
    email: "diana@exemplu.ro",
    subject: "Revenire solicitare de ieri",
    text: "Revin cu un mesaj privind solicitarea trimisă ieri. Ne puteți comunica un termen estimativ?",
    category: "Vânzări",
    priority: "Medie",
    status: "În lucru",
    time: "09:08",
    agent: "Maria Ionescu",
  },
];
const agents = [
  {
    name: "Maria Ionescu",
    initials: "MI",
    role: "Agent",
    skills: ["Administrativ", "Vânzări"],
    load: 12,
    color: "purple",
  },
  {
    name: "Alex Popa",
    initials: "AP",
    role: "Agent",
    skills: ["Suport tehnic"],
    load: 8,
    color: "blue",
  },
  {
    name: "Ioana Marin",
    initials: "IM",
    role: "Agent",
    skills: ["Facturare", "Administrativ"],
    load: 6,
    color: "green",
  },
];
function App() {
  const [user, setUser] = useState(null),
    [authLoaded, setAuthLoaded] = useState(!backendEnabled),
    [skills, setSkills] = useState([]),
    [history, setHistory] = useState([]),
    [notes, setNotes] = useState([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0);
  const [page, setPage] = useState("overview"),
    [role, setRole] = useState("Administrator"),
    [messages, setMessages] = useState(backendEnabled ? [] : initial),
    [filter, setFilter] = useState("Toate mesajele"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(null),
    [reply, setReply] = useState(""),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState(false),
    [team, setTeam] = useState(backendEnabled ? [] : agents),
    [notice, setNotice] = useState(false);
  const notify = (t) => {
    setToast(t);
    setTimeout(() => setToast(""), 3500);
  };
  async function refresh(pageOffset = offset) {
    const [m, a, s] = await Promise.all([
      api("/messages?limit=100&offset=" + pageOffset),
      api("/agents"),
      api("/skills"),
    ]);
    setMessages(m.items);
    setTotal(m.total);
    setTeam(a);
    setSkills(s);
  }
  useEffect(() => {
    if (!backendEnabled) return;
    api("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthLoaded(true));
  }, []);
  useEffect(() => {
    if (!user) return;
    setRole(user.role === "admin" ? "Administrator" : "Agent");
    refresh().catch((e) => notify(e.message));
    const timer = setInterval(
      () => refresh().catch((e) => notify(e.message)),
      30000,
    );
    return () => clearInterval(timer);
  }, [user, offset]);
  useEffect(() => {
    if (!backendEnabled || !selected) return;
    setHistory([]);
    setNotes([]);
    Promise.all([
      api("/messages/" + selected + "/history"),
      api("/messages/" + selected + "/notes"),
    ])
      .then(([h, n]) => {
        setHistory(h);
        setNotes(n);
      })
      .catch((e) => notify(e.message));
  }, [selected, messages]);
  async function update(id, data) {
    if (!backendEnabled) {
      setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...data } : x)));
      return;
    }
    try {
      const body = {};
      if (data.status) body.status = data.status;
      if ("agentId" in data) body.assignedTo = data.agentId || null;
      if ("skillId" in data) body.skillId = data.skillId || null;
      await api("/messages/" + id, { method: "PATCH", body });
      if ("skillId" in data && role === "Agent") {
        setSelected(null);
        notify(
          "Competența a fost schimbată. Taskul a revenit în distribuire, fără apel AI.",
        );
      }
      await refresh();
    } catch (e) {
      notify(e.message);
    }
  }
  async function saveReply(e) {
    e.preventDefault();
    if (!reply.trim()) return;
    if (backendEnabled) {
      try {
        await api("/messages/" + selected + "/notes", {
          method: "POST",
          body: { body: reply },
        });
        setReply("");
        await refresh();
        notify("Notă internă salvată. Nu s-a trimis un email.");
      } catch (e) {
        notify(e.message);
      }
    } else {
      update(current.id, {
        status: "În lucru",
        replies: [...(current.replies || []), reply],
      });
      setReply("");
      notify(
        "Răspuns salvat în demonstrație. Trimiterea prin email va fi conectată ulterior.",
      );
    }
  }
  async function addAgent(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      name = f.get("name").trim();
    if (!name) return;
    try {
      if (backendEnabled) {
        await api("/agents", {
          method: "POST",
          body: {
            name,
            email: f.get("email"),
            password: f.get("password"),
            skills: f.getAll("skill"),
          },
        });
        await refresh();
      } else
        setTeam([
          ...team,
          {
            name,
            initials: name
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join(""),
            role: "Agent",
            skills: f.getAll("skill"),
            load: 0,
            color: "blue",
          },
        ]);
      setModal(false);
      notify("Agent adăugat.");
    } catch (e) {
      notify(e.message);
    }
  }
  function describeEvent(h) {
    const person = (id) =>
      team.find((a) => a.id === id)?.name || id || "Nealocat";
    if (h.type === "assigned")
      return `${person(h.data.from)} → ${person(h.data.to)} · ${h.data.method === "manual" ? "manual" : "automat"}`;
    if (h.type === "classified")
      return `${skills.find((s) => s.id === h.data.skillId)?.name || "Competență"} · ${Math.round(h.data.confidence * 100)}% · ${h.data.model} · prompt ${h.data.promptVersion}${h.data.reason ? " · " + h.data.reason : ""}`;
    if (h.type === "review_required")
      return (
        {
          low_confidence: "Încredere redusă în clasificare",
          no_eligible_agent: "Niciun agent eligibil disponibil",
          unclassified: "Mesaj neclasificat",
        }[h.data.reason] || h.data.reason
      );
    if (h.data.field) {
      const value = (v) =>
        h.data.field === "skillId"
          ? skills.find((s) => s.id === v)?.name || v || "Fără competență"
          : v;
      return `${h.data.field}: ${value(h.data.from) || "—"} → ${value(h.data.to) || "—"}`;
    }
    return "";
  }
  const visible = messages.filter(
    (m) =>
      (backendEnabled ||
        role === "Administrator" ||
        m.agent === "Maria Ionescu") &&
      (filter === "Toate mesajele" || m.status === filter) &&
      `${m.name} ${m.subject} ${m.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const current = messages.find((m) => m.id === selected);
  const nav = [
    ["overview", LayoutDashboard, "Privire de ansamblu"],
    ["inbox", Inbox, "Mesaje"],
    ["agents", Users, "Echipă & competențe"],
    ["rules", SlidersHorizontal, "Reguli de distribuire"],
    ...(backendEnabled ? [["ai", Sparkles, "Test AI local"]] : []),
  ];
  if (backendEnabled && !authLoaded)
    return <div className="login-page">Se încarcă…</div>;
  if (backendEnabled && !user) return <Login onLogin={setUser} />;
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("overview");
          }}
        >
          <span className="logo">
            r<span>↗</span>
          </span>
          relay<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">W</span>
          <div>
            Workspace principal<small>Spațiul tău de lucru</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">SPAȚIU DE LUCRU</div>
        <nav>
          {nav
            .filter(
              (x) =>
                role === "Administrator" ||
                !["agents", "rules", "ai"].includes(x[0]),
            )
            .map(([id, Icon, label]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => {
                  setPage(id);
                  setSelected(null);
                }}
              >
                <Icon size={19} />
                {label}
                {id === "inbox" && (
                  <span className="nav-count">
                    {messages.filter((m) => m.status === "Nou").length}
                  </span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <span>
              <Sparkles size={16} /> Un flux mai simplu
            </span>
            <p>
              Mesajul potrivit.
              <br />
              La persoana potrivită.
            </p>
            <div className="mini-lines">
              <i />
              <i />
              <i />
            </div>
          </div>
          <button className="side-link" onClick={() => setPage("settings")}>
            <Settings size={18} />
            Setări
          </button>
          <button className="side-link" onClick={() => setPage("help")}>
            <CircleHelp size={18} />
            Ajutor & resurse
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar purple">
              {user
                ? user.name
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")
                : "MI"}
            </span>
            <div>
              {user?.name || "Maria Ionescu"}
              <small>{role}</small>
            </div>
            <button
              aria-label={backendEnabled ? "Deconectare" : "Schimbă rolul"}
              title={
                backendEnabled ? "Deconectare" : "Schimbă rolul demonstrativ"
              }
              onClick={async () => {
                if (backendEnabled) {
                  try {
                    await api("/auth/logout", { method: "POST" });
                    setUser(null);
                    setMessages([]);
                    setTeam([]);
                    setSelected(null);
                    setPage("overview");
                    setQuery("");
                    setFilter("Toate mesajele");
                    setOffset(0);
                  } catch (e) {
                    notify(e.message);
                  }
                } else {
                  setRole(role === "Administrator" ? "Agent" : "Administrator");
                  setPage("overview");
                }
              }}
            >
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Spațiu de lucru
            <ChevronRight size={14} />
            <span>
              {nav.find((x) => x[0] === page)?.[2] ||
                (page === "settings" ? "Setări" : "Ajutor & resurse")}
            </span>
          </div>
          <div className="header-right">
            <span className="demo-pill">
              <i />
              {backendEnabled ? "Conectat la baza de date" : "Mod demonstrativ"}
            </span>
            <button
              className="icon-button"
              aria-label="Notificări"
              onClick={() => setNotice(!notice)}
            >
              <Bell size={19} />
              <i className="notification-dot" />
            </button>
            <span className="header-avatar">
              {user
                ? user.name
                    .split(" ")
                    .map((s) => s[0])
                    .slice(0, 2)
                    .join("")
                : "MI"}
            </span>
          </div>
          {notice && (
            <div className="notifications">
              <strong>Ești la zi</strong>
              <p>
                {messages.filter((m) => m.status === "Nou").length} mesaje noi
                așteaptă să fie preluate.
              </p>
            </div>
          )}
        </header>
        <div className="content">
          {["overview", "inbox"].includes(page) ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {new Intl.DateTimeFormat("ro-RO", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      timeZone: "Europe/Bucharest",
                    })
                      .format(new Date())
                      .toUpperCase()}
                  </div>
                  <h1>
                    {page === "overview"
                      ? "O zi bună începe cu ordine."
                      : "Toate conversațiile, într-un loc."}
                    <span>✳</span>
                  </h1>
                  <p>
                    {page === "overview"
                      ? "Iată ce se întâmplă astăzi în spațiul tău de lucru."
                      : "Gestionează mesajele și oferă fiecărei solicitări atenția potrivită."}
                  </p>
                </div>
                <button
                  className="button white"
                  onClick={() =>
                    backendEnabled
                      ? refresh()
                          .then(() => notify("Date actualizate"))
                          .catch((e) => notify(e.message))
                      : notify("Date demonstrative")
                  }
                >
                  <Clock3 size={16} />
                  Astăzi
                  <ChevronDown size={15} />
                </button>
              </div>
              {page === "overview" && (
                <>
                  <div className="stats">
                    {[
                      [
                        Mail,
                        "Mesaje primite",
                        String(backendEnabled ? total : 48),
                        backendEnabled ? "" : "12%",
                        backendEnabled
                          ? "Total mesaje vizibile"
                          : "față de ieri",
                        "purple",
                      ],
                      [
                        Inbox,
                        "În așteptare",
                        String(
                          messages.filter((m) => m.status === "Nou").length,
                        ),
                        "",
                        "Necesită atenția echipei",
                        "orange",
                      ],
                      [
                        CheckCheck,
                        backendEnabled
                          ? "Rezolvate în pagină"
                          : "Rezolvate astăzi",
                        String(
                          (backendEnabled ? 0 : 31) +
                            messages.filter((m) => m.status === "Rezolvat")
                              .length,
                        ),
                        backendEnabled ? "" : "18%",
                        backendEnabled ? "În pagina curentă" : "față de ieri",
                        "green",
                      ],
                      [
                        Clock3,
                        "Timp mediu de răspuns",
                        backendEnabled ? "—" : "14",
                        backendEnabled ? "" : "8%",
                        backendEnabled
                          ? "În curs de implementare"
                          : "mai rapid decât ieri",
                        "blue",
                      ],
                    ].map(([Icon, label, value, trend, detail, c], i) => (
                      <div className="stat" key={label}>
                        <div className="stat-top">
                          <span>{label}</span>
                          <span className={"stat-icon " + c}>
                            <Icon size={18} />
                          </span>
                        </div>
                        <div className="stat-value">
                          {value}
                          {i === 3 && <small>min</small>}
                        </div>
                        <div className="stat-foot">
                          {trend && (
                            <span className="trend">
                              {i === 3 ? (
                                <ArrowDown size={12} />
                              ) : (
                                <ArrowUpRight size={12} />
                              )}{" "}
                              {trend}
                            </span>
                          )}
                          <span>{detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="overview-bottom">
                    <span className="live-dot" /> Echipa ta este pe poziții.{" "}
                    <strong>
                      {team.filter((a) => a.available !== false).length} agenți
                      disponibili
                    </strong>
                    <span className="right-note">
                      Un pic de ordine. Mai mult timp pentru ce contează.
                    </span>
                  </div>
                </>
              )}
              {current ? (
                <section className="panel detail">
                  <button className="back" onClick={() => setSelected(null)}>
                    <ArrowLeft size={16} /> Înapoi la mesaje
                  </button>
                  <div className="detail-head">
                    <div>
                      <span className="ticket">MESAJ #{current.id}</span>
                      <h2>{current.subject}</h2>
                    </div>
                    <select
                      value={current.status}
                      onChange={(e) =>
                        update(current.id, { status: e.target.value })
                      }
                    >
                      {["Nou", "În lucru", "Rezolvat"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sender">
                    <span className={"avatar " + current.color}>
                      {current.initials}
                    </span>
                    <div>
                      <strong>{current.name}</strong>
                      <small>{current.email}</small>
                    </div>
                    <span>{current.time}</span>
                  </div>
                  <p className="email-body">{current.text}</p>
                  <div className="detail-meta">
                    <span>
                      Competență:{" "}
                      {backendEnabled ? (
                        <select
                          aria-label="Competență mesaj"
                          value={current.skillId || ""}
                          onChange={(e) =>
                            update(current.id, { skillId: e.target.value })
                          }
                        >
                          <option value="" disabled={role !== "Administrator"}>
                            De verificat
                          </option>
                          {skills.map((s) => (
                            <option value={s.id} key={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <b>{current.category}</b>
                      )}
                    </span>
                    <label>
                      Responsabil:{" "}
                      <select
                        disabled={backendEnabled && role !== "Administrator"}
                        value={
                          backendEnabled ? current.agentId || "" : current.agent
                        }
                        onChange={(e) =>
                          update(
                            current.id,
                            backendEnabled
                              ? { agentId: e.target.value }
                              : { agent: e.target.value },
                          )
                        }
                      >
                        <option value={backendEnabled ? "" : "Nealocat"}>
                          Nealocat
                        </option>
                        {team.map((a) => (
                          <option
                            key={a.id || a.name}
                            value={backendEnabled ? a.id : a.name}
                          >
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {backendEnabled && (
                    <p className="routing-hint">
                      Schimbarea competenței readuce taskul la „Nou” și îl
                      repartizează automat după competență, disponibilitate și
                      capacitate, fără Qwen. Dacă nu există agent eligibil,
                      rămâne nealocat.
                      {role === "Administrator"
                        ? " Poți alege manual orice utilizator activ, indiferent de competențe sau capacitate."
                        : ""}
                    </p>
                  )}
                  {current.replies?.map((r, i) => (
                    <div className="sent-reply" key={i}>
                      <strong>Maria Ionescu · Răspuns demonstrativ</strong>
                      <p>{r}</p>
                    </div>
                  ))}
                  {notes.map((n) => (
                    <div className="sent-reply" key={n.id}>
                      <strong>{n.authorName} · Notă internă</strong>
                      <p>{n.body}</p>
                    </div>
                  ))}
                  <form className="reply" onSubmit={saveReply}>
                    <textarea
                      placeholder={
                        backendEnabled
                          ? "Adaugă o notă internă…"
                          : "Scrie un răspuns…"
                      }
                      aria-label="Răspuns"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                    />
                    <div>
                      <small>
                        {backendEnabled
                          ? "Notă internă · nu se trimite un email"
                          : "Răspuns demonstrativ · nu se trimite un email real"}
                      </small>
                      <button
                        className="button primary"
                        disabled={!reply.trim()}
                      >
                        <Send size={15} />
                        {backendEnabled
                          ? "Salvează nota"
                          : "Salvează răspunsul"}
                      </button>
                    </div>
                  </form>
                  {backendEnabled && (
                    <div className="history">
                      <h2>Istoricul mesajului</h2>
                      {history.map((h) => (
                        <div key={h.id}>
                          <span>
                            {new Date(h.createdAt).toLocaleString("ro-RO", {
                              timeZone: "Europe/Bucharest",
                            })}
                          </span>
                          <strong>{h.actorName || h.actorType}</strong>
                          <span>
                            {{
                              received: "Mesaj primit",
                              classified: "Clasificat",
                              assigned: "Repartizat",
                              review_required: "Necesită verificare",
                              updated: "Actualizat",
                              note_added: "Notă adăugată",
                              classification_failed:
                                "Clasificare locală nereușită",
                            }[h.type] || h.type}
                          </span>
                          {describeEvent(h) && (
                            <small>{describeEvent(h)}</small>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : (
                <section className="panel">
                  <div className="panel-title">
                    <div>
                      <h2>
                        {role === "Agent" ? "Mesajele mele" : "Mesaje recente"}
                        <span className="number-badge">{visible.length}</span>
                      </h2>
                      <p>Fiecare mesaj, un pas mai aproape de rezolvare.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => {
                        setPage(page === "inbox" ? "overview" : "inbox");
                        setFilter("Toate mesajele");
                      }}
                    >
                      {page === "inbox"
                        ? "Privire de ansamblu"
                        : "Vezi toate mesajele"}
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div className="table-controls">
                    <div className="tabs">
                      {["Toate mesajele", "Nou", "În lucru", "Rezolvat"].map(
                        (s, i) => (
                          <button
                            key={s}
                            className={filter === s ? "selected" : ""}
                            onClick={() => setFilter(s)}
                          >
                            {
                              [
                                "Toate mesajele",
                                "Noi",
                                "În lucru",
                                "Rezolvate",
                              ][i]
                            }
                            {s === "Nou" && (
                              <span>
                                {
                                  messages.filter((m) => m.status === "Nou")
                                    .length
                                }
                              </span>
                            )}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="search">
                      <Search size={16} />
                      <input
                        placeholder="Caută un mesaj…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <span>⌕</span>
                    </div>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>EXPEDITOR / SUBIECT</th>
                          <th>COMPETENȚĂ</th>
                          <th>PRIORITATE</th>
                          <th>STATUS</th>
                          <th>AGENT</th>
                          <th>
                            PRIMIT
                            <ArrowDown size={11} />
                          </th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((m) => (
                          <tr
                            key={m.id}
                            onClick={() => setSelected(m.id)}
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") setSelected(m.id);
                            }}
                          >
                            <td>
                              <div className="message-cell">
                                <span className={"avatar " + m.color}>
                                  {m.initials}
                                </span>
                                <div>
                                  <strong>
                                    {m.name}
                                    {m.status === "Nou" && (
                                      <i className="unread" />
                                    )}
                                  </strong>
                                  <span>{m.subject}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="category">{m.category}</span>
                            </td>
                            <td>
                              <span
                                className={
                                  "priority " +
                                  (m.priority === "Ridicată"
                                    ? "high"
                                    : m.priority === "Medie"
                                      ? "medium"
                                      : "low")
                                }
                              >
                                <i />
                                {m.priority}
                              </span>
                            </td>
                            <td>
                              <span
                                className={
                                  "status " +
                                  (m.status === "Nou"
                                    ? "new"
                                    : m.status === "În lucru"
                                      ? "progress"
                                      : "done")
                                }
                              >
                                <i />
                                {m.status}
                              </span>
                            </td>
                            <td>
                              <span className="agent-avatar" title={m.agent}>
                                {m.agent
                                  .split(" ")
                                  .map((s) => s[0])
                                  .join("")}
                              </span>
                            </td>
                            <td className="time">{m.time}</td>
                            <td>
                              <ChevronRight size={15} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!visible.length && (
                      <div className="empty">
                        <Inbox size={28} />
                        <h3>Niciun mesaj aici</h3>
                        <p>Încearcă alt filtru sau un alt termen de căutare.</p>
                      </div>
                    )}
                  </div>
                  <div className="table-footer">
                    <span>
                      {visible.length} mesaje afișate <i>·</i>{" "}
                      {backendEnabled
                        ? total + " mesaje în total"
                        : "Date demonstrative"}
                    </span>
                    {backendEnabled && total > 100 ? (
                      <div>
                        <button
                          disabled={!offset}
                          onClick={() => setOffset(Math.max(0, offset - 100))}
                        >
                          Anterior
                        </button>
                        <span>
                          {offset + 1}–{Math.min(offset + 100, total)}
                        </span>
                        <button
                          disabled={offset + 100 >= total}
                          onClick={() => setOffset(offset + 100)}
                        >
                          Următor
                        </button>
                      </div>
                    ) : (
                      <span>
                        <span className="live-dot" />
                        Actualizat acum
                      </span>
                    )}
                  </div>
                </section>
              )}
              <footer>
                Creat pentru echipe care fac lucrurile să se miște.
                <span>
                  Mai puțin haos. Mai mult flow.{" "}
                  <span className="footer-brand">relay.</span>
                </span>
              </footer>
            </>
          ) : page === "agents" ? (
            <>
              <div className="page-heading">
                <div className="heading-simple">
                  <div className="eyebrow">
                    OAMENII DIN SPATELE RĂSPUNSURILOR
                  </div>
                  <h1>O echipă. Competențe diverse.</h1>
                  <p>
                    Organizează echipa după ceea ce știe să facă cel mai bine.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal(true)}
                >
                  <Plus size={16} />
                  Adaugă agent
                </button>
              </div>
              {backendEnabled && (
                <section className="panel skill-management">
                  <h2>Competențele echipei</h2>
                  <div className="skill-list">
                    {skills.map((s) => (
                      <span key={s.id}>{s.name}</span>
                    ))}
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      try {
                        await api("/skills", {
                          method: "POST",
                          body: { name: new FormData(form).get("name") },
                        });
                        await refresh();
                        form.reset();
                      } catch (e) {
                        notify(e.message);
                      }
                    }}
                  >
                    <input
                      name="name"
                      required
                      maxLength={100}
                      placeholder="O nouă competență"
                      aria-label="O nouă competență"
                    />
                    <button className="button primary">
                      Adaugă competență
                    </button>
                  </form>
                </section>
              )}
              <div className="agent-grid">
                {team.map((a) => (
                  <div className="panel agent-card" key={a.id || a.name}>
                    <div className="agent-card-top">
                      <span className={"avatar large " + a.color}>
                        {a.initials}
                      </span>
                      <span className="available">
                        <i />
                        {a.available === false ? "Indisponibil" : "Disponibil"}
                      </span>
                    </div>
                    <h2>{a.name}</h2>
                    <p>{a.role === "admin" ? "Administrator" : "Agent"}</p>
                    <div className="skill-list">
                      {a.skills.map((s) => (
                        <span key={s}>{s}</span>
                      ))}
                    </div>
                    {backendEnabled && (
                      <div className="agent-controls">
                        <label>
                          Capacitate
                          <input
                            aria-label={"Capacitate " + a.name}
                            type="number"
                            min="1"
                            max="1000"
                            defaultValue={a.capacity}
                            key={a.capacity}
                            onBlur={async (e) => {
                              const capacity = Number(e.target.value);
                              if (capacity === a.capacity) return;
                              try {
                                await api("/agents/" + a.id, {
                                  method: "PATCH",
                                  body: { capacity },
                                });
                                await refresh();
                              } catch (e) {
                                notify(e.message);
                                e.target.value = a.capacity;
                              }
                            }}
                          />
                        </label>
                        <button
                          className="button white"
                          onClick={async () => {
                            try {
                              await api("/agents/" + a.id, {
                                method: "PATCH",
                                body: { available: !a.available },
                              });
                              await refresh();
                            } catch (e) {
                              notify(e.message);
                            }
                          }}
                        >
                          {a.available
                            ? "Marchează indisponibil"
                            : "Marchează disponibil"}
                        </button>
                      </div>
                    )}
                    <div className="agent-workload">
                      <span>Mesaje active</span>
                      <strong>{a.load}</strong>
                    </div>
                    <div className="load-bar">
                      <i
                        style={{
                          width:
                            Math.min(100, (a.load / (a.capacity || 20)) * 100) +
                            "%",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : page === "ai" ? (
            <AiTest
              onOpen={async (id) => {
                setOffset(0);
                await refresh(0);
                setSelected(id);
                setPage("inbox");
              }}
            />
          ) : page === "rules" ? (
            <section className="panel coming">
              <span className="feature-icon">
                <SlidersHorizontal size={28} />
              </span>
              <span className="eyebrow">URMĂTORUL PAS</span>
              <h1>Fiecare mesaj își va găsi omul.</h1>
              <p>
                Aici vom defini regulile de distribuire în funcție de
                competențe, disponibilitate și volumul de lucru al agenților.
              </p>
              <div className="flow">
                <span>
                  <Mail size={20} />
                  Email primit
                </span>
                <ChevronRight />
                <span>
                  <SlidersHorizontal size={20} />
                  Competență identificată
                </span>
                <ChevronRight />
                <span>
                  <Users size={20} />
                  Agent potrivit
                </span>
              </div>
              <div className="info-note">
                {backendEnabled
                  ? "API-ul distribuie mesajele clasificate cu încredere de minimum 75% către agenți eligibili, disponibili și sub capacitate. Celelalte rămân nealocate pentru verificare. Configurarea regulilor din această pagină urmează ulterior."
                  : "Momentan construim interfața. Distribuirea automată va fi implementată în etapa următoare."}
              </div>
            </section>
          ) : page === "settings" ? (
            <section className="panel settings">
              <h1>Setările spațiului de lucru</h1>
              <p>Personalizează perspectiva din interfața demonstrativă.</p>
              <label>
                {backendEnabled
                  ? "Rol atribuit de administrator"
                  : "Vizualizează ca"}
                <select
                  disabled={backendEnabled}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option>Administrator</option>
                  <option>Agent</option>
                </select>
              </label>
              <div className="info-note">
                {backendEnabled
                  ? "Datele sunt păstrate în PostgreSQL. Robotul poate trimite mesaje prin API. Conectarea directă la furnizorii de email și trimiterea răspunsurilor nu sunt încă implementate."
                  : "Datele sunt demonstrative și se resetează la reîncărcarea paginii. Conectarea conturilor de email va fi disponibilă în etapa următoare."}
              </div>
            </section>
          ) : (
            <section className="panel settings">
              <h1>Un început simplu</h1>
              <p>
                Deschide un mesaj pentru a-l citi, a-i schimba responsabilul sau
                a salva un răspuns demonstrativ.
              </p>
              <p>
                În „Echipă & competențe” poți vedea agenții și adăuga membri.
                Din meniul profilului poți alterna între rolul de administrator
                și cel de agent.
              </p>
            </section>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button onClick={() => setToast("")} aria-label="Închide">
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={addAgent}
          >
            <button
              type="button"
              className="modal-close icon-button"
              aria-label="Închide"
              onClick={() => setModal(false)}
            >
              <X size={20} />
            </button>
            <h2>Un nou coleg în echipă</h2>
            <p>Adaugă un agent și competențele sale.</p>
            <label>
              Nume complet
              <input name="name" required placeholder="ex. Andrei Popescu" />
            </label>
            {backendEnabled && (
              <>
                <label>
                  Email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Parolă inițială (minimum 12 caractere)
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            <fieldset>
              <legend>Competențe</legend>
              {(backendEnabled
                ? skills
                : [
                    "Administrativ",
                    "Suport tehnic",
                    "Vânzări",
                    "Facturare",
                  ].map((name) => ({ id: name, name }))
              ).map((s) => (
                <label className="checkbox" key={s.id}>
                  <input type="checkbox" name="skill" value={s.id} />
                  {s.name}
                </label>
              ))}
            </fieldset>
            <button className="button primary" type="submit">
              <Plus size={16} />
              Adaugă agent
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
