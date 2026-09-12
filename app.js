import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- Konfiguracja (uzgodniona) ----
const SUPABASE_URL = "https://qxxiujhtjffwptubvcih.supabase.co";
const SUPABASE_KEY = "sb_publishable_KZHlKoj3Cdmiq9kLx0Un1g_PGXkKojI";
const RATE_WEEKDAY = 83;
const RATE_WEEKEND = 65;
const MS_DISCOUNT = 15;
const PLAYERS = [
  { id: "dom", nick: "Dom", hasMS: false },
  { id: "ber", nick: "Ber", hasMS: true },
  { id: "hy", nick: "Hy", hasMS: true },
  { id: "pa", nick: "Pa", hasMS: true },
];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s) => document.querySelector(s);
let session = null;
let meetings = [];
let editingId = null;
let formOpen = false;

// ---- Helpery ----
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isWeekendDate = (iso) => {
  if (!iso) return false;
  const d = new Date(iso + "T12:00:00");
  return d.getDay() === 0 || d.getDay() === 6;
};
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const fmt = (n) => `${Number(n).toFixed(2)} zł`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", weekday: "short" });
  } catch { return iso; }
};
const dateInfo = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return {
    day: d.toLocaleDateString("pl-PL", { day: "2-digit" }),
    month: d.toLocaleDateString("pl-PL", { month: "short" }).replace(".", ""),
    weekday: d.toLocaleDateString("pl-PL", { weekday: "long" }),
    year: d.getFullYear(),
  };
};
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6 10h12v10H6zM12 14v2" /></svg>';
const kebabIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>';
const batIcon = '<span class="bat-icon" aria-hidden="true">💰</span>';

// Koszt liczony ZAWSZE z zapisanych pól (total snapshot, nie ze zmiany cennika).
function calc(m) {
  const present = PLAYERS.filter((p) => m[`${p.id}_present`]);
  const n = present.length;
  const total = Number(m.total) || 0;
  const share = n > 0 ? total / n : 0;
  const costs = {};
  for (const p of PLAYERS) {
    if (!m[`${p.id}_present`]) { costs[p.id] = 0; continue; }
    const ms = Number(m[`${p.id}_ms`]) || 0;
    costs[p.id] = round2(Math.max(0, share - MS_DISCOUNT * ms));
  }
  return { total: round2(total), n, share: round2(share), costs };
}

function showError(msg) {
  const el = $("#error");
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = msg;
}

// ---- Formularz: budowa wierszy graczy ----
function syncRowSelected() {
  for (const p of PLAYERS) {
    const cb = $(`#fp-${p.id}`);
    const row = cb?.closest(".player-row");
    if (row) {
      row.classList.toggle("selected", !!cb?.checked);
      row.setAttribute("aria-checked", cb?.checked ? "true" : "false");
    }
  }
}

function buildFormPlayers() {
  const box = $("#form-players");
  box.innerHTML = "";
  for (const p of PLAYERS) {
    const row = document.createElement("div");
    row.className = "player-row";
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `Zaznacz obecność: ${p.nick}`);
    row.dataset.player = p.id;
    row.innerHTML = `
      <div class="player-select"><input class="player-checkbox" type="checkbox" id="fp-${p.id}" tabindex="-1" aria-hidden="true" /> <span class="player-avatar">${esc(p.nick[0])}</span><span class="player-name">${esc(p.nick)}</span></div>
      ${p.hasMS
        ? `<label class="ms-control"><span>MS</span><input type="number" id="fm-${p.id}" min="0" max="5" step="1" value="0" aria-label="Liczba odbić MS: ${esc(p.nick)}" /></label>`
        : `<span class="ms-tag">bez MS</span><input type="hidden" id="fm-${p.id}" value="0" />`}
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".ms-control") || e.target.closest('input[type="number"]')) return;
      const cb = row.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest('input[type="number"]')) return;
      e.preventDefault();
      const cb = row.querySelector('input[type="checkbox"]');
      if (!cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    box.appendChild(row);
  }
  for (const p of PLAYERS) {
    $(`#fp-${p.id}`).addEventListener("change", () => { syncRowSelected(); syncMsDisabled(); applyDefaults(); updatePreview(); });
  }
  const hours = $("#f-hours");
  if (hours && !hours.dataset.bound) {
    hours.dataset.bound = "1";
    hours.addEventListener("input", () => { applyMsDefaults(); updatePreview(); });
  }
}

