(() => {
  const $ = (s, r = document) => r.querySelector(s);

  function toCentsFromBRLInput(v) {
    const n = Number(String(v || "").replace(",", "."));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  function fmtBRL(c) {
    return (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function toast(msg) {
    if (typeof window.showToast === "function") return window.showToast(msg);
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(window.__toastT);
    window.__toastT = setTimeout(() => el.classList.remove("show"), 2600);
  }

  async function api(path, opts) {
    if (window.apiFetch) return window.apiFetch(path, opts);
    const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data?.error || `http_${res.status}`);
      e.data = data;
      throw e;
    }
    return data;
  }

  let currentRound = null;
  let latestBatchId = null;

  function setMode() {
    const hasOpen = !!(currentRound?.isOpen);
    $("#gorjetaCreateWrap").style.display = hasOpen ? "none" : "";
    $("#gorjetaDrawWrap").style.display = hasOpen ? "" : "none";
    $("#gorjetaCloseBtn").style.display = hasOpen ? "" : "none";
    $("#gorjetaSaldoBox").style.display = hasOpen ? "" : "none";
    $("#gorjetaRoundMeta").style.display = hasOpen ? "" : "none";
  }

  async function loadActive() {
    const d = await api("/api/gorjeta/active");
    if (!d?.isOpen) {
      currentRound = null;
      latestBatchId = null;
      $("#gorjetaSaldo").textContent = "—";
      $("#gorjetaRoundMeta").textContent = "Sem rodada aberta.";
      $("#gorjetaEntries").innerHTML = `<div class="g-empty">Abra uma rodada para começar.</div>`;
      $("#gorjetaBatches").innerHTML = `<div class="g-empty">—</div>`;
      $("#gorjetaResults").innerHTML = `<div class="g-empty">—</div>`;
      setMode();
      return;
    }

    currentRound = d.round;
    $("#gorjetaSaldo").textContent = fmtBRL(currentRound.remainingCents);
    $("#gorjetaRoundMeta").textContent = `Rodada aberta • Total da rodada ${fmtBRL(currentRound.totalCents)} • Pronta para novos sorteios`;

    setMode();
    await refreshAll();
  }

  async function refreshEntries() {
    if (!currentRound?.id) return;
    const entries = await api(`/api/gorjeta/rounds/${currentRound.id}/entries`);
    const box = $("#gorjetaEntries");

    if (!entries?.length) {
      box.innerHTML = `<div class="g-empty">Sem participantes. No chat da Twitch, digite <code>!gorjeta</code>.</div>`;
      return;
    }

    box.innerHTML = `
  <div class="g-list">
    ${entries
      .map((e) => {
        const ok = e.approvalStatus === "APROVADO";
        return `
          <div class="g-item">
            <div class="g-left">
              <div class="g-name">${e.twitchName}</div>
              <div class="g-sub">${new Date(e.joinedAt).toLocaleString("pt-BR")}</div>
            </div>
            <div class="g-pill ${ok ? "ok" : "bad"}">${ok ? "Aprovado" : "Não aprovado"}</div>
          </div>
        `;
      })
      .join("")}
  </div>`;
  }

  async function refreshBatches() {
    if (!currentRound?.id) return;
    const batches = await api(`/api/gorjeta/rounds/${currentRound.id}/batches`);
    const box = $("#gorjetaBatches");

    if (!batches?.length) {
      latestBatchId = null;
      box.innerHTML = `<div class="g-empty">Ainda não teve sorteio.</div>`;
      return;
    }

    latestBatchId = batches[0].id;

    box.innerHTML = `
      <div class="g-batches">
        ${batches
          .map((b) => {
            const spent = fmtBRL(b.spentCents);
            const per = fmtBRL(b.perWinnerCents);
            const dt = new Date(b.createdAt).toLocaleString("pt-BR");
            return `
              <button class="g-batch" data-batch="${b.id}">
                <div class="g-batch-top">
                  <span class="g-batch-id">Lote ${b.id.slice(0, 6)}</span>
                  <span class="g-batch-date">${dt}</span>
                </div>
                <div class="g-batch-mid">
                  <span>${b.winnersCount}x de ${per}</span>
                  <span>Gasto: ${spent}</span>
                </div>
                <div class="g-batch-bot">
                  <span class="g-tag ok">Confirmados: ${b.confirmedCount}</span>
                  <span class="g-tag bad">Desclass.: ${b.disqualifiedCount}</span>
                </div>
              </button>
            `;
          })
          .join("")}
      </div>
    `;

    box.querySelectorAll("[data-batch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        latestBatchId = btn.getAttribute("data-batch");
        refreshResults().catch(console.error);
      });
    });
  }

  async function refreshResults() {
    const box = $("#gorjetaResults");
    if (!latestBatchId) {
      box.innerHTML = `<div class="g-empty">Selecione um lote.</div>`;
      return;
    }

    const rows = await api(`/api/gorjeta/batches/${latestBatchId}/results`);
    if (!rows?.length) {
      box.innerHTML = `<div class="g-empty">Sem resultados.</div>`;
      return;
    }

    box.innerHTML = `
      <div class="g-list">
        ${rows
          .map((r) => {
            const ok = r.status === "CONFIRMADO";
return `
  <div class="g-item ${ok ? "ok" : "bad"}">
    <div class="g-left">
      <div class="g-name">${r.twitchName}</div>
      <div class="g-sub">${ok ? "✅ Aprovado" : `❌ ${r.reason || "Não aprovado"}`}</div>
    </div>
    <div class="g-right">
      <div class="g-money">${fmtBRL(r.valorCents)}</div>
    </div>
  </div>
`;
          })
          .join("")}
      </div>
    `;
  }

  async function refreshAll() {
    await refreshEntries();
    await refreshBatches();
    await refreshResults();
    const active = await api("/api/gorjeta/active").catch(() => null);
    if (active?.isOpen) {
      currentRound = active.round;
      $("#gorjetaSaldo").textContent = fmtBRL(currentRound.remainingCents);
      $("#gorjetaRoundMeta").textContent = `Rodada aberta • Total da rodada ${fmtBRL(currentRound.totalCents)} • Pronta para novos sorteios`;
      setMode();
    } else {
      await loadActive();
    }
  }

  async function createRound() {
    const totalCents = toCentsFromBRLInput($("#gorjetaTotal").value);
    if (totalCents <= 0) return toast("Digite um valor total válido.");
    await api("/api/gorjeta/rounds", { method: "POST", body: JSON.stringify({ totalCents }) });
    toast("Rodada criada e ABERTA ✅");
    await loadActive();
  }

  async function closeRound() {
    if (!currentRound?.id) return;
    await api(`/api/gorjeta/rounds/${currentRound.id}/close`, { method: "POST" });
    toast("Rodada fechada.");
    await loadActive();
  }

  async function drawBatch() {
    if (!currentRound?.id) return;

    const perWinnerCents = toCentsFromBRLInput($("#gorjetaPerWinner").value);
    const winnersCount = Number($("#gorjetaWinnersCount").value || 1);

    if (perWinnerCents <= 0) return toast("Digite um valor por ganhador válido.");
    if (!Number.isFinite(winnersCount) || winnersCount <= 0) return toast("Quantidade inválida.");

    try {
      const r = await api(`/api/gorjeta/rounds/${currentRound.id}/draw`, {
        method: "POST",
        body: JSON.stringify({ perWinnerCents, winnersCount }),
      });

      $("#gorjetaSaldo").textContent = fmtBRL(r.remainingCents);
      toast(r.autoClosed ? "Saldo zerou e a rodada foi fechada." : "Sorteio feito ✅");
      await refreshAll();
    } catch (e) {
      if (e?.data?.error === "sem_participantes") return toast("Sem participantes. Digite !gorjeta na Twitch.");
      if (e?.data?.error === "saldo_zerado") return toast("Saldo zerado. Feche e crie outra rodada.");
      if (e?.data?.error === "rodada_fechada") return toast("Rodada fechada.");
      toast("Erro ao sortear. Veja o console.");
      console.error(e);
    }
  }

  function wire() {
    const tab = $("#tab-gorjeta");
    if (!tab) return;

    $("#gorjetaRefreshBtn").addEventListener("click", () => refreshAll().catch(console.error));
    $("#gorjetaCreateBtn").addEventListener("click", () => createRound().catch(console.error));
    $("#gorjetaCloseBtn").addEventListener("click", () => closeRound().catch(console.error));
    $("#gorjetaDrawBtn").addEventListener("click", () => drawBatch().catch(console.error));

    loadActive().catch(console.error);
  }

  document.addEventListener("DOMContentLoaded", wire);

  window.GorjetaAdmin = {
    onTabShown() {
      refreshAll().catch(console.error);
    },
  };
})();