// Example Custom View: a month calendar of the "Events" list, with a
// detail panel that pulls a row from "EventDetails" and a poster image on
// demand. Shows the whole author-facing surface: skye.lists(), skye.list()
// with a structured query, skye.item()-style filtering, skye.image(), and
// skye.navigate().

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const grid = document.getElementById("grid");
const monthName = document.getElementById("monthName");
const countEl = document.getElementById("count");
const detail = document.getElementById("detail");
const poster = document.getElementById("poster");
const cap = document.getElementById("cap");
const info = document.getElementById("info");

document.getElementById("perms").textContent = (await skye.lists()).join(", ");

// All events once, sorted; we bucket by month client-side so paging the
// calendar never re-queries.
const events = (await skye.list("Events", { orderBy: [{ field: "Start", direction: "asc" }], top: 200 })).items.map((i) => ({
  id: i.id,
  ...i.fields,
}));

const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
let cursor = events.length ? parse(events[0].Start) : new Date();
cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));

function render() {
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  monthName.textContent = first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const byDay = new Map();
  for (const ev of events) {
    const d = parse(ev.Start);
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
      const key = d.getUTCDate();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(ev);
    }
  }
  countEl.textContent = `${[...byDay.values()].reduce((n, a) => n + a.length, 0)} events`;

  grid.replaceChildren();
  for (const d of DAYS) grid.insertAdjacentHTML("beforeend", `<div class="head">${d}</div>`);
  for (let i = 0; i < first.getUTCDay(); i++) grid.insertAdjacentHTML("beforeend", `<div class="cell blank"></div>`);

  for (let day = 1; day <= last.getUTCDate(); day++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.insertAdjacentHTML("beforeend", `<span class="num">${day}</span>`);
    for (const ev of byDay.get(day) ?? []) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = ev.Title;
      chip.onclick = () => open_(ev);
      cell.append(chip);
    }
    grid.append(cell);
  }
}

// The two things a calendar row doesn't carry: a detail row from a second
// list, and the poster (a file, not a field). Both fetched only on demand.
async function open_(ev) {
  detail.hidden = false;
  poster.removeAttribute("src");
  info.innerHTML = `<h3>${ev.Title}</h3><p>loading…</p>`;

  const [details, art] = await Promise.all([
    skye.list("EventDetails", { where: { field: "EventId", operator: "equals", value: Number(ev.id) }, top: 1 }),
    skye.image("Events", ev.id, "Poster").catch(() => null),
  ]);
  const d = details.items[0]?.fields ?? {};

  if (art) poster.src = art;
  cap.textContent = art ? "Poster" : "";
  info.innerHTML = `
    <h3>${ev.Title}</h3>
    <dl>
      <dt>When</dt><dd>${ev.Start}</dd>
      <dt>Where</dt><dd>${ev.Location ?? ""}</dd>
      <dt>Track</dt><dd>${ev.Category ?? ""}</dd>
      ${d.Host ? `<dt>Host</dt><dd>${d.Host}</dd>` : ""}
    </dl>
    <p>${d.Description ?? ""}</p>
    <button id="signup">Sign up →</button>`;
  document.getElementById("signup").onclick = () => skye.navigate({ form: "test-event-signup" });
}

document.getElementById("closeBtn").onclick = () => (detail.hidden = true);
document.getElementById("prev").onclick = () => {
  cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1));
  render();
};
document.getElementById("next").onclick = () => {
  cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  render();
};

render();