function formState() {
  const present = PLAYERS.filter((p) => $(`#fp-${p.id}`)?.checked);
  return {
    date: $("#f-date").value,
    isWeekend: $("#f-rate-type").value === "weekend",
    courts: Number($("#f-courts").value),
    hours: Number($("#f-hours").value),
    presentIds: present.map((p) => p.id),
    ms: Object.fromEntries(PLAYERS.map((p) => [p.id, Math.max(0, Math.min(5, parseInt($(`#fm-${p.id}`)?.value || "0", 10) || 0))])),
  };
}

function syncMsDisabled() {
  for (const p of PLAYERS) {
    if (!p.hasMS) continue;
    const on = $(`#fp-${p.id}`)?.checked;
    const inp = $(`#fm-${p.id}`);
    if (inp) inp.disabled = !on;
  }
}

function syncRateToggle() {
  const val = $("#f-rate-type")?.value || "week";
  document.querySelectorAll(".rate-toggle button").forEach((b) => {
    const active = b.dataset.rate === val;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function setRate(val) {
  const input = $("#f-rate-type");
  if (input) {
    input.value = val;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  syncRateToggle();
  updatePreview();
}

// Defaulty: 2 os -> 1 kort/1h, 3 os -> 1 kort/1.5h, 4 os -> 2 korty/1h. MS = ceil(godzin).
function applyDefaults() {
  const n = PLAYERS.filter((p) => $(`#fp-${p.id}`)?.checked).length;
  if (n === 2) { $("#f-courts").value = 1; $("#f-hours").value = 1; }
  else if (n === 3) { $("#f-courts").value = 1; $("#f-hours").value = 1.5; }
  else if (n >= 4) { $("#f-courts").value = 2; $("#f-hours").value = 1; }
  applyMsDefaults();
}
function applyMsDefaults() {
  const h = Number($("#f-hours").value) || 0;
  const d = Math.max(0, Math.min(5, Math.ceil(h)));
  for (const p of PLAYERS) {
    if (!p.hasMS) { $(`#fm-${p.id}`).value = 0; continue; }
    if ($(`#fp-${p.id}`)?.checked) $(`#fm-${p.id}`).value = d;
    else $(`#fm-${p.id}`).value = 0;
  }
}

function updatePreview() {
  const s = formState();
  if (!s.date || s.presentIds.length === 0) { $("#preview").textContent = "Zaznacz obecnych, aby zobaczyć podgląd kosztów."; return; }
  const rate = s.isWeekend ? RATE_WEEKEND : RATE_WEEKDAY;
  const total = round2(s.courts * s.hours * rate);
  const share = total / s.presentIds.length;
  const parts = s.presentIds.map((id) => {
    const p = PLAYERS.find((x) => x.id === id);
    const c = round2(Math.max(0, share - MS_DISCOUNT * (s.ms[id] || 0)));
    return `${p.nick}: ${fmt(c)}${(s.ms[id] || 0) > 0 ? ` (MS×${s.ms[id]})` : ""}`;
  });
  $("#preview").textContent = `Razem ${fmt(total)} (${s.courts} kort × ${s.hours}h × ${rate} zł) → ${parts.join(" · ")}`;
}

// ---- Render ----
function render() {
  const admin = !!session;
  const showForm = admin && (formOpen || !!editingId);
  $("#admin-panel").hidden = !showForm;
  const addButton = $("#btn-show-form");
  if (addButton) addButton.hidden = !admin || showForm;
  const authBtn = $("#auth-btn");
  if (authBtn) {
    authBtn.innerHTML = lockIcon;
    authBtn.title = "Zaloguj jako administrator";
    authBtn.setAttribute("aria-label", "Zaloguj jako administrator");
    // brak wylogowania: po zalogowaniu ikona znika
    authBtn.hidden = admin;
  }
  renderLedgerHeader();
  renderMeetings(admin);
  renderTotals(admin);
}

function renderLedgerHeader() {
  const header = $("#ledger-header");
  if (!header) return;
  header.innerHTML = `
    <div class="ledger-heading">Spotkanie</div>
    ${PLAYERS.map((p) => `<div class="ledger-player-heading"><strong>${esc(p.nick)}</strong></div>`).join("")}
  `;
}

function openForm() {
  formOpen = true;
  render();
  $("#admin-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  formOpen = false;
  editingId = null;
  render();
}

function renderMeetings(admin) {
  const box = $("#meetings");
  if (meetings.length === 0) { box.innerHTML = "<p>Brak spotkań. Miłego grania! 🎾</p>"; return; }
  box.innerHTML = "";
  for (const m of meetings) {
    const c = calc(m);
    const date = dateInfo(m.game_date);
    const card = document.createElement("article");
    card.className = "meeting";
    const badge = m.is_weekend
      ? `<span class="badge weekend">weekend · ${m.rate}</span>`
      : `<span class="badge week">tydzień · ${m.rate}</span>`;
    const playerCells = PLAYERS.map((p) => {
      if (!m[`${p.id}_present`]) return `<div class="meeting-cell player-cell absent">—</div>`;
      const paid = !!m[`${p.id}_paid`];
      return `<div class="meeting-cell player-cell">
        <strong>${fmt(c.costs[p.id])}</strong>
        <div class="player-meta-row">
          <small>${p.hasMS ? `${Number(m[`${p.id}_ms`]) || 0}MS` : "bez MS"}</small>
          <button class="payment-state ${paid ? "paid" : "unpaid"}" data-paid="${m.id}:${p.id}" aria-label="${paid ? "Opłacone" : "Zaległe"}" title="${paid ? "Opłacone" : "Zaległe"}" ${admin ? "" : "disabled"}>${paid ? "✓" : batIcon}</button>
        </div>
      </div>`;
    }).join("");
    card.innerHTML = `
      <div class="meeting-grid">
        <div class="meeting-cell meeting-info">
          <div class="date-lockup"><span class="date-number">${esc(date.day)}</span><span class="date-copy"><strong>${esc(date.weekday)}</strong>${esc(date.month)} ${date.year}</span></div>
          ${badge}
          <strong class="meeting-total">${fmt(c.total)}</strong>
          <small>${Number(m.courts)} kort × ${Number(m.hours)}h</small>
          ${admin ? `<button class="meeting-menu" data-edit="${m.id}" aria-label="Edytuj spotkanie" title="Edytuj spotkanie">${kebabIcon}</button>` : ""}
        </div>
        ${playerCells}
      </div>
    `;
    box.appendChild(card);
  }
  box.querySelectorAll("[data-paid]").forEach((cb) => {
    cb.addEventListener("click", () => {
      const [id, pid] = cb.dataset.paid.split(":");
      togglePaid(id, pid, cb.classList.contains("unpaid"));
    });
  });
  box.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => startEdit(b.dataset.edit)));
}

function renderTotals(admin) {
  const box = $("#totals");
  box.innerHTML = "";
  let totalDue = 0;
  for (const p of PLAYERS) {
    let sum = 0, count = 0;
    for (const m of meetings) {
      if (m[`${p.id}_present`] && !m[`${p.id}_paid`]) { sum = round2(sum + calc(m).costs[p.id]); count++; }
    }
    totalDue = round2(totalDue + sum);
    const card = document.createElement("div");
    card.className = "summary-cell";
    card.innerHTML = `
      <strong>${fmt(sum)}</strong>
      <small>${count === 1 ? "1 zaległe" : `${count} zaległych`}</small>
      <button class="pay-all-button" data-payall="${p.id}" ${admin && sum > 0 ? "" : "disabled"}>Zapłacone</button>
    `;
    box.appendChild(card);
  }
  $("#total-due").textContent = fmt(totalDue);
  box.querySelectorAll("[data-payall]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.confirm === "true") {
      b.dataset.confirm = "false";
      payAll(b.dataset.payall);
      return;
    }
    b.dataset.confirm = "true";
    b.classList.add("confirm");
    b.textContent = "Potwierdź";
    window.setTimeout(() => {
      if (!b.isConnected || b.dataset.confirm !== "true") return;
      b.dataset.confirm = "false";
      b.classList.remove("confirm");
      b.textContent = "Zapłacone";
    }, 3500);
  }));
}

