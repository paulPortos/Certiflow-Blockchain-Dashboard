/* ─────────────────────────────────────────────────────────────
   CertiFlow Blockchain Explorer — app.js
   ───────────────────────────────────────────────────────────── */

// ── CONFIG (stored in localStorage) ───────────────────────────
const STORAGE_KEY = "certiflow_config";

/** Load saved config from localStorage, or return null if none exists */
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    // Validate all 4 fields are present and non-empty
    if (cfg.rpc && cfg.cert && cfg.entity && cfg.attach) return cfg;
    return null;
  } catch {
    return null;
  }
}

/** Persist config to localStorage */
function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

// ── ABIS (events + view functions only) ───────────────────────
const CERT_ABI = [
  "event CertificateRegistered(bytes32 indexed metadataHash, uint256 indexed certificateId, string ipfsCid, uint256 version, uint256 timestamp)",
  "event CertificateUpdated(bytes32 indexed oldHash, bytes32 indexed newHash, uint256 indexed certificateId, uint256 version, uint256 timestamp)",
  "event CertificateRevoked(bytes32 indexed metadataHash, uint256 indexed certificateId, uint256 timestamp, string reason)",
  "function verifyCertificate(bytes32 metadataHash) view returns (bool exists, uint256 certificateId, string ipfsCid, bytes32 recipientHash, uint256 version, uint256 timestamp, bool revoked)",
  "function isValidCertificate(bytes32 metadataHash) view returns (bool isValid)",
];

const ENTITY_ABI = [
  "event EntityRegistered(bytes32 indexed entityHash, uint8 indexed entityType, uint256 indexed entityId, uint256 version, uint256 timestamp)",
  "event EntityUpdated(bytes32 indexed oldHash, bytes32 indexed newHash, uint8 entityType, uint256 indexed entityId, uint256 version, uint256 timestamp)",
  "function verifyEntity(bytes32 entityHash) view returns (bool exists, uint8 entityType, uint256 entityId, uint256 version, uint256 timestamp)",
];

const ATTACH_ABI = [
  "event AttachmentRegistered(bytes32 indexed fileHash, uint8 indexed entityType, uint256 indexed entityId, uint8 attachmentType, uint256 version, uint256 timestamp)",
  "event AttachmentUpdated(bytes32 indexed oldHash, bytes32 indexed newHash, uint8 indexed entityType, uint256 entityId, uint8 attachmentType, uint256 version, uint256 timestamp)",
  "function verifyAttachment(bytes32 fileHash) view returns (bool exists, uint8 entityType, uint256 entityId, uint8 attachmentType, uint256 timestamp, uint256 version)",
];

// ── LABEL MAPS ────────────────────────────────────────────────
const ENTITY_TYPE = { 0: "Organization", 1: "Business" };
const ATTACH_TYPE = {
  0: "SEC Registration",
  1: "Accreditation Cert",
  2: "Business Permit",
  3: "Tax Certificate",
  4: "Government ID",
  5: "Other",
};

// ── STATE ─────────────────────────────────────────────────────
let provider, certContract, entityContract, attachContract;

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  const saved = loadConfig();

  if (saved) {
    // Config exists — populate settings inputs & auto-connect
    document.getElementById("rpcUrl").value = saved.rpc;
    document.getElementById("certAddr").value = saved.cert;
    document.getElementById("entityAddr").value = saved.entity;
    document.getElementById("attachAddr").value = saved.attach;
    connectAndLoad();
  } else {
    // First visit — show the config modal
    openConfigModal();
  }

  // FAQ accordion toggle
  document.querySelectorAll(".faq-question").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".faq-item");
      const isOpen = item.classList.contains("open");
      document
        .querySelectorAll(".faq-item")
        .forEach((i) => i.classList.remove("open"));
      if (!isOpen) item.classList.add("open");
    });
  });
});

// ── SETTINGS TOGGLE ──────────────────────────────────────────
function toggleSettings() {
  document.getElementById("settingsBar").classList.toggle("open");
}

