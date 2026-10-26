/*
 * hero.js
 * The landing screen: the loader counter, sizing the giant name to fit the screen,
 * the lavender text reveal that follows the cursor, and the ASCII radar's pulses.
 */
(function (Site) {
  "use strict";
  const { clamp, easeOut, motionEnabled } = Site;
  const root = document.documentElement;

  /* ---------- Settings you can tweak ---------- */

  const RADAR = {
    pulseSpeed: 8,       // how fast a pulse (and its echo) travels, in pixels per millisecond
    pulseLength: 44,      // length of each pulse, in pixels
    // Which character of the ASCII drawing the beam leaves
    emitterLine: 7,
    emitterColumn: 35
  };

  const CURSOR_REVEAL = {
    radiusAsFractionOfWidth: 0.1,   // circle radius as a fraction of the screen width
    minimumRadius: 96,
    maximumRadius: 170,
    idleSpotlight: 0.55             // while idle, a smaller circle roams with the scan
  };

  // Each pulse that reaches the target sends out a wave and opens a soft circle onto the build photo behind the
  // landing screen, which then dissolves to black. 
  const PHOTO_PULSE = {
    openTime: 100,        // milliseconds for the circle to open after the pulse hits
    holdTime: 240,        // how long it stays fully open
    fadeTime: 100,        // milliseconds for it to dissolve to black (it stays full size while it fades)
    pauseTime: 0,        // pause before the next pulse fires
    waveSize: 1.15,       // how far the wave spreads, as a multiple of the circle's radius
    // How long the wave ring takes to spread and fade: as long as the circle is showing, so it always finishes
    // before the next pulse.
    get waveTime() {
      return this.openTime + this.holdTime + this.fadeTime;
    }
  };

  const LOADER_COUNT_DURATION = 1350;   // milliseconds the "°C Liquid" counter takes to reach 30
  const LOADER_MINIMUM_TIME = 1500;     // the loader shows at least this long on a first visit

  /* ---------- Loader counter (first visit per session only) ---------- */

  const loaderNumber = document.getElementById("loader-number");
  if (motionEnabled && !root.classList.contains("loader-seen")) {
    const loaderStartTime = performance.now();
    const countUp = (now) => {
      const progress = clamp((now - loaderStartTime) / LOADER_COUNT_DURATION, 0, 1);
      loaderNumber.textContent = String(Math.round(18 + 12 * easeOut(progress)));
      if (progress < 1) {
        requestAnimationFrame(countUp);
      }
    };
    requestAnimationFrame(countUp);
    document.querySelector(".loader").addEventListener("click", () => { root.classList.add("loader-seen"); });
  }

  /* ---------- Show the landing screen once its layout is final ---------- */

  // Waits for Site.fontsReady, lays the page out, then lets the loader leave and the
  // letters rise. Nothing on the landing screen is visible before this, so nothing jumps or resizes.
  const loaderIsShowing = motionEnabled && !root.classList.contains("loader-seen");
  const pageStartTime = performance.now();
  Site.fontsReady.then(() => {
    const waitForLoader = loaderIsShowing ? Math.max(0, LOADER_MINIMUM_TIME - (performance.now() - pageStartTime)) : 0;
    setTimeout(() => {
      Site.measureNow();
      root.classList.add("is-hero-ready");
    }, waitForLoader);
  });

  /* ---------- Fit the name to the screen ---------- */

  const heroElement = document.querySelector(".hero");
  const heroMeta = heroElement.querySelector(".hero-meta");
  const heroName = heroElement.querySelector(".hero-name");
  const nameLines = heroName.querySelectorAll(".name-line-text"); 
  const radar = document.getElementById("radar");

  // Sizes the name as large as possible without overflowing the width or the screen height.
  function fitNameToScreen() {
    heroName.style.fontSize = "100px";
    const widestLineWidth = Math.max(nameLines[0].getBoundingClientRect().width, nameLines[1].getBoundingClientRect().width);
    const heroStyle = getComputedStyle(heroElement);
    const availableWidth = heroElement.clientWidth - parseFloat(heroStyle.paddingLeft) - parseFloat(heroStyle.paddingRight);
    let availableHeight = Site.viewportHeight - parseFloat(heroStyle.paddingTop) - parseFloat(heroStyle.paddingBottom)
      - heroMeta.offsetHeight - parseFloat(getComputedStyle(heroName).marginBottom) - 8;
    if (heroElement.classList.contains("has-radar-in-flow")) {
      availableHeight -= radar.offsetHeight + 14;
    }
    const fontSize = Math.min(100 * availableWidth / widestLineWidth, 100 * availableHeight / heroName.offsetHeight);
    heroName.style.fontSize = Math.max(40, fontSize) + "px";

    // The lavender copy of the name (the cursor reveal) must stay exactly the same size.
    const revealName = document.querySelector(".hero-reveal .hero-name");
    if (revealName) {
      revealName.style.fontSize = heroName.style.fontSize;
    }
  }

  /* ---------- Cursor reveal and radar ---------- */

  const heroReveal = document.getElementById("hero-reveal");               // the lavender copy of the name, clipped to a circle
  const radarReadout = document.getElementById("radar-readout");           // "TRACK RANGE 642 PIXELS"
  const radarArt = radar.querySelector(".radar-art");
  const radarBeams = document.getElementById("radar-beams");               // track line and pulses
  const radarTargetLayer = document.getElementById("radar-target-layer");  // target box and label
  const beamTrack = radarBeams.querySelector(".beam-track");
  const pulseOut = radarBeams.querySelector(".beam-pulse-out");
  const pulseReturn = radarBeams.querySelector(".beam-pulse-return");
  const targetPing = radarTargetLayer.querySelector(".target-ping");
  const target = radarTargetLayer.querySelector(".target");
  const targetLabel = radarTargetLayer.querySelector(".target-label");
  
  // Remove the first endline in the Radar 
  radarArt.textContent = radarArt.textContent.slice(1);

  // The ASCII drawing's size is read from the text itself, so you can redraw it freely (spaces only, no tabs).
  const artLines = radarArt.textContent.split("\n");
  if (artLines[artLines.length - 1] === "") {
    artLines.pop();
  }
  const ART_ROW_COUNT = artLines.length;
  const ART_COLUMN_COUNT = Math.max(...artLines.map((line) => line.length));
  radar.style.width = ART_COLUMN_COUNT + "ch";
  radarArt.style.width = ART_COLUMN_COUNT + "ch";

  // Build the reveal layer: an identical copy of the name and role line, plus a spacer used on phones.
  [heroName, heroMeta].forEach((original) => {
    const copy = original.cloneNode(true);
    copy.removeAttribute("id");
    copy.removeAttribute("aria-label");
    heroReveal.appendChild(copy);
  });
  const revealSpacer = document.createElement("div");
  revealSpacer.className = "hero-reveal-spacer";
  heroReveal.insertBefore(revealSpacer, heroReveal.lastChild);
  heroElement.insertBefore(radar, heroMeta);   // lets the radar join the layout above the rule on phones

  let heroWidth = 1;
  let heroHeight = 1;
  let emitterX = 0;                  // where the beam starts
  let emitterY = 0;
  let targetX = 0;                   // where the target should be
  let targetY = 0;
  let currentX = 0;                  // where it is now
  let currentY = 0;
  let revealRadius = 0;              
  let revealRadiusGoal = 0;
  let revealRadiusFull = 150;
  let mode = "scan";                 // "scan" (idle), "track" (cursor), or "lock" (finger down on phones)
  let frameCount = 0;
  const scanStartTime = performance.now();

  // Places the radar in the bottom left, just above the horizontal rule:
  function placeRadar() {
    radar.style.display = "";
    radarBeams.style.display = "";
    radarTargetLayer.style.display = "";
    heroElement.classList.remove("has-radar-in-flow");
    revealSpacer.style.height = "0px";
    radar.style.left = "";
    radar.style.top = "";
    fitNameToScreen();

    const firstLineBox = nameLines[0].getBoundingClientRect();
    const secondLineBox = nameLines[1].getBoundingClientRect();
    const heroBox = heroElement.getBoundingClientRect();
    const metaBox = heroMeta.getBoundingClientRect();
    const nameFontSize = parseFloat(heroName.style.fontSize) || 100;
    const heroStyle = getComputedStyle(heroElement);
    const paddingLeft = parseFloat(heroStyle.paddingLeft);
    const contentWidth = heroElement.clientWidth - paddingLeft - parseFloat(heroStyle.paddingRight);
    const radarFloor = metaBox.top - heroBox.top - 14;
    const firstLineBottom = firstLineBox.bottom - heroBox.top - nameFontSize * 0.12 + 10;
    const secondLineBottom = secondLineBox.bottom - heroBox.top - nameFontSize * 0.12 + 10;

    const baseFontSize = clamp(Site.viewportWidth * 0.007, 7.5, 12);
    radar.style.fontSize = baseFontSize + "px";
    const widthAtBaseSize = radar.offsetWidth || 1;
    const heightAtBaseSize = radar.offsetHeight || 1;
    const scaleBesideName = Math.min(
      1,
      (secondLineBox.left - heroBox.left - paddingLeft - 28) / widthAtBaseSize,
      (radarFloor - firstLineBottom) / heightAtBaseSize
    );
    const scaleBelowName = Math.min(1, contentWidth / widthAtBaseSize, (radarFloor - secondLineBottom) / heightAtBaseSize);
    const scale = Math.max(scaleBesideName, scaleBelowName);
    let radarFontSize = baseFontSize * scale;

    if (radarFontSize >= 6) {
      radar.style.fontSize = radarFontSize + "px";
      const roomAvailable = scale === scaleBelowName ? radarFloor - secondLineBottom : radarFloor - firstLineBottom;
      if (radar.offsetHeight > roomAvailable) {
        radarFontSize *= 0.92;
        radar.style.fontSize = radarFontSize + "px";
      }
      radar.style.left = paddingLeft + "px";
      radar.style.top = (radarFloor - radar.offsetHeight) + "px";
    } else {
      radarFontSize = Math.min(baseFontSize, baseFontSize * contentWidth / widthAtBaseSize);
      radar.style.fontSize = radarFontSize + "px";
      heroElement.classList.add("has-radar-in-flow");
      fitNameToScreen();
      if (parseFloat(heroName.style.fontSize) < 48) {
        // Too short for both the name and the radar (phones in landscape): hide the radar.
        heroElement.classList.remove("has-radar-in-flow");
        fitNameToScreen();
        radar.style.display = "none";
        radarBeams.style.display = "none";
        radarTargetLayer.style.display = "none";
      } else {
        revealSpacer.style.height = (radar.offsetHeight + 14) + "px";
      }
    }
    radar.classList.add("is-placed");

    const artBox = radarArt.getBoundingClientRect();
    const characterWidth = artBox.width / ART_COLUMN_COUNT;
    const lineHeight = artBox.height / ART_ROW_COUNT;
    emitterX = artBox.left - heroBox.left + characterWidth * (RADAR.emitterColumn - 0.5);
    emitterY = artBox.top - heroBox.top + lineHeight * (RADAR.emitterLine - 0.5);
  }

  function measureHero() {
    heroWidth = heroElement.clientWidth;
    heroHeight = heroElement.clientHeight;
    radarBeams.setAttribute("viewBox", "0 0 " + heroWidth + " " + heroHeight);
    radarTargetLayer.setAttribute("viewBox", "0 0 " + heroWidth + " " + heroHeight);
    revealRadiusFull = clamp(
      Site.viewportWidth * CURSOR_REVEAL.radiusAsFractionOfWidth,
      CURSOR_REVEAL.minimumRadius,
      CURSOR_REVEAL.maximumRadius
    );
    placeRadar();
    if (!currentX && !currentY) {
      currentX = heroWidth * 0.6;
      currentY = heroHeight * 0.3;
    }
    if (mode === "scan") {
      revealRadiusGoal = idleRadius();
    }
    placeRevealPhoto();
  }

  // Where the PC sits in images/room.webp, as fractions of the photo: its center, and its height.
  const PHOTO_SUBJECT = { centerX: 0.465, centerY: 0.575, height: 0.35, fill: 0.8 };
  const revealPhoto = heroReveal.querySelector(".hero-reveal-photo");
  const heroMetaLine = heroElement.querySelector(":scope > .hero-meta");

  // On phones the photo is sized and placed so the PC fills the space between the top bar and the radar; 
  // otherwise the photo simply covers the landing screen.
  function placeRevealPhoto() {
    const heroBox = heroElement.getBoundingClientRect();
    const lineTop = heroMetaLine ? heroMetaLine.getBoundingClientRect().top - heroBox.top : heroBox.height;
    heroReveal.style.clipPath = "inset(0 0 " + Math.max(0, heroBox.height - lineTop).toFixed(1) + "px 0)";
    if (!revealPhoto) {
      return;
    }
    if (!heroElement.classList.contains("has-radar-in-flow")) {
      revealPhoto.style.cssText = "";
      return;
    }
    const navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")) || 56;
    const spaceTop = navHeight;
    const spaceBottom = radar.getBoundingClientRect().top - heroBox.top;
    const spaceHeight = Math.max(80, spaceBottom - spaceTop);
    const aspect = (parseFloat(revealPhoto.getAttribute("width")) || 4) / (parseFloat(revealPhoto.getAttribute("height")) || 3);
    let photoHeight = spaceHeight * PHOTO_SUBJECT.fill / PHOTO_SUBJECT.height;
    photoHeight = Math.max(photoHeight, heroBox.width / aspect);   // always at least as wide as the screen
    const photoWidth = photoHeight * aspect;
    const left = clamp(heroBox.width / 2 - PHOTO_SUBJECT.centerX * photoWidth, heroBox.width - photoWidth, 0);
    const top = spaceTop + spaceHeight / 2 - PHOTO_SUBJECT.centerY * photoHeight;
    revealPhoto.style.cssText = "inset: auto; max-width: none; left: " + left.toFixed(1) + "px; top: " + top.toFixed(1) + "px; width: "
      + photoWidth.toFixed(1) + "px; height: " + photoHeight.toFixed(1) + "px;";
  }

  /* ---------- Cursor and touch input ---------- */

  heroElement.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") {
      return;
    }
    const heroBox = heroElement.getBoundingClientRect();
    targetX = event.clientX - heroBox.left;
    targetY = event.clientY - heroBox.top;
    mode = "track";
    revealRadiusGoal = revealRadiusFull;
  });

  heroElement.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") {
      mode = "scan";
      revealRadiusGoal = idleRadius();
    }
  });

  // While idle, a smaller circle roams with the scan so the photo peeks through even before anyone interacts.
  function idleRadius() {
    return motionEnabled ? revealRadiusFull * CURSOR_REVEAL.idleSpotlight : 0;
  }

  heroElement.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") {
      return;
    }
    const heroBox = heroElement.getBoundingClientRect();
    targetX = event.clientX - heroBox.left;
    targetY = event.clientY - heroBox.top;
    mode = "lock";
    revealRadiusGoal = revealRadiusFull;
  });

  // Touch screens: a tap moves the target to that spot and holds it there for a few seconds, then the radar goes
  // back to scanning. 
  const TAP = {
    maximumMovement: 10,   // pixels a finger may drift and still count as a tap
    maximumDuration: 500,  // milliseconds; longer presses are left alone
    holdTime: 3500         // milliseconds the target stays where you tapped
  };
  let tapStart = null;
  let returnToScanTimer = 0;

  heroElement.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    tapStart = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY, time: performance.now() } : null;
  }, { passive: true });

  heroElement.addEventListener("touchmove", (event) => {
    const touch = event.touches[0];
    if (tapStart && touch && Math.hypot(touch.clientX - tapStart.x, touch.clientY - tapStart.y) > TAP.maximumMovement) {
      tapStart = null;   // it's a swipe: the page scrolls, the radar carries on
    }
  }, { passive: true });

  heroElement.addEventListener("touchend", () => {
    if (!tapStart || performance.now() - tapStart.time > TAP.maximumDuration) {
      tapStart = null;
      return;
    }
    const heroBox = heroElement.getBoundingClientRect();
    targetX = clamp(tapStart.x - heroBox.left, 0, heroBox.width);
    targetY = clamp(tapStart.y - heroBox.top, 0, heroBox.height);
    mode = "lock";
    revealRadiusGoal = revealRadiusFull;
    clearTimeout(returnToScanTimer);
    returnToScanTimer = setTimeout(() => {
      mode = "scan";
      revealRadiusGoal = idleRadius();
    }, TAP.holdTime);
    tapStart = null;
  }, { passive: true });

  heroElement.addEventListener("touchcancel", () => { tapStart = null; }, { passive: true });

  /* ---------- Per-frame update ---------- */

  // Moves a line segment along the beam: from distance `tailDistance` to `headDistance`, measured from the radar.
  function moveSegment(segment, tailDistance, headDistance, unitX, unitY) {
    segment.setAttribute("x1", (emitterX + unitX * tailDistance).toFixed(1));
    segment.setAttribute("y1", (emitterY + unitY * tailDistance).toFixed(1));
    segment.setAttribute("x2", (emitterX + unitX * headDistance).toFixed(1));
    segment.setAttribute("y2", (emitterY + unitY * headDistance).toFixed(1));
  }

  // One cycle per pulse: "out" (the pulse travels to the target), "open" (it hits: a wave rings out and the circle
  // opens onto the photo while the echo travels home), "hold", "fade" (dissolves to black), and a short "pause".
  let cyclePhase = "out";
  let lastRevealOpacity = "";
  let cycleStartTime = performance.now();
  let hitTime = -1e9;

  function updateHero(now) {
    if (heroElement.getBoundingClientRect().bottom < 0) {
      return; // scrolled away: skip the work
    }

    // While idle, the target wanders slowly across the top of the screen.
    if (mode === "scan" && motionEnabled) {
      const seconds = (now - scanStartTime) / 1000;
      targetX = heroWidth * (0.58 + 0.28 * Math.sin(seconds * 0.33));
      targetY = heroHeight * (0.26 + 0.14 * Math.sin(seconds * 0.51 + 1.1));
    }
    const isIdle = !motionEnabled && mode === "scan";
    radarBeams.classList.toggle("is-idle", isIdle);
    radarTargetLayer.classList.toggle("is-idle", isIdle);
    radarTargetLayer.classList.toggle("is-scanning", mode === "scan");

    // Ease the target, and the circle's size for the current mode, toward where they should be.
    const followSpeed = motionEnabled ? 0.18 : 1;
    currentX += (targetX - currentX) * followSpeed;
    currentY += (targetY - currentY) * followSpeed;
    revealRadius += (revealRadiusGoal - revealRadius) * (motionEnabled ? 0.14 : 1);

    // The beam runs from the radar's emitter to the target.
    const deltaX = currentX - emitterX;
    const deltaY = currentY - emitterY;
    const distance = Math.max(1, Math.sqrt(deltaX * deltaX + deltaY * deltaY));
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    beamTrack.setAttribute("x1", emitterX);
    beamTrack.setAttribute("y1", emitterY);
    beamTrack.setAttribute("x2", currentX.toFixed(1));
    beamTrack.setAttribute("y2", currentY.toFixed(1));
    target.setAttribute("transform", "translate(" + currentX.toFixed(1) + " " + currentY.toFixed(1) + ")");

    let reveal;
    if (motionEnabled) {
      reveal = runPulseCycle(now, distance, unitX, unitY);
    } else {
      // Reduced motion: no pulses; the circle simply follows the cursor.
      pulseOut.style.opacity = 0;
      pulseReturn.style.opacity = 0;
      targetPing.style.opacity = 0;
      reveal = { size: mode === "scan" ? 0 : 1, opacity: 1 };
    }

    // The soft-edged circle at the target: through it, the still photo behind and the name in lavender.
    const radius = Math.max(0.5, revealRadius * reveal.size);
    const opacity = reveal.opacity.toFixed(3);
    if (opacity !== lastRevealOpacity) {
      heroReveal.style.opacity = opacity;   // the dissolve: the photo and lavender letters fade back to black and white
      lastRevealOpacity = opacity;
    }
    const mask = "radial-gradient(circle " + radius.toFixed(1) + "px at " + currentX.toFixed(1) + "px " + currentY.toFixed(1)
      + "px, #000 58%, transparent 100%)";
    heroReveal.style.webkitMaskImage = mask;
    heroReveal.style.maskImage = mask;

    // The target's label stays beside the square, flipping to its left near the right edge of the screen.
    const flipLabel = currentX + 22 + 90 > heroWidth;
    targetLabel.setAttribute("x", flipLabel ? "-22" : "22");
    targetLabel.setAttribute("text-anchor", flipLabel ? "end" : "start");

    // The readout only needs to change a few times a second.
    frameCount++;
    if (frameCount % 6 === 0) {
      radarReadout.textContent = (mode === "scan" ? "SCAN " : "TRACK") + " RANGE " + Math.round(distance) + " PIXELS";
      targetLabel.textContent = mode === "scan" ? "SCAN" : "TRACK";
    }
  }

  // Runs one pulse cycle and returns the circle's size and visibility.
  function runPulseCycle(now, distance, unitX, unitY) {
    const travelTime = distance / RADAR.pulseSpeed;
    const phaseLengths = {
      out: travelTime,
      open: PHOTO_PULSE.openTime,
      hold: PHOTO_PULSE.holdTime,
      fade: PHOTO_PULSE.fadeTime,
      pause: PHOTO_PULSE.pauseTime
    };
    const nextPhase = { out: "open", open: "hold", hold: "fade", fade: "pause", pause: "out" };
    if (now - cycleStartTime > 4000) {   // back from a background tab: start a fresh cycle
      cyclePhase = "out";
      cycleStartTime = now;
    }
    let elapsed = now - cycleStartTime;
    while (elapsed >= phaseLengths[cyclePhase]) {
      cycleStartTime += phaseLengths[cyclePhase];
      elapsed = now - cycleStartTime;
      cyclePhase = nextPhase[cyclePhase];
      if (cyclePhase === "open") {
        hitTime = cycleStartTime;
      }
    }

    // The pulse going out.
    if (cyclePhase === "out") {
      const travelled = Math.min(distance, elapsed * RADAR.pulseSpeed);
      moveSegment(pulseOut, Math.max(0, travelled - RADAR.pulseLength), travelled, unitX, unitY);
      pulseOut.style.opacity = 1;
    } else {
      pulseOut.style.opacity = 0;
    }

    // The echo coming home, from the moment of the hit.
    const sinceHit = now - hitTime;
    if (sinceHit >= 0 && sinceHit < travelTime) {
      const headDistance = Math.max(0, distance - sinceHit * RADAR.pulseSpeed);
      moveSegment(pulseReturn, Math.min(distance, headDistance + RADAR.pulseLength), headDistance, unitX, unitY);
      pulseReturn.style.opacity = 0.9;
    } else {
      pulseReturn.style.opacity = 0;
    }

    // The wave: a ring spreading out from the target and fading.
    const waveProgress = sinceHit / PHOTO_PULSE.waveTime;
    if (waveProgress >= 0 && waveProgress <= 1) {
      const waveRadius = 8 + (revealRadius * PHOTO_PULSE.waveSize - 8) * easeOut(waveProgress);
      targetPing.setAttribute("r", waveRadius.toFixed(1));
      targetPing.style.opacity = (1 - waveProgress).toFixed(2);
    } else {
      targetPing.style.opacity = 0;
    }

    // How big the circle is (0 to 1) and how visible (1 = clear, 0 = dissolved to black).
    if (cyclePhase === "open") {
      return { size: easeOut(elapsed / PHOTO_PULSE.openTime), opacity: 1 };
    }
    if (cyclePhase === "hold") {
      return { size: 1, opacity: 1 };
    }
    if (cyclePhase === "fade") {
      const t = Math.min(1, elapsed / PHOTO_PULSE.fadeTime);
      return { size: 1, opacity: 1 - t * t * (3 - 2 * t) };
    }
    return { size: 0, opacity: 1 };
  }

  Site.onMeasure(measureHero);
  Site.onFrame(updateHero);
})(window.Site);
