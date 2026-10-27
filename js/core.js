/*
 * core.js
 * Shared helpers and the single animation loop that drives every scroll effect.
 *
 * Other scripts plug in through two hooks:
 *   Site.onMeasure(measureFunction, order)
 *       Runs on load, on a real resize, and on web font update.
 *       A lower "order" runs first: Scripts that change the layout run before scripts that read positions.
 *   Site.onFrame(frameFunction)
 *       Runs every frame as frameFunction(now, framesElapsed).
 * Functions with the same order are listed in index.html.
 */
window.Site = (function () {
  "use strict";

  // Desktop and trackpad: how quickly the smoothed scroll position catches up to the real one (0 to 1; higher = snappier).
  const SCROLL_SMOOTHING = 0.16;

  // After the page loads, a link like petergeis.com/#off-the-clock is re-aligned for this many milliseconds,
  // because sections above it finish sizing themselves after the browser first jumps there.
  const HASH_SETTLE_DURATION = 1500;

  // In-page links to sections farther away than this many screens (the top bar, the On the clock / Off the clock
  // panels) jump straight there behind a quick fade, instead of smooth-scrolling through everything in between,
  // which would play the field photo map tour, the build photo zoom, and the rest along the way.
  const LONG_JUMP = {
    screens: 1.5,
    fadeTime: 170   // milliseconds; matches the fade in css/base.css
  };

  // The landing screen waits for the web font before it appears, so the name never visibly resizes.
  // On a slow connection it stops waiting after this many milliseconds and uses the fallback font.
  const FONT_WAIT_LIMIT = 2500;

  const root = document.documentElement;
  const measureSteps = [];
  const frameSteps = [];

  // Touch screens already scroll with native momentum. Smoothing it a second time makes effects driven by
  // script lag behind the native layers, so phones and tablets follow the real scroll position exactly.
  const isTouchScreen = window.matchMedia("(pointer: coarse)").matches;

  // An invisible element as tall as the "small viewport" (100svh). Unlike window.innerHeight, it does not
  // change when a phone's address bar slides in and out, so layout measurements stay stable while scrolling.
  const viewportProbe = document.createElement("div");
  viewportProbe.setAttribute("aria-hidden", "true");
  viewportProbe.style.cssText = "position:fixed;left:0;top:0;width:1px;height:100svh;visibility:hidden;pointer-events:none;";
  document.body.appendChild(viewportProbe);

  function readViewportHeight() {
    const probeHeight = viewportProbe.offsetHeight;
    return probeHeight > 0 ? probeHeight : window.innerHeight;
  }

  const Site = {
    // False when the visitor's device asks for reduced motion (set by the small script in <head>).
    motionEnabled: root.classList.contains("motion-enabled"),

    // Viewport size, refreshed before every measure pass. The height is the small viewport height (see above).
    viewportHeight: readViewportHeight(),
    viewportWidth: window.innerWidth,

    // Smoothed scroll position, and how far it moved since the last frame.
    scrollY: window.scrollY,
    velocity: 0,

    // Scroll-pause frames, filled in by js/scroll-pause.js:
    pauseFrames: {},
    measureCount: 0,

    clamp(value, minimum, maximum) {
      return value < minimum ? minimum : value > maximum ? maximum : value;
    },

    // Ease-out curve used by the photo zoom and the loader. A higher exponent gives a longer, softer finish.
    easeOut(progress) {
      return 1 - Math.pow(1 - progress, 2);
    },

    // Distance from the top of the page to an element. Only trust this inside a measure pass:
    // (see html.is-measuring in css/scroll-pause.css).
    documentTop(element) {
      return element.getBoundingClientRect().top + window.scrollY;
    },

    onMeasure(measureFunction, order) {
      measureSteps.push({
        run: measureFunction,
        order: order === undefined ? 50 : order,
        registrationIndex: measureSteps.length
      });
      measureSteps.sort((first, second) => {
        return first.order - second.order || first.registrationIndex - second.registrationIndex;
      });
    },

    onFrame(frameFunction) {
      frameSteps.push(frameFunction);
    },

    // Resolves once the display font has loaded (or after FONT_WAIT_LIMIT), so text can be measured for good.
    fontsReady: new Promise((resolve) => {
      if (!document.fonts || !document.fonts.load) {
        resolve();
        return;
      }
      const giveUp = setTimeout(resolve, FONT_WAIT_LIMIT);
      document.fonts.load("800 100px Epilogue")
        .then(() => document.fonts.ready)
        .then(() => { clearTimeout(giveUp); resolve(); }, () => { clearTimeout(giveUp); resolve(); });
    }),

    // Runs a layout pass right away instead of on the next frame.
    measureNow() {
      measureLayout();
    }
  };

  let lastMeasuredWidth = Site.viewportWidth;
  let lastMeasuredHeight = Site.viewportHeight;

  // Runs every animation once, so the first frame painted after a layout is up to date.
  function runEveryFrameFunctionOnce() {
    const now = performance.now();
    for (const frameStep of frameSteps) {
      frameStep(now, 0);
    }
  }

  // A layout pass briefly puts pinned frames back in place, which can make the browser nudge the scroll anchoring
  //  or clamp it near the bottom of the page. So each pass notes which top-level block of the page
  // the visitor is in and how far into it, and puts them back exactly there afterward.
  const pageBlocks = Array.from(document.querySelectorAll("main > *, body > footer"));

  function rememberScrollPlace() {
    const scrollTop = window.scrollY;
    if (scrollTop <= 0) {
      return null;
    }
    let currentBlock = null;
    for (const block of pageBlocks) {
      if (block.getBoundingClientRect().top <= 1) {
        currentBlock = block;
      }
    }
    return currentBlock ? { block: currentBlock, offset: -currentBlock.getBoundingClientRect().top } : null;
  }

  function returnToScrollPlace(place) {
    if (!place) {
      return;
    }
    const goal = Math.round(place.block.getBoundingClientRect().top + window.scrollY + place.offset);
    if (Math.abs(window.scrollY - goal) > 1) {
      window.scrollTo({ top: goal, behavior: "instant" });
      Site.scrollY = window.scrollY;
    }
  }

  function measureLayout() {
    Site.viewportHeight = readViewportHeight();
    Site.viewportWidth = window.innerWidth;
    lastMeasuredWidth = Site.viewportWidth;
    lastMeasuredHeight = Site.viewportHeight;

    const scrollPlace = rememberScrollPlace();
    root.classList.add("is-measuring");
    for (const measureStep of measureSteps) {
      measureStep.run();
    }
    root.classList.remove("is-measuring");
    returnToScrollPlace(scrollPlace);

    Site.measureCount++;
    runEveryFrameFunctionOnce();
  }

  // Links such as /#off-the-clock: sections above the target change height while the page settles,
  // jump to the target again until the visitor takes over with the wheel, a touch, or a key.
  let isSettling = true;
  let visitorHasInteracted = false;
  ["wheel", "touchstart", "keydown", "pointerdown"].forEach((eventName) => {
    window.addEventListener(eventName, () => { visitorHasInteracted = true; }, { passive: true, once: true });
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest ? event.target.closest('a[href^="#"]') : null;
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const id = decodeURIComponent(link.getAttribute("href").slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target || !Site.motionEnabled) {
      return;
    }
    if (Math.abs(target.getBoundingClientRect().top) < Site.viewportHeight * LONG_JUMP.screens) {
      return;   // nearby: the smooth scroll is fine
    }
    event.preventDefault();
    root.classList.add("is-jumping");
    setTimeout(() => {
      if (location.hash !== "#" + id) {
        history.pushState(null, "", "#" + id);
      }
      root.style.scrollBehavior = "auto";
      target.scrollIntoView({ behavior: "instant", block: "start" });
      root.style.scrollBehavior = "";
      Site.scrollY = window.scrollY;   // and no smoothing through the sections in between
      requestAnimationFrame(() => { root.classList.remove("is-jumping"); });
    }, LONG_JUMP.fadeTime);
  });

  function realignToLinkTarget() {
    if (!isSettling || visitorHasInteracted || location.hash.length < 2) {
      return;
    }
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) {
      target.scrollIntoView({ behavior: "instant", block: "start" });
      Site.scrollY = window.scrollY;
    }
  }

  let measureIsScheduled = 0;
  function scheduleMeasure() {
    if (measureIsScheduled) {
      return;
    }
    measureIsScheduled = requestAnimationFrame(() => {
      measureIsScheduled = 0;
      measureLayout();
      realignToLinkTarget();
    });
  }

  // Phones resize while the address bar slides in and out. Layout only uses the width and the small
  // viewport height, so a resize is ignored instead of redoing every measurement mid-scroll.
  function handleResize() {
    if (window.innerWidth === lastMeasuredWidth && readViewportHeight() === lastMeasuredHeight) {
      return;
    }
    scheduleMeasure();
  }

  let lastFrameTime = performance.now();
  function animationLoop(now) {
    const framesElapsed = Math.min(3, (now - lastFrameTime) / 16.667);   // 1 = one 60 Hz frame
    lastFrameTime = now;

    const nativeScrollY = window.scrollY;
    const previousScrollY = Site.scrollY;
    const shouldSmooth = Site.motionEnabled && !isTouchScreen;
    Site.scrollY = shouldSmooth
      ? previousScrollY + (nativeScrollY - previousScrollY) * Math.min(1, SCROLL_SMOOTHING * framesElapsed)
      : nativeScrollY;
    if (Math.abs(nativeScrollY - Site.scrollY) < 0.05) {
      Site.scrollY = nativeScrollY;
    }
    Site.velocity = Site.scrollY - previousScrollY;

    for (const frameStep of frameSteps) {
      frameStep(now, framesElapsed);
    }
    requestAnimationFrame(animationLoop);
  }

  // Deferred scripts all run before DOMContentLoaded, so every hook is registered by now.
  document.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("resize", handleResize);
    window.addEventListener("load", () => {
      scheduleMeasure();
      setTimeout(() => { isSettling = false; }, HASH_SETTLE_DURATION);
    });
    if (document.fonts) {
      // The web font arrives after the first measurement.
      document.fonts.ready.then(scheduleMeasure);
      document.fonts.addEventListener("loadingdone", scheduleMeasure);
    }
    measureLayout();
    requestAnimationFrame(animationLoop);
  });

  /* ---------- Pausing animations ----------
     The pause button in the top bar stops everything that moves on its own: Scroll-driven effects keep
     working. The choice is remembered for the next visit. With reduced, the button is hidden in css/base.css */
  const PAUSE_KEY = "animations-paused";
  const pauseListeners = [];
  let pausedAt = 0;
  let pausedTotal = 0;

  Site.animationsPaused = false;

  // A clock for animations that stops while they're paused and picks up where it left off.
  Site.animationNow = (now) => (Site.animationsPaused ? pausedAt : now) - pausedTotal;

  // Calls listener(isPaused) whenever the visitor pauses or resumes.
  Site.onPauseChange = (listener) => { pauseListeners.push(listener); };

  Site.setAnimationsPaused = (isPaused) => {
    if (isPaused === Site.animationsPaused) {
      return;
    }
    const now = performance.now();
    if (isPaused) {
      pausedAt = now;
    } else {
      pausedTotal += now - pausedAt;
    }
    Site.animationsPaused = isPaused;
    root.classList.toggle("is-animation-paused", isPaused);
    try {
      localStorage.setItem(PAUSE_KEY, String(isPaused));
    } catch (error) {
      // storage blocked: the choice just lasts for this visit
    }
    pauseListeners.forEach((listener) => listener(isPaused));
  };

  try {
    if (Site.motionEnabled && localStorage.getItem(PAUSE_KEY) === "true") {
      Site.animationsPaused = true;
      pausedAt = performance.now();
      root.classList.add("is-animation-paused");
    }
  } catch (error) {
    // storage blocked: start playing
  }

  const pauseToggles = Array.from(document.querySelectorAll(".motion-toggle"));
  function showPauseState() {
    const label = Site.animationsPaused ? "Play animations" : "Pause animations";
    pauseToggles.forEach((toggle) => {
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    });
  }
  pauseToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => { Site.setAnimationsPaused(!Site.animationsPaused); });
  });
  Site.onPauseChange(showPauseState);
  showPauseState();

  return Site;
})();