// ── CONFIG MODAL ─────────────────────────────────────────────
function openConfigModal() {
  const saved = loadConfig();
  if (saved) {
    document.getElementById("cfgRpc").value = saved.rpc;
    document.getElementById("cfgCert").value = saved.cert;
    document.getElementById("cfgEntity").value = saved.entity;
    document.getElementById("cfgAttach").value = saved.attach;
  }

  // Reset tabs to manual
  switchConfigTab("manual");
  document.getElementById("cfgPaste").value = "";

  document.getElementById("configOverlay").classList.add("open");
}

function closeConfigModal() {
  document.getElementById("configOverlay").classList.remove("open");
}

function submitConfig() {
  const rpc = document.getElementById("cfgRpc").value.trim();
  const cert = document.getElementById("cfgCert").value.trim();
  const entity = document.getElementById("cfgEntity").value.trim();
  const attach = document.getElementById("cfgAttach").value.trim();

  // Basic validation
  if (!rpc || !cert || !entity || !attach) {
    showToast("Please fill in all 4 fields.", "error");
    return;
  }
  if (
    !cert.startsWith("0x") ||
    !entity.startsWith("0x") ||
    !attach.startsWith("0x")
  ) {
    showToast("Contract addresses must start with 0x.", "error");
    return;
  }

  const cfg = { rpc, cert, entity, attach };
  saveConfig(cfg);

  // Populate settings bar inputs too
  document.getElementById("rpcUrl").value = rpc;
  document.getElementById("certAddr").value = cert;
  document.getElementById("entityAddr").value = entity;
  document.getElementById("attachAddr").value = attach;

  closeConfigModal();
  showToast("Configuration saved!", "success");
  connectAndLoad();
}

function handleEnvPaste(e) {
  const val = e.target.value;
  if (!val.trim()) return;

  const lines = val.split("\n");
  let matched = false;

  lines.forEach((line) => {
    // Basic parse of KEY=VALUE
    const parts = line.split("=");
    if (parts.length < 2) return;

    const key = parts[0].trim();
    // Re-join the rest in case the value has an '=' sign in it
    const value = parts
      .slice(1)
      .join("=")
      .trim()
      .replace(/^["']|["']$/g, "");

    switch (key) {
      case "BLOCKCHAIN_RPC_URL":
        document.getElementById("cfgRpc").value = value;
        matched = true;
        break;
      case "CERTIFICATE_REGISTRY_CONTRACT_ADDRESS":
        document.getElementById("cfgCert").value = value;
        matched = true;
        break;
      case "ENTITY_REGISTRY_CONTRACT_ADDRESS":
        document.getElementById("cfgEntity").value = value;
        matched = true;
        break;
      case "ATTACHMENT_REGISTRY_CONTRACT_ADDRESS":
        document.getElementById("cfgAttach").value = value;
        matched = true;
        break;
    }
  });

  if (matched) {
    showToast("Values extracted from paste!", "success");
  }
}

function switchConfigTab(tabId) {
  // Update buttons
  document.getElementById("tabBtnManual").classList.remove("active");
  document.getElementById("tabBtnPaste").classList.remove("active");

  // Update panels
  document.getElementById("cfgPanelManual").classList.remove("active");
  document.getElementById("cfgPanelPaste").classList.remove("active");

  if (tabId === "manual") {
    document.getElementById("tabBtnManual").classList.add("active");
    document.getElementById("cfgPanelManual").classList.add("active");
  } else {
    document.getElementById("tabBtnPaste").classList.add("active");
    document.getElementById("cfgPanelPaste").classList.add("active");
  }
}

// ── CONNECT & LOAD ────────────────────────────────────────────
async function connectAndLoad() {
  const saved = loadConfig();
  const rpcUrl =
    document.getElementById("rpcUrl").value.trim() ||
    (saved && saved.rpc) ||
    "";
  const certAddr =
    document.getElementById("certAddr").value.trim() ||
    (saved && saved.cert) ||
    "";
  const entityAddr =
    document.getElementById("entityAddr").value.trim() ||
    (saved && saved.entity) ||
    "";
  const attachAddr =
    document.getElementById("attachAddr").value.trim() ||
    (saved && saved.attach) ||
    "";

  if (!rpcUrl || !certAddr || !entityAddr || !attachAddr) {
    showToast("Missing config — please configure first.", "error");
    openConfigModal();
    return;
  }

  setStatus("loading", "Connecting…");
  showLoader();

  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    await provider.getNetwork(); // will throw if unreachable

    certContract = new ethers.Contract(certAddr, CERT_ABI, provider);
    entityContract = new ethers.Contract(entityAddr, ENTITY_ABI, provider);
    attachContract = new ethers.Contract(attachAddr, ATTACH_ABI, provider);

    const [network, block] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
    ]);

    // Update navbar
    setStatus("connected", `Connected · ${rpcUrl}`);
    document.getElementById("blockNumber").textContent =
      `Block ${block.toLocaleString()}`;
    document.getElementById("networkId").textContent =
      `Chain ${network.chainId}`;
    document.getElementById("networkInfo").style.display = "flex";
    document.getElementById("connectBtn").textContent = "Refresh";

    // Show dashboard
    document.getElementById("splash").style.display = "none";
    document.getElementById("dashboard").style.display = "block";

    await loadAllEvents();
    showToast("Connected & loaded", "success");
  } catch (err) {
    setStatus("disconnected", "Disconnected");
    showToast(`Connection failed: ${err.message}`, "error");
    console.error(err);
  }
}