// ---- Dane ----
async function loadMeetings() {
  showError("");
  const { data, error } = await supabase.from("meetings").select("*").order("game_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) { showError(`Błąd odczytu: ${error.message}. Sprawdź tabelę (supabase.sql) i klucz.`); return; }
  meetings = data || [];
  render();
}

async function togglePaid(id, pid, paid) {
  if (!session) return;
  const { error } = await supabase.from("meetings").update({ [`${pid}_paid`]: paid }).eq("id", id);
  if (error) { showError(`Błąd zapisu płatności: ${error.message}`); await loadMeetings(); return; }
  const m = meetings.find((x) => x.id === id);
  if (m) m[`${pid}_paid`] = paid;
  render();
}

async function payAll(pid) {
  if (!session) return;
  const unpaid = meetings.filter((m) => m[`${pid}_present`] && !m[`${pid}_paid`]);
  if (unpaid.length === 0) return;
  for (const m of unpaid) {
    const { error } = await supabase.from("meetings").update({ [`${pid}_paid`]: true }).eq("id", m.id);
    if (error) { showError(`Błąd przy oznaczaniu płatności: ${error.message}`); await loadMeetings(); return; }
    m[`${pid}_paid`] = true;
  }
  render();
}

function startEdit(id) {
  const m = meetings.find((x) => x.id === id);
  if (!m) return;
  editingId = id;
  formOpen = true;
  $("#form-title").textContent = `Edycja: ${fmtDate(m.game_date)}`;
  $("#f-date").value = m.game_date;
  $("#f-rate-type").value = m.is_weekend ? "weekend" : "week";
  syncRateToggle();
  $("#f-courts").value = m.courts;
  $("#f-hours").value = m.hours;
  for (const p of PLAYERS) {
    $(`#fp-${p.id}`).checked = !!m[`${p.id}_present`];
    $(`#fm-${p.id}`).value = Number(m[`${p.id}_ms`]) || 0;
  }
  syncRowSelected();
  syncMsDisabled();
  updatePreview();
  $("#btn-save").textContent = "Zapisz zmiany";
  $("#btn-cancel").hidden = false;
  $("#btn-delete-edit").hidden = false;
  $("#btn-delete-edit").dataset.confirm = "false";
  $("#btn-delete-edit").classList.remove("confirm");
  $("#btn-delete-edit").textContent = "Usuń";
  render();
  $("#admin-panel").scrollIntoView({ behavior: "smooth" });
}

function resetForm() {
  editingId = null;
  formOpen = false;
  $("#form-title").textContent = "Nowe spotkanie";
  $("#f-date").value = todayISO();
  $("#f-rate-type").value = isWeekendDate($("#f-date").value) ? "weekend" : "week";
  syncRateToggle();
  $("#f-courts").value = 1;
  $("#f-hours").value = 1;
  for (const p of PLAYERS) { $(`#fp-${p.id}`).checked = false; $(`#fm-${p.id}`).value = 0; }
  syncRowSelected();
  syncMsDisabled();
  updatePreview();
  $("#btn-save").textContent = "Dodaj spotkanie";
  $("#btn-cancel").hidden = false;
  $("#btn-delete-edit").hidden = true;
  $("#btn-delete-edit").dataset.confirm = "false";
  $("#btn-delete-edit").classList.remove("confirm");
  $("#btn-delete-edit").textContent = "Usuń";
}

async function removeMeeting(id) {
  if (!session) return;
  const { error } = await supabase.from("meetings").delete().eq("id", id);
  if (error) { showError(`Błąd usuwania: ${error.message}`); return; }
  meetings = meetings.filter((m) => m.id !== id);
  if (editingId === id) {
    editingId = null;
    formOpen = false;
  }
  render();
}

async function saveMeeting(e) {
  e.preventDefault();
  if (!session) { showError("Musisz być zalogowany."); return; }
  const s = formState();
  if (!s.date) { showError("Wybierz datę gry."); return; }
  if (s.presentIds.length < 2) { showError("Zaznacz co najmniej 2 obecnych."); return; }
  if (![1, 2, 3].includes(s.courts)) { showError("Liczba kortów: 1–3."); return; }
  if (!(s.hours >= 0.5 && s.hours <= 5)) { showError("Godziny: 0.5–5."); return; }
  const rate = s.isWeekend ? RATE_WEEKEND : RATE_WEEKDAY;
  const total = round2(s.courts * s.hours * rate);
  const existing = editingId ? meetings.find((m) => m.id === editingId) : null;
  const payload = {
    game_date: s.date,
    is_weekend: s.isWeekend,
    rate, courts: s.courts, hours: s.hours, total,
  };
  for (const p of PLAYERS) {
    const on = s.presentIds.includes(p.id);
    payload[`${p.id}_present`] = on;
    payload[`${p.id}_ms`] = on ? (p.hasMS ? (s.ms[p.id] || 0) : 0) : 0;
    payload[`${p.id}_paid`] = existing && on ? !!existing[`${p.id}_paid`] : false;
  }
  showError("");
  if (editingId) {
    const { error } = await supabase.from("meetings").update(payload).eq("id", editingId);
    if (error) { showError(`Błąd zapisu: ${error.message}`); return; }
  } else {
    const { error } = await supabase.from("meetings").insert(payload);
    if (error) { showError(`Błąd zapisu: ${error.message} (czy w Supabase wykonano supabase.sql i włączono RLS?)`); return; }
  }
  resetForm();
  await loadMeetings();
}

// ---- Auth ----
async function initAuth() {
  const { data } = await supabase.auth.getSession();
  session = data.session || null;
  render();
  supabase.auth.onAuthStateChange((_ev, s) => { session = s; render(); });
}

// ---- Start ----
document.addEventListener("DOMContentLoaded", async () => {
  buildFormPlayers();
  $("#f-date").value = todayISO();
  $("#f-rate-type").value = isWeekendDate($("#f-date").value) ? "weekend" : "week";
  syncRateToggle();
  $("#f-date").addEventListener("change", () => {
    $("#f-rate-type").value = isWeekendDate($("#f-date").value) ? "weekend" : "week";
    syncRateToggle();
    updatePreview();
  });
  $("#f-rate-type").addEventListener("change", updatePreview);
  document.querySelectorAll(".rate-toggle button").forEach((b) => {
    b.addEventListener("click", () => setRate(b.dataset.rate));
  });
  $("#f-courts").addEventListener("input", updatePreview);
  document.querySelectorAll("#form-players input").forEach((i) => i.addEventListener("input", updatePreview));
  $("#meeting-form").addEventListener("submit", saveMeeting);
  $("#btn-cancel").addEventListener("click", () => { resetForm(); render(); });
  $("#btn-delete-edit").addEventListener("click", async () => {
    if (!editingId) return;
    const button = $("#btn-delete-edit");
    if (button.dataset.confirm === "true") {
      button.disabled = true;
      await removeMeeting(editingId);
      button.disabled = false;
      return;
    }
    button.dataset.confirm = "true";
    button.classList.add("confirm");
    button.textContent = "Potwierdź";
    window.setTimeout(() => {
      if (!button.isConnected || button.dataset.confirm !== "true") return;
      button.dataset.confirm = "false";
      button.classList.remove("confirm");
      button.textContent = "Usuń";
    }, 3500);
  });
  $("#btn-show-form")?.addEventListener("click", () => {
    resetForm();
    openForm();
  });

  const dlg = $("#login-dialog");
  $("#auth-btn").addEventListener("click", async () => {
    if (session) return;
    $("#login-error").hidden = true;
    dlg.showModal();
  });
  $("#login-close").addEventListener("click", () => dlg.close());
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim();
    const password = $("#login-pass").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const el = $("#login-error");
      el.hidden = false;
      el.textContent = `Nie udało się zalogować: ${error.message}`;
      e.stopPropagation();
      return;
    }
    dlg.close();
    $("#login-pass").value = "";
  });

  syncRowSelected();
  syncMsDisabled();
  updatePreview();
  await initAuth();
  await loadMeetings();

  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch { /* offline opcjonalny */ }
  }
});
