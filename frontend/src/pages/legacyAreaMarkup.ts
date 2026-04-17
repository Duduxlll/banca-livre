export const PALPITE_HTML = String.raw`
  <div class="card" style="margin-bottom:12px">
    <div class="palpite-head">
      <div>
        <h2 style="margin:0">💰 Palpites</h2>
        <div class="palpite-status-row">
          <span id="palpiteStatusBadge" class="p-status p-closed">FECHADO</span>
          <span id="palpiteStatusText" class="p-status-text">Palpites estão fechados</span>
        </div>
        <p class="muted" style="margin:6px 0 0">
          Chat: <code>!p 231</code> (somente valor)
        </p>
      </div>
      <div class="palpite-actions">
        <button class="btn btn--primary" id="btnPalpiteOpen">🟢 Abrir Palpites</button>
        <button class="btn btn--ghost" id="btnPalpiteClose">🔴 Fechar Palpites</button>
        <button class="btn btn--danger" id="btnPalpiteClear">Limpar</button>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label class="muted">Valor da Compra (Bonus Buy)</label>
        <input type="number" step="0.01" class="input" id="palpiteBuyValue" placeholder="Ex: 200">
      </div>
      <div>
        <label class="muted">Ganhadores</label>
        <select class="input" id="palpiteWinnersCount">
          <option value="1">Top 1</option>
          <option value="2">Top 2</option>
          <option value="3" selected>Top 3</option>
        </select>
      </div>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px">
    <label class="muted">Log de Palpites</label>
    <div class="palpite-log" id="palpiteLogBox"></div>
    <div style="text-align:right; color:#aaa; font-size:0.8rem; margin-top:6px;">
      Total de palpites: <span id="palpiteTotalGuesses">0</span>
    </div>
  </div>

  <div class="card">
    <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end">
      <div>
        <label class="muted">Quanto Pagou (Resultado Real)</label>
        <input type="number" step="0.01" class="input" id="palpiteFinalResult" placeholder="Ex: 240.50">
      </div>
      <button class="btn btn--primary" id="btnPalpiteWinners">🏆 Verificar Vencedores</button>
    </div>
    <div class="palpite-winners" id="palpiteWinnersBox" style="margin-top:10px">—</div>
  </div>
`;

export const GORJETA_HTML = String.raw`
  <div class="card">
    <div class="g-top">
      <h2>Gorjeta</h2>
      <div class="g-actions">
        <div class="g-saldo" id="gorjetaSaldoBox">Saldo: <span id="gorjetaSaldo">—</span></div>
        <button id="gorjetaRefreshBtn" class="g-btn">Atualizar</button>
        <button id="gorjetaCloseBtn" class="g-btn danger" style="display:none">Fechar rodada</button>
      </div>
    </div>
    <div class="g-meta" id="gorjetaRoundMeta">—</div>
    <div id="gorjetaCreateWrap" style="margin-top:14px">
      <div class="g-grid">
        <label class="g-field">
          <span>Valor total (R$)</span>
          <input id="gorjetaTotal" class="g-input" placeholder="500" />
        </label>
      </div>
      <div style="margin-top:12px">
        <button id="gorjetaCreateBtn" class="g-btn primary">Criar e Abrir</button>
      </div>
    </div>
    <div id="gorjetaDrawWrap" style="display:none; margin-top:14px">
      <div class="g-grid">
        <label class="g-field">
          <span>Valor por ganhador (R$)</span>
          <input id="gorjetaPerWinner" class="g-input" placeholder="20" />
        </label>
        <label class="g-field">
          <span>Quantidade de ganhadores</span>
          <input id="gorjetaWinnersCount" class="g-input" placeholder="10" />
        </label>
      </div>
      <div style="margin-top:12px">
        <button id="gorjetaDrawBtn" class="g-btn primary">Sortear</button>
      </div>
    </div>
  </div>
  <div class="card">
    <h3>Participantes</h3>
    <div id="gorjetaEntries"></div>
  </div>
  <div class="card">
    <h3>Histórico de sorteios</h3>
    <div id="gorjetaBatches"></div>
  </div>
  <div class="card">
    <h3>Resultado</h3>
    <div id="gorjetaResults"></div>
  </div>
`;
