"use strict";
(() => {
  const panel = document.querySelector("[data-recorder]");
  if (!panel) return;
  const record = panel.querySelector("[data-record]");
  const stop = panel.querySelector("[data-stop]");
  const download = panel.querySelector("[data-download]");
  const preview = panel.querySelector("[data-preview]");
  const status = panel.querySelector("[data-status]");
  const timer = panel.querySelector("[data-timer]");
  let recorder, stream, url, interval, started, downloaded = true, pending = false;
  function release() {
    clearInterval(interval);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  }
  function resetPreview() {
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    preview.hidden = true;
    download.hidden = true;
    download.removeAttribute("href");
    if (url) URL.revokeObjectURL(url);
    url = null;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    record.disabled = true;
    status.textContent = "Recording is unavailable in this browser. Try a current browser over HTTPS, or use Voice Memos.";
    return;
  }
  record.addEventListener("click", async () => {
    pending = true;
    record.disabled = true;
    status.textContent = "Allow microphone access to start recording.";
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"]
        .find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mime ? {mimeType: mime} : {});
      const chunks = [];
      recorder.addEventListener("dataavailable", event => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        status.textContent = "Recording failed. Try again or use Voice Memos.";
        release();
        record.disabled = false;
        stop.disabled = true;
        pending = false;
      });
      recorder.addEventListener("stop", () => {
        const type = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const blob = new Blob(chunks, {type});
        release();
        record.disabled = false;
        record.textContent = "Record again";
        stop.disabled = true;
        pending = false;
        if (!blob.size) {
          status.textContent = "No audio was captured. Check your microphone and try again.";
          return;
        }
        url = URL.createObjectURL(blob);
        preview.src = url;
        preview.hidden = false;
        download.href = url;
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        download.download = panel.dataset.recorder + "." + extension;
        download.hidden = false;
        downloaded = false;
        status.textContent = "Listen back, then download " + download.download + " before leaving. It stays local until you add it to the website.";
      });
      resetPreview();
      downloaded = true;
      recorder.start();
      pending = false;
      started = Date.now();
      timer.textContent = "00:00";
      interval = setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        timer.textContent = String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
      }, 250);
      stop.disabled = false;
      status.textContent = "Recording… Press Stop when finished.";
    } catch (error) {
      release();
      pending = false;
      record.disabled = false;
      stop.disabled = true;
      status.textContent = error.name === "NotAllowedError"
        ? "Microphone permission was declined. Allow it in your browser's site settings, or use Voice Memos."
        : "Could not start recording. Check your microphone and try again.";
    }
  });
  stop.addEventListener("click", () => {
    if (recorder?.state === "recording") {
      stop.disabled = true;
      recorder.stop();
    }
  });
  download.addEventListener("click", () => {
    downloaded = true;
    status.textContent = "Check your Downloads folder for " + download.download + ". Add it to the narration folder to publish it.";
  });
  window.addEventListener("beforeunload", event => {
    if (pending || recorder?.state === "recording" || !downloaded) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    release();
    if (url) URL.revokeObjectURL(url);
  });
})();