// ── LOAD ALL EVENTS ───────────────────────────────────────────
async function loadAllEvents() {
  const [certEvents, entityEvents, attachEvents] = await Promise.all([
    fetchCertificateEvents(),
    fetchEntityEvents(),
    fetchAttachmentEvents(),
  ]);

  window.allEventsCache = [
    ...certEvents.map((e) => ({ registry: "Certificate", ...e })),
    ...entityEvents.map((e) => ({ registry: "Entity", ...e })),
    ...attachEvents.map((e) => ({ registry: "Attachment", ...e })),
  ].sort((a, b) => b.block - a.block);

  renderCertificates(certEvents);
  renderEntities(entityEvents);
  renderAttachments(attachEvents);

  const total = certEvents.length + entityEvents.length + attachEvents.length;
  document.getElementById("certCount").textContent = certEvents.length;
  document.getElementById("entityCount").textContent = entityEvents.length;
  document.getElementById("attachCount").textContent = attachEvents.length;
  document.getElementById("totalTx").textContent = total;

  document.getElementById("tabCertCount").textContent = certEvents.length;
  document.getElementById("tabEntityCount").textContent = entityEvents.length;
  document.getElementById("tabAttachCount").textContent = attachEvents.length;
}

// ── EXPORT CSV ────────────────────────────────────────────────
async function exportToCsv() {
  if (!window.allEventsCache || window.allEventsCache.length === 0) {
    showToast("No data to export.", "error");
    return;
  }

  showToast("Fetching transaction costs... this might take a moment.", "info");
  setStatus("loading", "Exporting CSV...");
  showLoader();

  try {
    const uniqueTxHashes = [
      ...new Set(window.allEventsCache.map((e) => e.txHash)),
    ];
    const txCosts = {};

    // Fetch receipts in small chunks
    const chunkSize = 10;
    for (let i = 0; i < uniqueTxHashes.length; i += chunkSize) {
      const chunk = uniqueTxHashes.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (hash) => {
          try {
            const receipt = await provider.getTransactionReceipt(hash);
            if (receipt && receipt.fee) {
              txCosts[hash] = ethers.formatEther(receipt.fee);
            } else {
              txCosts[hash] = "0";
            }
          } catch (e) {
            console.warn("Could not fetch receipt for", hash);
            txCosts[hash] = "Unknown";
          }
        }),
      );
    }

    const headers = [
      "Registry",
      "Event Type",
      "Transaction Hash",
      "Block No.",
      "Date/Time (UTC)",
      "Transaction Cost (Native)",
      "Details",
    ];

    let csvContent = headers.join(",") + "\\n";

    window.allEventsCache.forEach((e) => {
      const dateString = new Date(e.timestamp * 1000)
        .toISOString()
        .replace("T", " ")
        .substring(0, 19);
      let details = "";

      if (e.registry === "Certificate") {
        details = `"ID: ${e.certId}, CID: ${e.ipfsCid || "None"}, Version: ${e.version}, Revoked: ${e.revoked ? "Yes" : "No"}"`;
      } else if (e.registry === "Entity") {
        details = `"Entity Hash: ${e.entityHash}, ID: ${e.entityId}, Type: ${ENTITY_TYPE[Number(e.entityType)] || e.entityType}, Version: ${e.version}"`;
      } else if (e.registry === "Attachment") {
        details = `"File Hash: ${e.fileHash}, Entity ID: ${e.entityId}, Entity Type: ${ENTITY_TYPE[Number(e.entityType)] || e.entityType}, Attach Type: ${ATTACH_TYPE[Number(e.attachmentType)] || e.attachmentType}, Version: ${e.version}"`;
      }

      const cost =
        txCosts[e.txHash] !== undefined ? txCosts[e.txHash] : "Unknown";

      const row = [
        e.registry,
        "Registered",
        e.txHash,
        e.block,
        dateString,
        cost,
        details,
      ];
      csvContent += row.join(",") + "\\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "certiflow_export.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Export complete!", "success");

    // Restore status
    const saved = loadConfig();
    const rpcUrl =
      document.getElementById("rpcUrl").value.trim() ||
      (saved && saved.rpc) ||
      "";
    setStatus("connected", `Connected · ${rpcUrl}`);
    document.getElementById("splash").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
  } catch (err) {
    console.error("Export error:", err);
    showToast("Failed to export CSV.", "error");
    setStatus("connected", "Connected");
    document.getElementById("splash").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
  }
}

