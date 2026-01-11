(async function () {
  const gamesEl = document.getElementById("games");
  const downloadsEl = document.getElementById("downloads");
  const statusEl = document.getElementById("status");
  const searchEl = document.getElementById("search");

  const navBtns = Array.from(document.querySelectorAll(".navBtn"));
  function showTab(tab) {
    navBtns.forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("show"));
    document.getElementById(`tab-${tab}`).classList.add("show");
  }
  navBtns.forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));

  const inProgress = new Map(); // gameId -> {percent, stage, name}

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function matchSearch(game, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    const hay = [game.name, game.category, (game.tags || []).join(" "), game.description || ""].join(" ").toLowerCase();
    return hay.includes(s);
  }

  function renderDownloads() {
    downloadsEl.innerHTML = "";
    if (inProgress.size === 0) {
      downloadsEl.innerHTML = `<div class="card"><div class="meta">No active downloads.</div></div>`;
      return;
    }
    for (const [id, st] of inProgress.entries()) {
      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <div class="title">${st.name || id}</div>
        <div class="meta">${st.stage || "Working"} — ${st.percent || 0}%</div>
        <div class="progressBar"><div class="progressFill" style="width:${st.percent || 0}%"></div></div>
      `;
      downloadsEl.appendChild(div);
    }
  }

  function gameCard(game) {
    const div = document.createElement("div");
    div.className = "card";

    const installing = inProgress.has(game.id);
    const inst = game.installed;

    div.innerHTML = `
      <div class="title">${game.name}</div>
      <div class="meta">${game.category || "Uncategorized"} • ${inst ? "Installed" : "Not installed"}</div>
      <div class="smallNote">${game.description || ""}</div>

      <div class="row" id="row-${game.id}">
        ${inst
          ? `<button class="btn primary" data-act="launch">Launch</button>
             <button class="btn danger" data-act="uninstall">Uninstall</button>`
          : `<button class="btn primary" data-act="install">${installing ? "Working..." : "Download"}</button>`}
      </div>

      <div class="progressWrap" id="prog-${game.id}" style="display:${installing ? "block" : "none"}">
        <div class="meta" id="progText-${game.id}">${installing ? `${inProgress.get(game.id).stage} — ${inProgress.get(game.id).percent}%` : ""}</div>
        <div class="progressBar"><div class="progressFill" id="progFill-${game.id}" style="width:${installing ? inProgress.get(game.id).percent : 0}%"></div></div>
      </div>
    `;

    div.querySelector(`#row-${game.id}`).addEventListener("click", async (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;

      try {
        if (act === "install") {
          setStatus(`Downloading ${game.name}…`);
          inProgress.set(game.id, { percent: 0, stage: "Starting", name: game.name });
          renderDownloads();
          await window.api.install(game.id);
        }

        if (act === "launch") {
          await window.api.launch(game.id, game.exe);
          setStatus(`Launched ${game.name}`);
        }

        if (act === "uninstall") {
          await window.api.uninstall(game.id);
          inProgress.delete(game.id);
          renderDownloads();
          setStatus(`Uninstalled ${game.name}`);
          await refresh();
        }
      } catch (err) {
        setStatus(String(err?.message || err));
      }
    });

    return div;
  }

  let allGames = [];

  async function refresh() {
    allGames = await window.api.getGames();
    render();
  }

  function render() {
    const q = (searchEl.value || "").trim();
    gamesEl.innerHTML = "";
    const filtered = allGames.filter(g => matchSearch(g, q));

    if (filtered.length === 0) {
      gamesEl.innerHTML = `<div class="card"><div class="meta">No games match your search.</div></div>`;
      return;
    }
    filtered.forEach(g => gamesEl.appendChild(gameCard(g)));
  }

  window.api.onInstallProgress(({ gameId, percent, stage }) => {
    const game = allGames.find(g => g.id === gameId);
    inProgress.set(gameId, { percent, stage, name: game?.name || gameId });
    renderDownloads();

    const txt = document.getElementById(`progText-${gameId}`);
    const fill = document.getElementById(`progFill-${gameId}`);
    const wrap = document.getElementById(`prog-${gameId}`);
    if (wrap) wrap.style.display = "block";
    if (txt) txt.textContent = `${stage} — ${percent}%`;
    if (fill) fill.style.width = `${percent}%`;
  });

  window.api.onInstallDone(async ({ gameId }) => {
    inProgress.delete(gameId);
    renderDownloads();
    setStatus(`Installed ${gameId}`);
    await refresh();
  });

  window.api.onInstallError(({ gameId, message }) => {
    inProgress.delete(gameId);
    renderDownloads();
    setStatus(`Install failed for ${gameId}: ${message}`);
  });

  window.api.onUninstallDone(async ({ gameId }) => {
    setStatus(`Uninstalled ${gameId}`);
    await refresh();
  });

  searchEl.addEventListener("input", render);

  const openRepoBtn = document.getElementById("openRepo");
  if (openRepoBtn) {
    openRepoBtn.addEventListener("click", () =>
      window.api.openExternal("https://github.com/AverageTrashGame/vyltrexlaunchergame")
    );
  }

  setStatus("Loading…");
  await refresh();
  renderDownloads();
  setStatus("Ready.");
})();
