"use strict";
/* やねうら王 (WebAssembly) を Web Worker 内で動かし、USIを中継する。
   評価関数ファイル（つようら王11mini: nn.bin / progress.bin）は
   エンジンの仮想ファイルシステムへ書き込んでから isready する。
   v4: 起動の各段階をページへログ送信し、失敗箇所を特定できるようにした。 */
let mod = null;
let waiters = [];

function log(step) {
  try { self.postMessage({ type: "log", step }); } catch {}
}
function fail(stage, err) {
  const detail = err && (err.stack || err.message) ? String(err.stack || err.message) : String(err);
  try { self.postMessage({ type: "error", message: stage + ": " + detail.slice(0, 600) }); } catch {}
}

self.addEventListener("error", (e) => {
  log("global-error: " + (e.message || "不明") + " @ " + (e.filename || "") + ":" + (e.lineno || ""));
});
self.addEventListener("unhandledrejection", (e) => {
  log("unhandledrejection: " + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 400));
});

function checkWaiters(line) {
  const done = waiters.filter(w => line.startsWith(w.prefix));
  waiters = waiters.filter(w => !line.startsWith(w.prefix));
  for (const w of done) w.resolve(line);
}
function waitFor(prefix, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(prefix + " が " + timeoutMs + "ms 以内に返りませんでした")), timeoutMs);
    waiters.push({ prefix, resolve: (v) => { clearTimeout(t); resolve(v); } });
  });
}

async function init() {
  log("w0: worker起動。分離=" + self.crossOriginIsolated + " / SAB=" + (typeof SharedArrayBuffer !== "undefined"));
  try { importScripts("engine/yaneuraou.js"); }
  catch (e) { fail("w1 importScripts", e); return; }
  log("w1: エンジン本体JS 読込OK（factory型=" + typeof YaneuraOu_TsuyouMini + "）");

  let nnBuf, progBuf;
  try {
    [nnBuf, progBuf] = await Promise.all([
      fetch("engine/eval/nn.bin").then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }),
      fetch("engine/eval/progress.bin").then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }),
    ]);
  } catch (e) { fail("w2 評価関数fetch", e); return; }
  log("w2: 評価関数 取得OK（nn=" + nnBuf.byteLength + "B / progress=" + progBuf.byteLength + "B）");

  try {
    mod = await YaneuraOu_TsuyouMini({
      locateFile: (path) => "engine/" + path,
      // 探索スレッド（pthread）側が読み直す本体スクリプトは、既定では
      // このラッパー自身のURLになってしまい起動に失敗する。実体を明示する。
      mainScriptUrlOrBlob: new URL("engine/yaneuraou.js", self.location.href).href,
      print: (line) => log("engine-out: " + line),
      printErr: (line) => log("engine-err: " + line),
      onAbort: (what) => log("engine-abort: " + String(what).slice(0, 300)),
    });
  } catch (e) { fail("w3 エンジン初期化", e); return; }
  log("w3: エンジン初期化OK");

  try {
    mod.FS.writeFile("/nn.bin", new Uint8Array(nnBuf));
    mod.FS.writeFile("/progress.bin", new Uint8Array(progBuf));
    mod.addMessageListener(line => {
      checkWaiters(line);
      self.postMessage({ type: "line", line });
    });
  } catch (e) { fail("w4 仮想FS書込", e); return; }
  log("w4: 仮想FSへ評価関数を配置OK");

  try {
    mod.postMessage("usi");
    await waitFor("usiok", 20000);
    log("w5: usiok 受信");
    mod.postMessage("setoption name EvalDir value .");
    mod.postMessage("setoption name EvalFile value nn.bin");
    mod.postMessage("setoption name Threads value 2");
    mod.postMessage("setoption name USI_Hash value 128");
    mod.postMessage("setoption name BookFile value no_book");
    mod.postMessage("isready");
    await waitFor("readyok", 30000);
  } catch (e) { fail("w5 USIハンドシェイク", e); return; }
  log("w6: readyok 受信");
  self.postMessage({ type: "ready" });
}

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === "init") {
    try { await init(); }
    catch (err) { fail("init全般", err); }
  } else if (d.type === "command") {
    if (mod) mod.postMessage(d.line);
  }
};
log("w-1: workerスクリプト評価完了");