// ── FETCH EVENTS ──────────────────────────────────────────────
async function fetchCertificateEvents() {
  try {
    const [reg, rev, upd] = await Promise.all([
      certContract.queryFilter(
        certContract.filters.CertificateRegistered(),
        0,
        "latest",
      ),
      certContract.queryFilter(
        certContract.filters.CertificateRevoked(),
        0,
        "latest",
      ),
      certContract.queryFilter(
        certContract.filters.CertificateUpdated(),
        0,
        "latest",
      ),
    ]);

    const revokedHashes = new Set(rev.map((e) => e.args.metadataHash));

    return reg
      .map((e) => ({
        type: "Registered",
        txHash: e.transactionHash,
        block: e.blockNumber,
        metadataHash: e.args.metadataHash,
        certId: e.args.certificateId.toString(),
        ipfsCid: e.args.ipfsCid,
        version: e.args.version.toString(),
        timestamp: Number(e.args.timestamp),
        revoked: revokedHashes.has(e.args.metadataHash),
      }))
      .sort((a, b) => b.block - a.block);
  } catch {
    return [];
  }
}

async function fetchEntityEvents() {
  try {
    const events = await entityContract.queryFilter(
      entityContract.filters.EntityRegistered(),
      0,
      "latest",
    );
    return events
      .map((e) => ({
        txHash: e.transactionHash,
        block: e.blockNumber,
        entityHash: e.args.entityHash,
        entityType: Number(e.args.entityType),
        entityId: e.args.entityId.toString(),
        version: e.args.version.toString(),
        timestamp: Number(e.args.timestamp),
      }))
      .sort((a, b) => b.block - a.block);
  } catch {
    return [];
  }
}

async function fetchAttachmentEvents() {
  try {
    const events = await attachContract.queryFilter(
      attachContract.filters.AttachmentRegistered(),
      0,
      "latest",
    );
    return events
      .map((e) => ({
        txHash: e.transactionHash,
        block: e.blockNumber,
        fileHash: e.args.fileHash,
        entityType: Number(e.args.entityType),
        entityId: e.args.entityId.toString(),
        attachmentType: Number(e.args.attachmentType),
        version: e.args.version.toString(),
        timestamp: Number(e.args.timestamp),
      }))
      .sort((a, b) => b.block - a.block);
  } catch {
    return [];
  }
}

