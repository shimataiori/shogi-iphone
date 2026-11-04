"use strict";
/* やねうら王 (WebAssembly) を Web Worker 内で動かし、USIを中継する。
   評価関数ファイル（つようら王11mini: nn.bin / progress.bin）は
   エンジンの仮想ファイルシステムへ書き込んでから isready する。 */
let mod = null;
let waiters = [];

// 捕捉できない形で落ちた場合も、理由をページ側へ伝える（診断用）
self.addEventListener("error", (e) => {
  try { self.postMessage({ type: "error", message: "Worker内エラー: " + (e.message || "不明") }); } catch {}
});
self.addEventListener("unhandledrejection", (e) => {
  try { self.postMessage({ type: "error", message: "Worker内エラー: " + String((e.reason && e.reason.message) || e.reason) }); } catch {}
});

function checkWaiters(line) {
  const done = waiters.filter(w => line.startsWith(w.prefix));
  waiters = waiters.filter(w => !line.startsWith(w.prefix));
  for (const w of done) w.resolve(line);
}
function waitFor(prefix) {
  return new Promise(resolve => waiters.push({ prefix, resolve }));
}

async function init() {
  importScripts("engine/yaneuraou.js");
  const [nnBuf, progBuf] = await Promise.all([
    fetch("engine/eval/nn.bin").then(r => { if (!r.ok) throw new Error("nn.bin を取得できません"); return r.arrayBuffer(); }),
    fetch("engine/eval/progress.bin").then(r => { if (!r.ok) throw new Error("progress.bin を取得できません"); return r.arrayBuffer(); }),
  ]);
  mod = await YaneuraOu_TsuyouMini({
    locateFile: (path) => "engine/" + path,
    // 探索スレッド（pthread）側が読み直す本体スクリプトは、既定では
    // このラッパー自身のURLになってしまい起動に失敗する。実体を明示する。
    mainScriptUrlOrBlob: new URL("engine/yaneuraou.js", self.location.href).href,
  });
  mod.FS.writeFile("/nn.bin", new Uint8Array(nnBuf));
  mod.FS.writeFile("/progress.bin", new Uint8Array(progBuf));
  mod.addMessageListener(line => {
    checkWaiters(line);
    self.postMessage({ type: "line", line });
  });
  mod.postMessage("usi");
  await waitFor("usiok");
  mod.postMessage("setoption name EvalDir value .");
  mod.postMessage("setoption name EvalFile value nn.bin");
  mod.postMessage("setoption name Threads value 2");
  mod.postMessage("setoption name USI_Hash value 128");
  mod.postMessage("setoption name BookFile value no_book");
  mod.postMessage("isready");
  await waitFor("readyok");
  self.postMessage({ type: "ready" });
}

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === "init") {
    try { await init(); }
    catch (err) { self.postMessage({ type: "error", message: String(err && err.message || err) }); }
  } else if (d.type === "command") {
    if (mod) mod.postMessage(d.line);
  }
};
