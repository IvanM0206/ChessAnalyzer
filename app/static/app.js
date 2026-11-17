// Operator panel: analyze transcript, let the operator edit, derive the call card.
const $ = (id) => document.getElementById(id);
let current = null; // last CopilotSuggestion

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function setField(name, field) {
  $(name).value = field.normalized || field.value || "";
  const ev = $(`${name}-ev`);
  if (!field.value) { ev.textContent = "No mencionado: preguntar"; ev.className = "warn"; }
  else if (field.grounded) { ev.textContent = `✓ "${field.evidence}"`; ev.className = "ok"; }
  else { ev.textContent = "⚠ Sin evidencia literal: verificar"; ev.className = "warn"; }
}

function render(s) {
  current = s;
  $("result").hidden = false;
  $("confidence").textContent = `Certeza ${Math.round(s.confidence * 100)}%`;
  $("warnings").innerHTML = s.warnings.map((w) => `<li>${escape(w)}</li>`).join("");
  $("prioridad").value = s.prioridad; $("prioridad").className = s.prioridad;
  $("categoria").value = s.categoria; $("subcategoria").value = s.subcategoria;
  $("prio-why").textContent = s.prioridad_justificacion;
  ["calle", "altura", "interseccion", "barrio"].forEach((f) => setField(f, s[f]));
  $("instructions").innerHTML = s.instrucciones_prearribo.map((i) => `<li>${escape(i)}</li>`).join("");
  // Pending questions first: that is what the operator must ask next.
  const items = [...s.checklist].sort((a, b) => a.answered - b.answered);
  $("checklist").innerHTML = items.map((c, idx) => `
    <li class="${c.answered ? "done" : ""}">
      <input type="checkbox" data-q="${escape(c.question)}" ${c.answered ? "checked" : ""} id="q${idx}" />
      <label for="q${idx}" style="color:inherit;font-size:13px">${escape(c.question)}
        ${c.answered ? `<span class="ev">${c.grounded ? "✓" : "⚠"} ${escape(c.answer || "")}</span>` : ""}
      </label>
    </li>`).join("");
  $("checklist").querySelectorAll("input").forEach((el) =>
    el.addEventListener("change", () => el.closest("li").classList.toggle("done", el.checked)));
  $("riesgos").innerHTML = s.riesgos.map((r) => `<span>${escape(r)}</span>`).join("");
  $("recursos").textContent = s.recursos_sugeridos || "—";
  $("derive-status").textContent = "";
}

async function analyze() {
  const transcript = $("transcript").value.trim();
  if (transcript.length < 10) return;
  $("analyze").disabled = true;
  try { render(await api("/api/analyze", { method: "POST", body: JSON.stringify({ transcript }) })); }
  catch (e) { alert(`Error al analizar: ${e.message}`); }
  finally { $("analyze").disabled = false; }
}

async function derive() {
  if (!current) return;
  const checks = [...$("checklist").querySelectorAll("input")];
  const card = {
    transcript: $("transcript").value,
    calle: $("calle").value.trim(),
    altura: $("altura").value.trim() || null,
    interseccion: $("interseccion").value.trim() || null,
    barrio: $("barrio").value.trim() || null,
    categoria: $("categoria").value.trim(),
    subcategoria: $("subcategoria").value.trim(),
    prioridad: $("prioridad").value,
    preguntas_respondidas: checks.filter((c) => c.checked).map((c) => c.dataset.q),
    preguntas_pendientes: checks.filter((c) => !c.checked).map((c) => c.dataset.q),
    instrucciones_transmitidas: current.instrucciones_prearribo,
    riesgos: current.riesgos,
    recursos_sugeridos: current.recursos_sugeridos,
    notas_operador: $("notas").value.trim() || null,
    ai_confidence: current.confidence,
    ai_provider: current.provider,
  };
  if (!card.calle) { $("derive-status").textContent = "La calle es obligatoria para derivar."; $("calle").focus(); return; }
  try {
    const saved = await api("/api/cards", { method: "POST", body: JSON.stringify(card) });
    $("derive-status").textContent = `Carta #${saved.id} derivada al despacho.`;
    loadCards();
  } catch (e) { $("derive-status").textContent = `Error: ${e.message}`; }
}

async function loadCards() {
  const cards = await api("/api/cards");
  $("cards").innerHTML = cards.map((c) => `<tr>
    <td>${c.id}</td><td>${new Date(c.created_at).toLocaleTimeString("es-AR")}</td>
    <td><span class="badge">${c.prioridad}</span></td><td>${escape(c.subcategoria)}</td>
    <td>${escape([c.calle, c.altura].filter(Boolean).join(" "))}${c.interseccion ? ` (${escape(c.interseccion)})` : ""}</td></tr>`).join("");
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

async function init() {
  const health = await api("/api/health");
  $("provider").textContent = `Proveedor: ${health.provider}`;
  const samples = await api("/api/samples");
  $("samples").innerHTML += samples.map((s, i) => `<option value="${i}">${escape(s.label)}</option>`).join("");
  $("samples").addEventListener("change", (e) => {
    if (e.target.value !== "") $("transcript").value = samples[e.target.value].transcript;
  });
  $("analyze").addEventListener("click", analyze);
  $("derive").addEventListener("click", derive);
  $("prioridad").addEventListener("change", (e) => (e.target.className = e.target.value));
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); analyze(); }
    if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); derive(); }
  });
  loadCards();
}

init();
