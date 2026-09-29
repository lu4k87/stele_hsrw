// Video-Folie: stumm außer „sound“; play_to_end → Video bestimmt die Dauer, sonst feste Dauer
// (kürzeres Video läuft in Schleife). Hänger-Erkennung und Rückfall auf stumm, falls Autoplay mit Ton blockiert.

import { h, waitForEvent, clamp } from '../util.js';
import { TIMING } from '../config.js';
import { baseView, durationMs, shortUrl } from './common.js';

export function createVideo({ src, poster, muted, volume }) {
  const video = document.createElement('video');
  video.className = 'media';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('disableremoteplayback', '');
  video.preload = 'auto';
  video.muted = muted;
  video.defaultMuted = muted;
  video.volume = clamp(Number.isFinite(volume) ? volume : 0.8, 0, 1);
  if (poster) video.poster = poster;
  video.dataset.src = src;
  return video;
}

// Laden bis „canplay“ (8 s); danach genügt ein erstes Bild (readyState ≥ 2).
export async function loadVideo(video, src) {
  video.src = src;
  video.load();
  try {
    await waitForEvent(video, ['canplay'], ['error'], TIMING.videoTimeoutMs, 'Video lädt zu lange');
  } catch (err) {
    if (video.error || video.readyState < 2) {
      throw new Error(`Video konnte nicht geladen werden (${shortUrl(src)})`);
    }
  }
}

// play() mit Rückfall: Ton blockiert → stumm erneut versuchen. AbortError (Element entfernt) ignorieren.
export async function playVideo(video) {
  try {
    await video.play();
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
    if (!video.muted) {
      video.muted = true;
      try { await video.play(); return true; } catch (err2) { if (err2 && err2.name === 'AbortError') return false; throw err2; }
    }
    throw err;
  }
}

export function releaseVideo(video) {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch { /* egal */ }
}

export function createVideoSlide(slide, ctx) {
  const wantSound = Boolean(slide.sound ?? ctx.settings.video_sound) && !ctx.muted;
  const playToEnd = Boolean(slide.play_to_end ?? ctx.settings.video_play_to_end);
  const video = createVideo({ src: slide.src, poster: slide.poster, muted: !wantSound, volume: ctx.volume });
  const el = h('div', { class: 'sv sv-video', style: { background: ctx.settings.background } }, video);
  const view = baseView(el);
  view.plannedMs = durationMs(slide, ctx.settings);
  let stallTimer = null;
  let lastTime = -1;
  let stalledMs = 0;
  let failed = false;

  const fail = (message) => {
    if (failed) return;
    failed = true;
    stopStallWatch();
    if (view.onError) view.onError(message);
  };

  function startStallWatch() {
    stopStallWatch();
    lastTime = video.currentTime;
    stalledMs = 0;
    stallTimer = setInterval(() => {
      if (video.paused || video.ended) { stalledMs = 0; return; }
      if (video.currentTime === lastTime) stalledMs += 2000; else stalledMs = 0;
      lastTime = video.currentTime;
      if (stalledMs >= 12_000) fail('Video hängt (keine Wiedergabe seit 12 s)');
    }, 2000);
  }
  function stopStallWatch() {
    if (stallTimer) clearInterval(stallTimer);
    stallTimer = null;
  }

  const play = () => {
    playVideo(video).then((ok) => { if (ok) startStallWatch(); })
      .catch((err) => fail(`Video kann nicht abgespielt werden (${err && err.name ? err.name : 'Fehler'})`));
  };

  video.addEventListener('ended', () => { if (view.selfTimed && view.onEnd) view.onEnd(); });
  video.addEventListener('error', () => { if (video.getAttribute('src')) fail('Videofehler beim Abspielen'); });

  view.load = async () => {
    await loadVideo(video, slide.src);
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Number(slide.video_duration_s) || 0;
    if (playToEnd && dur > 0) {
      view.selfTimed = true;
      view.plannedMs = dur * 1000;
      video.loop = false;
    } else {
      view.selfTimed = false;
      video.loop = true; // kürzeres Video wiederholt sich bis zum Ende der Foliendauer
    }
    // Ohne ausdrückliche Vorgabe: füllen, wenn das Seitenverhältnis nahe an der Fläche liegt, sonst einpassen.
    let fit = slide.fit;
    if (fit !== 'cover' && fit !== 'contain') {
      const va = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 0;
      const aa = ctx.area && ctx.area.h ? ctx.area.w / ctx.area.h : 0;
      fit = va && aa && Math.abs(Math.log(va / aa)) < Math.log(1.2) ? 'cover' : 'contain';
    }
    video.classList.add(`fit-${fit}`);
  };
  view.start = play;
  view.pause = () => { stopStallWatch(); video.pause(); };
  view.resume = play;
  view.restart = () => { try { video.currentTime = 0; } catch { /* egal */ } play(); };
  view.destroy = () => {
    stopStallWatch();
    releaseVideo(video);
    el.remove();
  };
  return view;
}
