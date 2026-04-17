export const AREA_RUNTIME_CSS = `
  #msgModal::backdrop,
  #addBancaModal::backdrop{
    background:rgba(8,12,26,.65);
    backdrop-filter:blur(6px) saturate(.9);
  }
  #msgModal,
  #addBancaModal{
    border:0;
    padding:0;
    background:transparent;
  }
  .msg-modal-box{
    width:min(94vw,560px);
    background:linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.05));
    border:1px solid rgba(255,255,255,.18);
    border-radius:16px;
    box-shadow:0 30px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.04);
    padding:18px;
    color:#e7e9f3;
  }
  .msg-modal-box h3{ margin:0 0 8px; font-weight:800; }
  .msg-modal-box p{ margin:0 0 12px; color:#cfd2e8; white-space:pre-wrap; line-height:1.5; }
  .add-banca-card{
    width:min(96vw,640px);
    background:linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04));
    border-radius:16px;
    border:1px solid rgba(255,255,255,.15);
    box-shadow:0 30px 90px rgba(0,0,0,.7);
    padding:18px 18px 16px;
    color:#e7e9f3;
  }
  .add-banca-card .add-banca-header{
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    gap:8px;
    margin-bottom:10px;
  }
  .add-banca-title{ margin:0; font-size:1.1rem; font-weight:800; }
  .add-banca-sub{ margin:2px 0 0; font-size:.8rem; opacity:.8; }
  .add-banca-close{
    border:0;
    background:transparent;
    color:#f5f5f5;
    font-size:20px;
    line-height:1;
    cursor:pointer;
  }
  .add-banca-card .add-banca-form{ display:grid; gap:10px; }
  .add-banca-row{
    display:grid;
    grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);
    gap:10px;
  }
  .add-banca-card .add-banca-field{ display:grid; gap:4px; font-size:.85rem; }
  .add-banca-pix-row{
    display:grid;
    grid-template-columns:minmax(120px,.8fr) minmax(0,1.4fr);
    gap:8px;
  }
  .add-banca-actions{ margin-top:4px; display:flex; justify-content:flex-end; gap:8px; }
  .totais-popup{
    position:fixed;
    z-index:9999;
    background:linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,.06));
    border-radius:14px;
    border:1px solid rgba(255,255,255,.25);
    box-shadow:0 22px 60px rgba(40,20,5,.65);
    padding:12px 14px 14px;
    min-width:220px;
    max-width:260px;
    animation:totaisPopupIn .16s ease-out;
  }
  @keyframes totaisPopupIn{
    from{ opacity:0; transform:translateY(6px) scale(.97); }
    to{ opacity:1; transform:translateY(0) scale(1); }
  }
  .totais-popup-header{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }
  .totais-popup-title{ font-size:14px; font-weight:800; }
  .totais-popup-value{ font-size:16px; font-weight:800; margin:0; color:#fff; font-variant-numeric:tabular-nums; }
  .totais-popup-close{ border:0; background:transparent; color:#fff; cursor:pointer; font-size:16px; line-height:1; padding:2px 4px; }
  .toast--error{ border-color:rgba(255,106,143,.34); color:#ffd5de; }
  .toast--ok,
  .toast--success{ border-color:rgba(57,247,157,.28); color:#eafff2; }
  .toast--info{ border-color:rgba(134,255,214,.24); color:#d9ffee; }
  #sorteioConfirmModal::backdrop,
  #idModal::backdrop{
    background:rgba(8,12,26,.68);
    backdrop-filter:blur(6px) saturate(.9);
  }
  #sorteioConfirmModal,
  #idModal{
    border:0;
    padding:0;
    background:transparent;
  }
  .sorteio-confirm-box{
    width:min(94vw,420px);
    background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.04));
    border:1px solid rgba(255,255,255,.18);
    border-radius:16px;
    box-shadow:0 30px 90px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04);
    padding:18px;
    color:#e7e9f3;
  }
  .sorteio-confirm-title{ margin:0 0 6px; font-weight:800; font-size:1rem; }
  .sorteio-confirm-text{ margin:0 0 12px; font-size:.9rem; color:#cfd2e8; }
  .sorteio-confirm-actions{ display:flex; gap:8px; justify-content:flex-end; margin-top:4px; }
  .id-modal-box{
    width:min(94vw,420px);
    background:linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04));
    border:1px solid rgba(255,255,255,.18);
    border-radius:16px;
    box-shadow:0 30px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.04);
    padding:18px;
    color:#e7e9f3;
  }
  .id-modal-code{
    display:grid;
    gap:10px;
    margin-top:12px;
    padding:12px;
    border-radius:14px;
    border:1px solid rgba(57,247,157,.16);
    background:rgba(57,247,157,.06);
  }
  .id-modal-label{ color:#cfd2e8; font-size:.78rem; font-weight:800; text-transform:uppercase; letter-spacing:.06em; }
  .id-modal-value{ margin-top:3px; color:#fff; font-weight:800; overflow-wrap:anywhere; }
  .id-modal-value--code{ font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  @media (max-width:600px){
    .add-banca-row,
    .add-banca-pix-row{ grid-template-columns:minmax(0,1fr); }
    .add-banca-actions{ flex-direction:column; }
  }
`;