// ── RENDER CERTIFICATES ───────────────────────────────────────
function renderCertificates(events) {
  const wrap = document.getElementById("certTableWrap");
  if (!events.length) {
    wrap.innerHTML =
      '<div class="empty-state">No certificate events found.</div>';
    return;
  }

  const rows = events
    .map(
      (e) => `
      <tr>
      <td>${fmtTime(e.timestamp)}</td>
      <td><span class="hash-cell" title="${e.metadataHash}">${short(e.metadataHash)}</span>
          <button class="copy-btn" onclick="copy('${e.metadataHash}')" title="Copy">⎘</button></td>
      <td><code style="font-size:.78rem;color:var(--text-2)">${e.certId}</code></td>
      <td>${e.ipfsCid ? `<a href="https://gateway.pinata.cloud/ipfs/${e.ipfsCid}" target="_blank" style="color:var(--indigo);font-size:.78rem">${short(e.ipfsCid, 14)}</a>` : "—"}</td>
      <td><code style="font-size:.78rem;color:var(--text-2)">v${e.version}</code></td>
      <td>${
        e.revoked
          ? '<span class="badge badge-revoked">Revoked</span>'
          : '<span class="badge badge-valid">Valid</span>'
      }</td>
      <td><span class="hash-cell" title="${e.txHash}">${short(e.txHash)}</span>
          <button class="copy-btn" onclick="copy('${e.txHash}')" title="Copy">⎘</button></td>
      <td>#${e.block}</td>
      <td><button class="detail-btn" onclick='showCertDetail(${JSON.stringify(e)})'>Details</button></td>
    </tr>
      `,
    )
    .join("");

  wrap.innerHTML = `
      <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Time</th><th>Metadata Hash</th><th>Cert ID</th>
          <th>IPFS CID</th><th>Version</th><th>Status</th>
          <th>TX Hash</th><th>Block</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── RENDER ENTITIES ───────────────────────────────────────────
function renderEntities(events) {
  const wrap = document.getElementById("entityTableWrap");
  if (!events.length) {
    wrap.innerHTML = '<div class="empty-state">No entity events found.</div>';
    return;
  }

  const rows = events
    .map(
      (e) => `
      <tr>
      <td>${fmtTime(e.timestamp)}</td>
      <td><span class="hash-cell" title="${e.entityHash}">${short(e.entityHash)}</span>
          <button class="copy-btn" onclick="copy('${e.entityHash}')" title="Copy">⎘</button></td>
      <td>${
        e.entityType === 0
          ? '<span class="badge badge-org">Organization</span>'
          : '<span class="badge badge-biz">Business</span>'
      }</td>
      <td><code style="font-size:.78rem;color:var(--text-2)">${e.entityId}</code></td>
      <td><code style="font-size:.78rem;color:var(--text-2)">v${e.version}</code></td>
      <td><span class="hash-cell" title="${e.txHash}">${short(e.txHash)}</span>
          <button class="copy-btn" onclick="copy('${e.txHash}')" title="Copy">⎘</button></td>
      <td>#${e.block}</td>
      <td><button class="detail-btn" onclick='showEntityDetail(${JSON.stringify(e)})'>Details</button></td>
    </tr>
      `,
    )
    .join("");

  wrap.innerHTML = `
      <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Time</th><th>Entity Hash</th><th>Type</th>
          <th>Entity ID</th><th>Version</th>
          <th>TX Hash</th><th>Block</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── RENDER ATTACHMENTS ────────────────────────────────────────
function renderAttachments(events) {
  const wrap = document.getElementById("attachTableWrap");
  if (!events.length) {
    wrap.innerHTML =
      '<div class="empty-state">No attachment events found.</div>';
    return;
  }

  const rows = events
    .map(
      (e) => `
      <tr>
      <td>${fmtTime(e.timestamp)}</td>
      <td><span class="hash-cell" title="${e.fileHash}">${short(e.fileHash)}</span>
          <button class="copy-btn" onclick="copy('${e.fileHash}')" title="Copy">⎘</button></td>
      <td>${
        e.entityType === 0
          ? '<span class="badge badge-org">Organization</span>'
          : '<span class="badge badge-biz">Business</span>'
      }</td>
      <td><code style="font-size:.78rem;color:var(--text-2)">${e.entityId}</code></td>
      <td><span class="badge badge-attach" style="font-size:.7rem">${ATTACH_TYPE[e.attachmentType] ?? e.attachmentType}</span></td>
      <td><code style="font-size:.78rem;color:var(--text-2)">v${e.version}</code></td>
      <td><span class="hash-cell" title="${e.txHash}">${short(e.txHash)}</span>
          <button class="copy-btn" onclick="copy('${e.txHash}')" title="Copy">⎘</button></td>
      <td>#${e.block}</td>
      <td><button class="detail-btn" onclick='showAttachDetail(${JSON.stringify(e)})'>Details</button></td>
    </tr>
      `,
    )
    .join("");

  wrap.innerHTML = `
      <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Time</th><th>File Hash</th><th>Entity Type</th>
          <th>Entity ID</th><th>Attachment Type</th><th>Version</th>
          <th>TX Hash</th><th>Block</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── HASH LOOKUP ───────────────────────────────────────────────
async function lookupHash() {
  if (!provider) {
    showToast("Connect first", "error");
    return;
  }

  const registry = document.getElementById("lookupRegistry").value;
  const hash = document.getElementById("lookupHash").value.trim();
  const result = document.getElementById("lookupResult");

  if (!hash || !hash.startsWith("0x")) {
    result.innerHTML = `<div class="result-card error"><div class="result-row"><span class="result-key">Error</span><span class="result-value">Please enter a valid 0x hash.</span></div></div>`;
    return;
  }

  result.innerHTML = `<div class="loading-wrap"><div class="spinner"></div> Querying blockchain…</div>`;

  try {
    let rows = "";

    if (registry === "certificate") {
      const data = await certContract.verifyCertificate(hash);
      if (!data.exists) {
        result.innerHTML = notFound();
        return;
      }
      rows = [
        ["Exists", "Yes"],
        ["Certificate ID", data.certificateId.toString()],
        ["IPFS CID", data.ipfsCid || "—"],
        ["Recipient Hash", data.recipientHash],
        ["Version", `v${data.version}`],
        ["Timestamp", fmtTime(Number(data.timestamp))],
        ["Revoked", data.revoked ? "Yes" : "No"],
      ]
        .map((kv) => resultRow(kv[0], kv[1]))
        .join("");
    } else if (registry === "entity") {
      const data = await entityContract.verifyEntity(hash);
      if (!data.exists) {
        result.innerHTML = notFound();
        return;
      }
      rows = [
        ["Exists", "Yes"],
        [
          "Entity Type",
          ENTITY_TYPE[Number(data.entityType)] ?? data.entityType,
        ],
        ["Entity ID", data.entityId.toString()],
        ["Version", `v${data.version}`],
        ["Timestamp", fmtTime(Number(data.timestamp))],
      ]
        .map((kv) => resultRow(kv[0], kv[1]))
        .join("");
    } else {
      const data = await attachContract.verifyAttachment(hash);
      if (!data.exists) {
        result.innerHTML = notFound();
        return;
      }
      rows = [
        ["Exists", "Yes"],
        [
          "Entity Type",
          ENTITY_TYPE[Number(data.entityType)] ?? data.entityType,
        ],
        ["Entity ID", data.entityId.toString()],
        [
          "Attachment Type",
          ATTACH_TYPE[Number(data.attachmentType)] ?? data.attachmentType,
        ],
        ["Version", `v${data.version}`],
        ["Timestamp", fmtTime(Number(data.timestamp))],
      ]
        .map((kv) => resultRow(kv[0], kv[1]))
        .join("");
    }

    result.innerHTML = `<div class="result-card success">${rows}</div>`;
  } catch (err) {
    result.innerHTML = `<div class="result-card error"><div class="result-row"><span class="result-key">Error</span><span class="result-value">${err.message}</span></div></div>`;
  }
}

function notFound() {
  return `<div class="result-card error"><div class="result-row"><span class="result-key">Result</span><span class="result-value">Not found on-chain.</span></div></div>`;
}
function resultRow(k, v) {
  return `<div class="result-row"><span class="result-key">${k}</span><span class="result-value">${v}</span></div>`;
}

// ── DETAIL MODALS ─────────────────────────────────────────────
function showCertDetail(e) {
  openModal(
    "Certificate Details",
    `
    ${resultRow("Metadata Hash", `${e.metadataHash} <button class="copy-btn" onclick="copy('${e.metadataHash}')">⎘</button>`)}
    ${resultRow("Certificate ID", e.certId)}
    ${resultRow("IPFS CID", e.ipfsCid ? `<a href="https://gateway.pinata.cloud/ipfs/${e.ipfsCid}" target="_blank" style="color:var(--indigo)">${e.ipfsCid}</a>` : "—")}
    ${resultRow("Version", `v${e.version}`)}
    ${resultRow("Timestamp", fmtTime(e.timestamp))}
    ${resultRow("Status", e.revoked ? '<span class="badge badge-revoked">Revoked</span>' : '<span class="badge badge-valid">Valid</span>')}
    ${resultRow("TX Hash", `${e.txHash} <button class="copy-btn" onclick="copy('${e.txHash}')">⎘</button>`)}
    ${resultRow("Block", `#${e.block}`)}
        `,
  );
}

function showEntityDetail(e) {
  openModal(
    "Entity Details",
    `
    ${resultRow("Entity Hash", `${e.entityHash} <button class="copy-btn" onclick="copy('${e.entityHash}')">⎘</button>`)}
    ${resultRow("Entity Type", ENTITY_TYPE[e.entityType] ?? e.entityType)}
    ${resultRow("Entity ID", e.entityId)}
    ${resultRow("Version", `v${e.version}`)}
    ${resultRow("Timestamp", fmtTime(e.timestamp))}
    ${resultRow("TX Hash", `${e.txHash} <button class="copy-btn" onclick="copy('${e.txHash}')">⎘</button>`)}
    ${resultRow("Block", `#${e.block}`)}
        `,
  );
}

function showAttachDetail(e) {
  openModal(
    "Attachment Details",
    `
    ${resultRow("File Hash", `${e.fileHash} <button class="copy-btn" onclick="copy('${e.fileHash}')">⎘</button>`)}
    ${resultRow("Entity Type", ENTITY_TYPE[e.entityType] ?? e.entityType)}
    ${resultRow("Entity ID", e.entityId)}
    ${resultRow("Attachment Type", ATTACH_TYPE[e.attachmentType] ?? e.attachmentType)}
    ${resultRow("Version", `v${e.version}`)}
    ${resultRow("Timestamp", fmtTime(e.timestamp))}
    ${resultRow("TX Hash", `${e.txHash} <button class="copy-btn" onclick="copy('${e.txHash}')">⎘</button>`)}
    ${resultRow("Block", `#${e.block}`)}
        `,
  );
}

function openModal(title, bodyHtml) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML =
    `<div class="result-card">${bodyHtml}</div>`;
  document.getElementById("modalOverlay").classList.add("open");
}
function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}

// ── TABS ──────────────────────────────────────────────────────
function switchTab(name, btn) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(`tab-${name}`).classList.add("active");
}

// ── HELPERS ───────────────────────────────────────────────────
function setStatus(state, text) {
  const dot = document.getElementById("statusDot");
  const span = document.getElementById("statusText");
  dot.className = `status-dot ${state}`;
  span.textContent = text;
}

function showLoader() {
  ["certTableWrap", "entityTableWrap", "attachTableWrap"].forEach((id) => {
    document.getElementById(id).innerHTML =
      `<div class="loading-wrap"><div class="spinner"></div> Loading events…</div>`;
  });
}

function short(str, n = 18) {
  if (!str || str.length <= n + 6) return str;
  return str.slice(0, n) + "…" + str.slice(-4);
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied!", "success");
  } catch {
    showToast("Copy failed", "error");
  }
}

let toastTimer;
function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast${type ? " " + type : ""} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
