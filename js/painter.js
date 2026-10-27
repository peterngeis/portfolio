/*
 * painter.js
 * The class demo: a browser re-creation of the concurrent canvas painter.
 *
 * Run the painters once, recording the order pixels were painted, plays that
 * recording back at a fixed frame rate. The two render rates only change which recorded
 * moments become frames:
 *   linear      every frame covers an equal share of the painters' work
 *   non-linear  frames are spaced by pixels painted, slowing near the end
 */
(function (Site) {
  "use strict";
  const { clamp, motionEnabled } = Site;

  /* ---------- Settings you can tweak ---------- */

  const PAINTER = {
    size: 240,             // canvas width and height in pixels
    framesPerSecond: 36,   // playback frame rate
    holdStart: 12,         // frames held on the starting dots
    holdEnd: 20,           // frames held on the finished canvas
    targetFrames: 450,     // TARGET_FRAMES from the C version
    stepLimit: 9e7         // safety cap on painter steps
  };

  /* ---------- Elements and shared state ---------- */

  const canvas = document.getElementById("painter-canvas");
  if (!canvas) {
    return;
  }
  const context = canvas.getContext("2d");
  const canvasWidth = PAINTER.size;
  const canvasHeight = PAINTER.size;
  const pixelCount = canvasWidth * canvasHeight;
  const imageData = context.createImageData(canvasWidth, canvasHeight);
  const pixelBytes = imageData.data;   // red, green, blue, alpha for every pixel

  // One painter per logical core of the visitor's device (between 4 and 16).
  const painterCount = Math.max(4, Math.min(16, navigator.hardwareConcurrency || 8));

  const BASE_COLORS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255]];
  // The eight directions a painter can step, as x and y offsets.
  const DIRECTION_X = [-1, -1, 0, 1, 1, 1, 0, -1];
  const DIRECTION_Y = [0, 1, 1, 1, 0, -1, -1, -1];

  const FRAMES_PER_SECOND = PAINTER.framesPerSecond;
  const HOLD_START_FRAMES = PAINTER.holdStart;
  const HOLD_END_FRAMES = PAINTER.holdEnd;
  const TARGET_FRAMES = PAINTER.targetFrames;
  const STEP_LIMIT = PAINTER.stepLimit;

  let baseColorIndex = 3;     // the first run is always purple; later runs pick a random color
  let isFirstRun = true;
  let recording = null;       // the recorded painting (see startRecording)
  let isRecording = false;
  let playWhenReady = false;
  const frameSchedules = { linear: null, nonlinear: null };   // for each render rate: how many pixels are shown in each frame
  let renderRate = "nonlinear";
  let frameIndex = 0;         // the frame currently shown
  let pixelsDrawn = 0;        // how many recorded pixels are drawn on the canvas right now
  let isPlaying = false;
  let playbackStartTime = 0;
  let playbackStartIndex = 0;

  const playButton = document.getElementById("painter-play");
  const statusLabel = document.getElementById("painter-status");
  const chart = document.getElementById("painter-chart");
  const currentCurve = chart.querySelector(".curve-current");
  const otherCurve = chart.querySelector(".curve-other");
  const playhead = chart.querySelector(".playhead");
  const frameReadout = document.getElementById("painter-frame-number");
  const percentReadout = document.getElementById("painter-percent");
  const tailReadout = document.getElementById("painter-tail-share");
  document.getElementById("painter-count").textContent = String(painterCount);

  function clearCanvas() {
    for (let byteIndex = 0; byteIndex < pixelBytes.length; byteIndex++) {
      pixelBytes[byteIndex] = 255;
    }
    pixelsDrawn = 0;
  }
  clearCanvas();
  context.putImageData(imageData, 0, 0);

  /* ---------- Recording: run the painters once ---------- */

  function startRecording() {
    if (!isFirstRun) {
      baseColorIndex = (Math.random() * BASE_COLORS.length) | 0;
    }
    isFirstRun = false;

    // Each painter gets a darker or lighter shade of one base color.
    const baseColor = BASE_COLORS[baseColorIndex];
    const shades = [];
    for (let painterId = 0; painterId < painterCount; painterId++) {
      const brightness = 0.1 + 0.85 * (painterId / painterCount);
      shades.push([(baseColor[0] * brightness) | 0, (baseColor[1] * brightness) | 0, (baseColor[2] * brightness) | 0]);
    }

    const owner = new Int16Array(pixelCount);   // which painter owns each pixel (-1 = still white)
    owner.fill(-1);
    const paintOrder = new Int32Array(pixelCount);          // the pixel painted at each moment
    const paintedBy = new Uint8Array(pixelCount);           // the painter who painted it
    const stepsWhenPainted = new Float64Array(pixelCount); // how many steps the painters had taken by then

    // Painters start on an even grid across the canvas.
    const gridColumns = Math.ceil(Math.sqrt(painterCount));
    const gridRows = Math.ceil(painterCount / gridColumns);
    const spacingX = Math.floor(canvasWidth / (gridColumns + 1));
    const spacingY = Math.floor(canvasHeight / (gridRows + 1));
    const painters = [];
    let paintedCount = 0;
    let stepCount = 0;
    const directionOrder = [0, 1, 2, 3, 4, 5, 6, 7];

    function paintPixel(pixelIndex, painterId) {
      if (owner[pixelIndex] < 0) {
        paintOrder[paintedCount] = pixelIndex;
        paintedBy[paintedCount] = painterId;
        stepsWhenPainted[paintedCount] = stepCount;
        paintedCount++;
      }
      owner[pixelIndex] = painterId;
    }

    for (let painterId = 0; painterId < painterCount; painterId++) {
      const x = spacingX + (painterId % gridColumns) * spacingX;
      const y = spacingY + Math.floor(painterId / gridColumns) * spacingY;
      const startPixel = y * canvasWidth + x;
      painters.push({ x, y, trail: [startPixel] });   // the trail is the path to backtrack along
      paintPixel(startPixel, painterId);
    }

    // A painter may only paint next to a pixel of its own color.
    function touchesOwnColor(x, y, painterId) {
      for (let direction = 0; direction < 8; direction++) {
        const neighborX = x + DIRECTION_X[direction];
        const neighborY = y + DIRECTION_Y[direction];
        const isOnCanvas = neighborX >= 0 && neighborX < canvasWidth && neighborY >= 0 && neighborY < canvasHeight;
        if (isOnCanvas && owner[neighborY * canvasWidth + neighborX] === painterId) {
          return true;
        }
      }
      return false;
    }

    function tryMove(painter, painterId, direction) {
      const x = painter.x + DIRECTION_X[direction];
      const y = painter.y + DIRECTION_Y[direction];
      if (x < 0 || x >= canvasWidth || y < 0 || y >= canvasHeight) {
        return false;
      }
      const pixelIndex = y * canvasWidth + x;
      const currentOwner = owner[pixelIndex];
      const isWhiteOrOwn = currentOwner < 0 || currentOwner === painterId;
      if (!isWhiteOrOwn) {
        return false;
      }
      if (painter.trail.length > 1 && !touchesOwnColor(x, y, painterId)) {
        return false;
      }
      paintPixel(pixelIndex, painterId);
      painter.x = x;
      painter.y = y;
      painter.trail.push(pixelIndex);
      return true;
    }

    // One step: try a random direction, then the other seven in random order, then backtrack.
    function stepPainter(painter, painterId) {
      stepCount++;
      const firstChoice = (Math.random() * 8) | 0;
      if (tryMove(painter, painterId, firstChoice)) {
        return;
      }
      for (let position = 7; position > 0; position--) {
        const swapWith = (Math.random() * (position + 1)) | 0;
        const held = directionOrder[position];
        directionOrder[position] = directionOrder[swapWith];
        directionOrder[swapWith] = held;
      }
      for (let position = 0; position < 8; position++) {
        if (directionOrder[position] !== firstChoice && tryMove(painter, painterId, directionOrder[position])) {
          return;
        }
      }
      if (painter.trail.length > 1) {
        painter.trail.pop();
        const previousPixel = painter.trail[painter.trail.length - 1];
        painter.x = previousPixel % canvasWidth;
        painter.y = (previousPixel / canvasWidth) | 0;
      }
    }

    // Runs the painters for up to `budget` milliseconds. Returns true once the canvas is full.
    const newRecording = {
      paintOrder,
      paintedBy,
      stepsWhenPainted,
      shades,
      isDone: false,
      paintedCount: 0,
      totalSteps: 0,
      runForMilliseconds(budget) {
        const startTime = performance.now();
        while (paintedCount < pixelCount && stepCount < STEP_LIMIT) {
          for (let round = 0; round < 1024 && paintedCount < pixelCount; round++) {
            for (let painterId = 0; painterId < painterCount; painterId++) {
              stepPainter(painters[painterId], painterId);
            }
          }
          if (performance.now() - startTime > budget) {
            break;
          }
        }
        newRecording.paintedCount = paintedCount;
        newRecording.totalSteps = stepCount;
        return paintedCount >= pixelCount || stepCount >= STEP_LIMIT;
      }
    };
    recording = newRecording;
  }

  /* ---------- Frame schedules for the two render rates ---------- */

  // A schedule lists, for every frame, how many of the recorded pixels are drawn.
  function buildFrameSchedules() {
    const recordedPixels = recording.paintedCount;
    const areaRatio = pixelCount / 1166400;   // this canvas compared to the 1080 x 1080 original

    // Non-linear: frames are spaced by pixels painted (the formula from the C version),
    // so the schedule slows down near the end.
    const nonlinear = [];
    for (let frame = 0; frame < HOLD_START_FRAMES; frame++) {
      nonlinear.push(painterCount);
    }
    let pixelsInFrame = painterCount;
    while (pixelsInFrame < recordedPixels) {
      nonlinear.push(pixelsInFrame);
      const fractionPainted = pixelsInFrame / pixelCount;
      const pixelsRemaining = pixelCount - pixelsInFrame;
      const framesRemaining = TARGET_FRAMES * (1 - fractionPainted) + 12;
      const largestStep = fractionPainted > 0.97 ? 200 : fractionPainted > 0.9 ? 600 : 2500;
      let step = Math.floor(pixelsRemaining / framesRemaining);
      step = Math.min(step, Math.max(1, Math.round(largestStep * areaRatio * 4)));
      step = Math.max(step, 1);
      pixelsInFrame += step;
    }
    for (let frame = 0; frame < HOLD_END_FRAMES + 1; frame++) {
      nonlinear.push(recordedPixels);
    }
    frameSchedules.nonlinear = nonlinear;

    // Linear: every frame covers an equal share of the painters' steps.
    const linear = [];
    for (let frame = 0; frame < HOLD_START_FRAMES; frame++) {
      linear.push(painterCount);
    }
    const stepsWhenPainted = recording.stepsWhenPainted;
    const totalSteps = recording.totalSteps;
    for (let frameNumber = 1; frameNumber <= TARGET_FRAMES; frameNumber++) {
      const targetSteps = totalSteps * frameNumber / TARGET_FRAMES;
      // Binary search: the first pixel painted after `targetSteps` steps.
      let low = 0;
      let high = recordedPixels;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (stepsWhenPainted[middle] <= targetSteps) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      linear.push(low);
    }
    for (let frame = 0; frame < HOLD_END_FRAMES; frame++) {
      linear.push(recordedPixels);
    }
    frameSchedules.linear = linear;

    // How much of the total work the last 1% of pixels took.
    const firstOfLastPercent = Math.floor(recordedPixels * 0.99);
    tailReadout.textContent = Math.round(100 * (1 - stepsWhenPainted[firstOfLastPercent] / totalSteps)) + "%";
  }

  /* ---------- Chart ---------- */

  // The curve of "share of the canvas painted" over playback time, drawn in a 600 x 100 box.
  function curvePath(schedule) {
    const lastIndex = schedule.length - 1;
    const sampleSpacing = Math.max(1, Math.floor(lastIndex / 400));
    let path = "";
    for (let index = 0; index <= lastIndex; index += sampleSpacing) {
      path += (index ? "L" : "M") + (index / lastIndex * 600).toFixed(1) + " " + (100 - schedule[index] / pixelCount * 100).toFixed(2);
    }
    return path + "L600 " + (100 - schedule[lastIndex] / pixelCount * 100).toFixed(2);
  }

  function drawCurves() {
    if (!frameSchedules.linear) {
      return;
    }
    const otherRate = renderRate === "linear" ? "nonlinear" : "linear";
    currentCurve.setAttribute("d", curvePath(frameSchedules[renderRate]));
    otherCurve.setAttribute("d", curvePath(frameSchedules[otherRate]));
  }

  /* ---------- Drawing and playback ---------- */

  // Draws recorded pixels until exactly `targetCount` are on the canvas (clearing first when going backward).
  function paintUpTo(targetCount) {
    if (targetCount < pixelsDrawn) {
      clearCanvas();
    }
    const { paintOrder, paintedBy, shades } = recording;
    for (let index = pixelsDrawn; index < targetCount; index++) {
      const byteIndex = paintOrder[index] * 4;
      const shade = shades[paintedBy[index]];
      pixelBytes[byteIndex] = shade[0];
      pixelBytes[byteIndex + 1] = shade[1];
      pixelBytes[byteIndex + 2] = shade[2];
    }
    pixelsDrawn = targetCount;
    context.putImageData(imageData, 0, 0);
  }

  function showFrame(requestedIndex) {
    const schedule = frameSchedules[renderRate];
    const lastIndex = schedule.length - 1;
    frameIndex = clamp(requestedIndex, 0, lastIndex);
    paintUpTo(schedule[frameIndex]);

    const playheadX = (frameIndex / lastIndex * 600).toFixed(1);
    playhead.setAttribute("x1", playheadX);
    playhead.setAttribute("x2", playheadX);

    const percentPainted = Math.floor(schedule[frameIndex] / pixelCount * 100);
    frameReadout.textContent = String(frameIndex + 1).padStart(3, "0") + " / " + schedule.length;
    percentReadout.textContent = percentPainted + "%";
    chart.setAttribute("aria-valuenow", String(Math.round(frameIndex / lastIndex * 100)));
    chart.setAttribute("aria-valuetext", "Frame " + (frameIndex + 1) + " of " + schedule.length + ", " + percentPainted + "% painted");
  }

  // Makes sure the painting has been recorded, then plays it if asked to.
  function ensureRecording(playWhenDone) {
    if (playWhenDone) {
      playWhenReady = true;
    }
    if (recording && recording.isDone) {
      if (playWhenReady && !Site.animationsPaused) {   // while paused, it waits for the site to resume
        playWhenReady = false;
        play();
      }
      return;
    }
    if (isRecording) {
      return;
    }
    isRecording = true;
    startRecording();
    statusLabel.hidden = false;

    // Record in short slices so the page stays responsive while the painters run.
    (function runNextSlice() {
      const isFinished = recording.runForMilliseconds(14);
      statusLabel.textContent = "Running " + painterCount + " painters… " + Math.floor(recording.paintedCount / pixelCount * 100) + "%";
      if (!isFinished) {
        setTimeout(runNextSlice, 0);
        return;
      }
      isRecording = false;
      recording.isDone = true;
      statusLabel.hidden = true;
      buildFrameSchedules();
      drawCurves();
      clearCanvas();
      showFrame(0);
      if (playWhenReady) {
        playWhenReady = false;
        play();
      } else {
        playButton.textContent = "Play";
      }
    })();
  }

  function advancePlayback(now) {
    if (!isPlaying) {
      return;
    }
    const schedule = frameSchedules[renderRate];
    const lastIndex = schedule.length - 1;
    const targetIndex = playbackStartIndex + Math.floor((now - playbackStartTime) * FRAMES_PER_SECOND / 1000);
    if (targetIndex >= lastIndex) {
      showFrame(lastIndex);
      isPlaying = false;
      playButton.textContent = "Replay";
      return;
    }
    if (targetIndex !== frameIndex) {
      showFrame(targetIndex);
    }
    requestAnimationFrame(advancePlayback);
  }

  function play() {
    if (!recording || !recording.isDone) {
      ensureRecording(true);
      return;
    }
    const lastIndex = frameSchedules[renderRate].length - 1;
    if (frameIndex >= lastIndex) {
      frameIndex = 0;
    }
    isPlaying = true;
    playbackStartIndex = frameIndex;
    playbackStartTime = performance.now();
    playButton.textContent = "Pause";
    requestAnimationFrame(advancePlayback);
  }

  function pause() {
    isPlaying = false;
    const isAtEnd = frameSchedules[renderRate] && frameIndex >= frameSchedules[renderRate].length - 1;
    playButton.textContent = isAtEnd ? "Replay" : "Play";
  }

  /* ---------- Controls ---------- */

  playButton.addEventListener("click", () => {
    if (isPlaying) {
      pause();
    } else if (Site.animationsPaused) {
      Site.setAnimationsPaused(false);   // playing the demo resumes everything, so the top-bar button agrees
      if (!isPlaying) {
        play();
      }
    } else {
      play();
    }
  });

  document.getElementById("painter-new-run").addEventListener("click", () => {
    isPlaying = false;
    recording = null;
    frameSchedules.linear = null;
    frameSchedules.nonlinear = null;
    frameIndex = 0;
    currentCurve.removeAttribute("d");
    otherCurve.removeAttribute("d");
    tailReadout.textContent = "–";
    clearCanvas();
    context.putImageData(imageData, 0, 0);
    ensureRecording(true);
  });

  document.getElementById("painter-render-rate").addEventListener("change", (event) => {
    renderRate = event.target.value;
    drawCurves();
    if (recording && recording.isDone) {
      isPlaying = false;
      frameIndex = 0;
      showFrame(0);
      play();
    }
  });

  // Scrubbing: dragging along the chart jumps to that moment.
  function seekToPointer(clientX) {
    if (!recording || !recording.isDone) {
      return;
    }
    const chartBox = chart.getBoundingClientRect();
    const lastIndex = frameSchedules[renderRate].length - 1;
    if (isPlaying) {
      pause();
    }
    showFrame(Math.round(clamp((clientX - chartBox.left) / chartBox.width, 0, 1) * lastIndex));
    playButton.textContent = frameIndex >= lastIndex ? "Replay" : "Play";
  }

  chart.addEventListener("pointerdown", (event) => {
    chart.setPointerCapture(event.pointerId);
    seekToPointer(event.clientX);
  });

  chart.addEventListener("pointermove", (event) => {
    if (chart.hasPointerCapture(event.pointerId)) {
      seekToPointer(event.clientX);
    }
  });

  chart.addEventListener("keydown", (event) => {
    if (!recording || !recording.isDone) {
      return;
    }
    const lastIndex = frameSchedules[renderRate].length - 1;
    const stepSize = event.shiftKey ? 20 : 1;
    let newIndex = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      newIndex = frameIndex + stepSize;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      newIndex = frameIndex - stepSize;
    } else if (event.key === "Home") {
      newIndex = 0;
    } else if (event.key === "End") {
      newIndex = lastIndex;
    }
    if (newIndex === null) {
      return;
    }
    event.preventDefault();
    if (isPlaying) {
      pause();
    }
    showFrame(newIndex);
    playButton.textContent = frameIndex >= lastIndex ? "Replay" : "Play";
  });

  // The demo and the top-bar pause button work as one: pausing site-wide pauses the demo, and resuming plays it
  // again if it's on screen and was stopped partway (whichever button stopped it), or hasn't started yet. A
  // finished demo stays on Replay.
  let isOnScreen = false;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => { isOnScreen = entry.isIntersecting; });
    }, { threshold: 0.25 }).observe(canvas);
  }

  Site.onPauseChange((isPaused) => {
    if (isPaused) {
      if (isPlaying) {
        pause();
      }
      return;
    }
    if (!isOnScreen || isPlaying) {
      return;
    }
    if (recording && recording.isDone) {
      const lastIndex = frameSchedules[renderRate].length - 1;
      if (frameIndex < lastIndex) {
        playWhenReady = false;
        play();
      }
    } else {
      ensureRecording(true);
    }
  });

  /* ---------- Start the recording early, and play when the canvas is on screen ---------- */

  if ("IntersectionObserver" in window) {
    // Start recording while the canvas is still up to 900px away, so playback can begin instantly.
    const recordingObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          ensureRecording(false);
          recordingObserver.disconnect();
        }
      });
    }, { rootMargin: "900px 0px" });
    recordingObserver.observe(canvas);

    if (motionEnabled) {
      const autoplayObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !Site.animationsPaused) {   // while paused, it waits for its Play button
            ensureRecording(true);
            autoplayObserver.disconnect();
          }
        });
      }, { threshold: 0.75 });   // starts once the canvas is mostly on screen, as its pause begins
      autoplayObserver.observe(canvas);
    }
  }
})(window.Site);
