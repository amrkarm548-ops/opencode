/* OpenCode Web — واجهة محادثة حقيقية موصولة بـ OpenRouter.
   المفتاح يُحفظ محلياً في المتصفح فقط ويُرسل مباشرة إلى openrouter.ai. */

const API = "https://openrouter.ai/api/v1";
const LS = {
  key: "oc_openrouter_key",
  model: "oc_model",
  system: "oc_system",
  temp: "oc_temp",
  stream: "oc_stream",
  chat: "oc_chat",
};

const DEFAULT_MODELS = [
  "openrouter/auto",
  "openai/gpt-5-mini",
  "openai/gpt-4o-mini",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-chat",
  "qwen/qwen-2.5-coder-32b-instruct",
  "meta-llama/llama-3.3-70b-instruct",
];

const $ = (id) => document.getElementById(id);
const el = {
  key: $("key"), keyStatus: $("key-status"), connPill: $("conn-pill"), conn: $("conn"),
  connText: $("conn-text"), model: $("model"), modelName: $("model-name"), modelsHint: $("models-hint"),
  system: $("system"), temp: $("temp"), tempVal: $("temp-val"), stream: $("stream"),
  messages: $("messages"), empty: $("empty"), error: $("error"), input: $("input"),
  send: $("send"), stop: $("stop"), sidebar: $("sidebar"), overlay: $("overlay"),
};

const state = {
  messages: [],
  models: [],
  busy: false,
  abort: null,
};

/* ---------------- storage ---------------- */
const get = (k, fallback = "") => {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
};
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const del = (k) => { try { localStorage.removeItem(k); } catch {} };

const apiKey = () => get(LS.key).trim();

/* ---------------- UI helpers ---------------- */
function setKeyStatus(text, kind = "") {
  el.keyStatus.textContent = text;
  el.keyStatus.className = `key-status ${kind}`;
}
function setConn(connected, text) {
  el.connText.textContent = text;
  el.connPill.textContent = text;
  el.connPill.className = `pill ${connected ? "on" : "off"}`;
  el.conn.className = `conn ${connected ? "on" : ""}`;
}
function showError(msg) {
  el.error.textContent = msg;
  el.error.classList.remove("hidden");
}
function clearError() { el.error.classList.add("hidden"); }
function openSettings(focusKey = false) {
  el.sidebar.classList.add("open");
  el.overlay.classList.remove("hidden");
  if (focusKey) setTimeout(() => el.key.focus(), 120);
}
function closeSettings() {
  el.sidebar.classList.remove("open");
  el.overlay.classList.add("hidden");
}

/* ---------------- models ---------------- */
function fillModels(models, selected) {
  el.model.innerHTML = "";
  const list = models.length ? models : DEFAULT_MODELS;
  for (const id of list) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    el.model.appendChild(opt);
  }
  const wanted = selected || get(LS.model) || DEFAULT_MODELS[0];
  if (list.includes(wanted)) el.model.value = wanted;
  else {
    const opt = document.createElement("option");
    opt.value = wanted; opt.textContent = wanted;
    el.model.appendChild(opt);
    el.model.value = wanted;
  }
  el.modelName.textContent = el.model.value;
}

async function fetchModels() {
  const key = apiKey();
  if (!key) {
    state.models = [];
    fillModels([]);
    el.modelsHint.textContent = "احفظ المفتاح الأول عشان نجيب الموديلات المتاحة.";
    return;
  }
  el.modelsHint.textContent = "جاري التحقق من المفتاح...";
  // نتأكد إن المفتاح صالح من endpoint الخاص بالمفتاح قبل ما نقول "متصل"
  try {
    const check = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (check.status === 401 || check.status === 403) {
      state.models = [];
      fillModels([]);
      el.modelsHint.textContent = "المفتاح غير صالح — امسحه وجرّب مفتاح تاني.";
      setConn(false, "المفتاح غير صالح");
      setKeyStatus("المفتاح المحفوظ مرفوض من OpenRouter (401).", "bad");
      return;
    }
  } catch {
    // لو endpoint التحقق مش متاح، نكمل ونجرب الموديلات
  }
  el.modelsHint.textContent = "جاري جلب الموديلات...";
  try {
    const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const raw = Array.isArray(json?.data) ? json.data : [];
    const free = raw.filter((m) => m.pricing?.prompt === "0" || m.id?.endsWith(":free")).map((m) => m.id);
    const paid = raw.map((m) => m.id).filter((id) => !free.includes(id));
    state.models = ["openrouter/auto", ...free.sort(), ...paid.sort()].filter((v, i, a) => a.indexOf(v) === i).slice(0, 300);
    fillModels(state.models);
    el.modelsHint.textContent = `تم جلب ${state.models.length} موديل (المجانية في الأول).`;
    setConn(true, "متصل بـ OpenRouter");
  } catch (e) {
    state.models = [];
    fillModels([]);
    el.modelsHint.textContent = "مش قادر أجيب الموديلات — القائمة الافتراضية مستخدمة. تأكد من المفتاح.";
    setConn(false, "المفتاح محفوظ — التحقق فشل");
  }
}

/* ---------------- markdown (آمن: نهرّب HTML أولاً) ---------------- */
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
function renderMarkdown(src, streaming) {
  const blocks = [];
  let text = escapeHtml(src).replace(/```([\w.+-]*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push(code.replace(/\n$/, ""));
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });
  // لو فيه كتلة كود لسه مفتوحة أثناء البث
  const openIdx = text.indexOf("```");
  if (openIdx !== -1) {
    const head = text.slice(0, openIdx);
    const rest = text.slice(openIdx).replace(/^```[\w.+-]*\n?/, "");
    blocks.push(rest);
    text = `${head}\u0000BLOCK${blocks.length - 1}\u0000`;
  }

  const lines = text.split("\n");
  const out = [];
  let list = null;
  for (let line of lines) {
    if (/^\u0000BLOCK\d+\u0000$/.test(line.trim())) { if (list) { out.push(`</${list}>`); list = null; } out.push(line.trim()); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { if (list) { out.push(`</${list}>`); list = null; } out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    if (!line.trim()) { out.push("<br>"); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);

  let html = out.join("").replace(/<p><\/p>/g, "");
  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_m, i) =>
    `<pre><button type="button" class="copy-code">نسخ</button><code>${blocks[Number(i)] ?? ""}</code></pre>`);
  if (streaming) html += '<span class="cursor"></span>';
  return html;
}

/* ---------------- chat rendering ---------------- */
function persistChat() {
  try { set(LS.chat, JSON.stringify(state.messages.slice(-40))); } catch {}
}
function restoreChat() {
  try {
    const saved = JSON.parse(get(LS.chat, "[]"));
    if (Array.isArray(saved) && saved.length) {
      state.messages = saved.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
      el.empty.classList.add("hidden");
      for (const m of state.messages) addMessage(m.role, m.content, false);
      scrollBottom();
    }
  } catch {}
}
function addMessage(role, content, streaming = false) {
  const wrap = document.createElement("div");
  wrap.className = "msg";
  const avatar = document.createElement("div");
  avatar.className = `avatar ${role === "user" ? "user" : "ai"}`;
  avatar.textContent = role === "user" ? "U" : ">_";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `<div class="who">${role === "user" ? "أنت" : "OpenCode"}</div><div class="body"></div>`;
  wrap.append(avatar, bubble);
  el.messages.appendChild(wrap);
  const body = bubble.querySelector(".body");
  body.innerHTML = renderMarkdown(content, streaming);
  return body;
}
function updateMessage(body, content, streaming) {
  body.innerHTML = renderMarkdown(content, streaming);
}
function scrollBottom() { el.messages.scrollTop = el.messages.scrollHeight; }

/* ---------------- OpenRouter call ---------------- */
function friendlyError(status, body) {
  const msg = body?.error?.message || body?.message || "";
  if (status === 401) return "المفتاح غير صالح أو منتهي (401). افتح الإعدادات وجرّب مفتاح تاني.";
  if (status === 402) return "الرصيد غير كافٍ (402). اشحن حساب OpenRouter أو اختار موديل مجاني من القائمة.";
  if (status === 403) return "الوصول مرفوض (403). تأكد إن المفتاح يسمح بالموديل ده.";
  if (status === 404) return "الموديل مش موجود (404). حدّث قائمة الموديلات واختار تاني.";
  if (status === 429) return "تجاوزت حد الطلبات (429). استنى شوية وجرّب تاني.";
  return `خطأ ${status}: ${msg || "حصلت مشكلة في الطلب"}`;
}

async function askOpenRouter(messages, onDelta) {
  const key = apiKey();
  const payload = {
    model: el.model.value || DEFAULT_MODELS[0],
    messages,
    temperature: Number(el.temp.value),
    stream: el.stream.checked,
  };
  state.abort = new AbortController();
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    signal: state.abort.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-OpenRouter-Title": "OpenCode Web",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch {}
    throw new Error(friendlyError(res.status, body));
  }
  if (!payload.stream) {
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? "";
    onDelta(text);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", full = "", finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") { finished = true; break; }
      try {
        const json = JSON.parse(data);
        if (json.error) throw new Error(json.error.message || "خطأ من OpenRouter أثناء البث");
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onDelta(full); }
      } catch (e) {
        if (e instanceof Error && !/JSON|Unexpected|undefined/i.test(e.message)) throw e;
      }
    }
  }
  return full;
}

/* ---------------- send ---------------- */
async function send() {
  if (state.busy) return;
  const text = el.input.value.trim();
  if (!text) return;
  clearError();
  if (!apiKey()) {
    showError("لسه مفيش مفتاح OpenRouter. افتح الإعدادات على اليمين والصق المفتاح في المربع، وبعدين ابعت رسالتك.");
    openSettings(true);
    return;
  }
  el.empty.classList.add("hidden");
  el.input.value = "";
  autoResize();
  state.messages.push({ role: "user", content: text });
  addMessage("user", text, false);
  const body = addMessage("assistant", "", true);
  scrollBottom();

  const system = el.system.value.trim();
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    ...state.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  state.busy = true;
  el.send.classList.add("hidden");
  el.stop.classList.remove("hidden");
  let answer = "";
  try {
    answer = await askOpenRouter(messages, (partial) => {
      answer = partial;
      updateMessage(body, partial, true);
      scrollBottom();
    });
    if (!answer) answer = "(مفيش رد من الموديل — جرّب موديل تاني أو راجع المفتاح)";
    updateMessage(body, answer, false);
    state.messages.push({ role: "assistant", content: answer });
    persistChat();
  } catch (e) {
    const aborted = e?.name === "AbortError";
    const msg = aborted ? "تم إيقاف الرد." : (e?.message?.includes("Failed to fetch") || e?.message?.includes("NetworkError")
      ? "مش قادر أوصل لـ OpenRouter. اتأكد من الإنترنت، أو جرّب المتصفح بدون إضافات بتحجب الطلبات (CORS/شبكة)."
      : e?.message || "حصل خطأ غير متوقع");
    if (aborted) { updateMessage(body, answer + "\n\n_(تم الإيقاف)_", false); }
    else { updateMessage(body, answer || "", false); showError(msg); }
  } finally {
    state.busy = false;
    state.abort = null;
    el.send.classList.remove("hidden");
    el.stop.classList.add("hidden");
    el.input.focus();
    scrollBottom();
  }
}

/* ---------------- events ---------------- */
function autoResize() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, 180)}px`;
}

function bind() {
  $("save-key").addEventListener("click", () => {
    const key = el.key.value.trim();
    if (!key) { setKeyStatus("اكتب المفتاح الأول.", "bad"); el.key.focus(); return; }
    set(LS.key, key);
    el.key.value = "";
    setKeyStatus(key.startsWith("sk-or-") ? "تم حفظ المفتاح ✓" : "اتحفظ، بس شكله مش مفتاح OpenRouter (المفروض يبدأ بـ sk-or-).", key.startsWith("sk-or-") ? "ok" : "bad");
    setConn(true, "جاري التحقق...");
    clearError();
    fetchModels();
  });
  $("clear-key").addEventListener("click", () => {
    del(LS.key);
    el.key.value = "";
    setKeyStatus("تم مسح المفتاح من المتصفح.", "bad");
    setConn(false, "غير متصل");
    state.models = [];
    fillModels([]);
    el.modelsHint.textContent = "احفظ المفتاح عشان نجيب الموديلات.";
  });
  $("toggle-key").addEventListener("click", () => {
    el.key.type = el.key.type === "password" ? "text" : "password";
  });
  el.key.addEventListener("keydown", (e) => { if (e.key === "Enter") $("save-key").click(); });

  $("refresh-models").addEventListener("click", () => {
    if (!apiKey()) { showError("احفظ المفتاح الأول."); openSettings(true); return; }
    fetchModels();
  });
  el.model.addEventListener("change", () => { set(LS.model, el.model.value); el.modelName.textContent = el.model.value; });
  el.system.addEventListener("change", () => set(LS.system, el.system.value));
  el.temp.addEventListener("input", () => { el.tempVal.textContent = el.temp.value; set(LS.temp, el.temp.value); });
  el.stream.addEventListener("change", () => set(LS.stream, el.stream.checked ? "1" : "0"));

  $("new-chat").addEventListener("click", () => {
    if (state.busy) state.abort?.abort();
    state.messages = [];
    del(LS.chat);
    el.messages.querySelectorAll(".msg").forEach((n) => n.remove());
    el.empty.classList.remove("hidden");
    clearError();
    closeSettings();
  });
  $("export-chat").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ model: el.model.value, messages: state.messages }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `opencode-chat-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  el.messages.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) { el.input.value = chip.textContent.trim(); autoResize(); el.input.focus(); return; }
    const copy = e.target.closest(".copy-code");
    if (copy) {
      const code = copy.parentElement.querySelector("code")?.textContent ?? "";
      navigator.clipboard.writeText(code).then(() => {
        copy.textContent = "تم ✓";
        setTimeout(() => (copy.textContent = "نسخ"), 1500);
      });
    }
  });
  $("empty-settings").addEventListener("click", () => openSettings(true));
  $("open-settings").addEventListener("click", () => openSettings(true));
  $("menu").addEventListener("click", () => el.sidebar.classList.contains("open") ? closeSettings() : openSettings());
  el.overlay.addEventListener("click", closeSettings);

  el.send.addEventListener("click", send);
  el.stop.addEventListener("click", () => state.abort?.abort());
  el.input.addEventListener("input", autoResize);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
}

function init() {
  const key = apiKey();
  el.system.value = get(LS.system, el.system.value);
  el.temp.value = get(LS.temp, "0.7");
  el.tempVal.textContent = el.temp.value;
  el.stream.checked = get(LS.stream, "1") === "1";
  fillModels([]);
  if (key) {
    setKeyStatus("فيه مفتاح محفوظ في المتصفح ✓ (سيب المربع فاضي لو مش عايز تغيّره)", "ok");
    setConn(true, "جاري التحقق...");
    fetchModels();
  } else {
    setKeyStatus("لا يوجد مفتاح محفوظ.");
    setConn(false, "غير متصل");
    el.modelsHint.textContent = "احفظ المفتاح الأول عشان نجيب الموديلات المتاحة.";
  }
  bind();
  restoreChat();
}
init();
