/*
 * field-photos.js
 * "Field photos": a map of the United States with a pin where each photo was taken.
 * The tour moves in steps: one scroll gesture (a wheel burst, a trackpad flick, a swipe, an arrow key) moves one
 * stop, and ensures no stop is skipped. Between stops the animation plays on its own clock: the map flies to the next
 * place, the photo grows out of its pin, its caption shows, and it shrinks back before moving on. 
 */
(function (Site) {
  "use strict";
  const { clamp } = Site;

  /* ---------- Settings you can tweak ---------- */

  // The timeline: the lengths of its parts (in "screens", the unit the playback speed below is measured in).
  const TOUR = {
    introLength: 0.3,       // the whole map, before flying to the first place
    flyLength: 1.1,         // flying from one place to another
    openLength: 0.28,       // a photo growing out of its pin
    holdLength: 0.3,        // the photo fully open, with its caption
    closeLength: 0.22,      // the photo shrinking back into its pin
    outroLength: 0.35,      // zooming back out to the whole map at the end
    zoom: 2.2,              // how far the map zooms in on a place (1 = the whole map)
    zoomPhone: 2.8,         // the same on screens narrower than 760 px
    smallestPhoto: 0.05,    // photo size when it sits inside its pin, as a fraction of its open size
    stepLength: 0.7,        // scrolling between two stops, in screen heights (one gesture moves one stop)
    secondsPerScreen: 0.65, // playback speed between stops: seconds per screen of the timeline above...
    shortestMove: 0.4,      // Minimum move time
    longestMove: 1.6        // Maximum move time
    };

  const MAP_WIDTH = 1000;   // the map drawing's grid an svg viewBox
  const MAP_HEIGHT = 627;

  // Reduced motion only on screens at least minimumWidth wide, the photos stay in one row with the tallest.
  const STILL = { minimumWidth: 760, tallestShare: 0.36 };

  const section = document.querySelector(".field-photos");
  const stage = section.querySelector(".field-map-stage");
  const mapArea = section.querySelector(".field-map");
  const mapDrawing = section.querySelector(".usa-map");
  const progressFill = section.querySelector(".field-photos-progress-fill");
  const pins = Array.from(section.querySelectorAll(".map-pin")).map((element) => ({
    element,
    place: element.getAttribute("data-place"),
    x: parseFloat(element.style.getPropertyValue("--x")),
    y: parseFloat(element.style.getPropertyValue("--y"))
  }));
  const pinByPlace = new Map(pins.map((pin) => [pin.place, pin]));
  const photos = Array.from(section.querySelectorAll(".field-photo")).map((element) => {
    const image = element.querySelector("img");
    return {
      element,
      image,
      pin: pinByPlace.get(element.getAttribute("data-place")),
      heightShare: parseFloat(element.style.getPropertyValue("--photo-height")) / 100,
      aspect: (parseFloat(image.getAttribute("width")) || 1) / (parseFloat(image.getAttribute("height")) || 1),
      openBox: { left: 0, top: 0, width: 1, height: 1 }
    };
  });

  if (!Site.motionEnabled || photos.length === 0) {
    // Reduced motion: The map and the row of photos sit one after the other, and the map is scaled to the
    // heading.
    if (photos.length > 0) {
      Site.onMeasure(fitStillMap, 30);
    }
    return;
  }
  section.classList.add("is-touring");


  // Decode every photo up front so none pops in while it grows.
  photos.forEach((photo) => {
    if (photo.image.decode) {
      photo.image.decode().catch(() => {});
    }
  });

  // Reduced motion only: fits the heading, the map, and the photos on one screen. 
  function fitStillMap() {
    const header = section.querySelector(".field-photos-header");
    const photoList = section.querySelector(".field-photo-list");
    const fitsOneRow = Site.viewportWidth >= STILL.minimumWidth;
    section.classList.toggle("is-still-row", fitsOneRow);
    if (!fitsOneRow) {
      mapArea.style.width = "";   // phones: the photos wrap, so the map keeps its full width
      return;
    }
    const listStyle = getComputedStyle(photoList);
    const rowWidth = photoList.clientWidth - parseFloat(listStyle.paddingLeft) - parseFloat(listStyle.paddingRight)
      - (parseFloat(listStyle.columnGap) || 0) * (photos.length - 1);
    const widthPerUnit = photos.reduce((sum, photo) => sum + photo.heightShare * 100 * photo.aspect, 0);
    const tallestUnits = Math.max(...photos.map((photo) => photo.heightShare * 100));
    const scale = Math.min(rowWidth / widthPerUnit, Site.viewportHeight * STILL.tallestShare / tallestUnits);
    section.style.setProperty("--still-photo-scale", scale.toFixed(3) + "px");

    const stageStyle = getComputedStyle(stage);
    const usedHeight = parseFloat(stageStyle.paddingTop) + parseFloat(stageStyle.paddingBottom)
      + header.offsetHeight + parseFloat(getComputedStyle(header).marginBottom) + photoList.offsetHeight;
    const roomHeight = Site.viewportHeight - usedHeight - 2;   // a little slack for rounding
    mapArea.style.width = Math.max(180, roomHeight * MAP_WIDTH / MAP_HEIGHT) + "px";
  }

  /* ---------- The timeline: fly to a place, open and close each of its photos, fly on ---------- */

  const MAP_CENTER = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  const steps = [];
  steps.push({ kind: "intro", length: TOUR.introLength });
  photos.forEach((photo, index) => {
    const previous = photos[index - 1];
    if (!previous || previous.pin !== photo.pin) {
      steps.push({ kind: "fly", length: TOUR.flyLength, from: previous ? previous.pin : null, to: photo.pin });
    }
    steps.push({ kind: "photo", length: TOUR.openLength + TOUR.holdLength + TOUR.closeLength, photo, index });
  });
  steps.push({ kind: "outro", length: TOUR.outroLength, from: photos[photos.length - 1].pin });
  const totalLength = steps.reduce((sum, step) => sum + step.length, 0);

  // How far into the tour (in screens) a photo is fully open: halfway through its hold.
  function openScreensFor(index) {
    let screens = 0;
    for (const step of steps) {
      if (step.kind === "photo" && step.index === index) {
        return screens + TOUR.openLength + TOUR.holdLength / 2;
      }
      screens += step.length;
    }
    return 0;
  }

  // The stops along the timeline each photo fully open.
  const stops = [0, ...photos.map((photo, index) => openScreensFor(index)), totalLength];

  // A snap point for each stop, plus one a screen before the first and one a screen after the last, so the tour
  // scrolls in and out like the rest of the pages with css/field-photos.css.
  function makeSnapPoint() {
    const point = document.createElement("div");
    point.className = "field-photo-stop";
    point.setAttribute("aria-hidden", "true");
    section.appendChild(point);
    return point;
  }
  const stopPoints = stops.map(makeSnapPoint);
  const beforePoint = makeSnapPoint();
  const afterPoint = makeSnapPoint();

  /* ---------- Measuring ---------- */

  let sectionTop = 0;
  let stepDistance = 1;     // pixels of scrolling between two stops
  let tourDistance = 1;     // pixels of scrolling from the first stop to the last
  let areaWidth = 1;
  let areaHeight = 1;
  let areaTop = 0;          // the map area's position inside the stage
  let fitScale = 1;         // screen pixels per map unit at zoom 1
  let drawingLeft = 0;      // where the whole map sits at zoom 1, inside the map area
  let drawingTop = 0;
  let zoomIn = TOUR.zoom;

  function measureTour() {
    const screenHeight = Site.viewportHeight;
    stepDistance = Math.round(TOUR.stepLength * screenHeight);
    tourDistance = stepDistance * (stops.length - 1);
    section.style.height = (tourDistance + screenHeight) + "px";
    sectionTop = Site.documentTop(section);
    stopPoints.forEach((point, index) => { point.style.top = (index * stepDistance) + "px"; });
    beforePoint.style.top = (-screenHeight) + "px";
    afterPoint.style.top = (tourDistance + screenHeight) + "px";
    areaWidth = mapArea.clientWidth;
    areaHeight = mapArea.clientHeight;
    areaTop = mapArea.offsetTop;
    const isPhone = Site.viewportWidth < 760;
    zoomIn = isPhone ? TOUR.zoomPhone : TOUR.zoom;

    // The whole map fits the area with a margin; the bottom margin leaves room for the progress line.
    const margin = isPhone ? 16 : 40;
    fitScale = Math.min((areaWidth - margin * 2) / MAP_WIDTH, (areaHeight - margin * 2 - 24) / MAP_HEIGHT);
    drawingLeft = (areaWidth - MAP_WIDTH * fitScale) / 2;
    drawingTop = (areaHeight - 24 - MAP_HEIGHT * fitScale) / 2;
    mapDrawing.style.width = areaWidth + "px";
    mapDrawing.style.height = areaHeight + "px";

    // Each photo's open size: its share of the screen height, kept inside the map area with room for its caption.
    const captionRoom = 64;
    const roomHeight = areaHeight - captionRoom - 24;
    const roomWidth = areaWidth - (isPhone ? 32 : 96);
    photos.forEach((photo) => {
      let height = Math.min(photo.heightShare * screenHeight, roomHeight);
      let width = height * photo.aspect;
      if (width > roomWidth) {
        width = roomWidth;
        height = width / photo.aspect;
      }
      const box = photo.openBox;
      box.width = width;
      box.height = height;
      box.left = (areaWidth - width) / 2;
      box.top = areaTop + Math.max(8, (roomHeight - height) / 2);
      photo.element.style.width = width + "px";
      photo.element.style.left = box.left + "px";
      photo.element.style.top = box.top + "px";
      photo.element.style.transformOrigin = "50% " + (height / 2) + "px";
    });
    lastCamera = "";
  }

  /* ---------- Per frame ---------- */

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // Works out where the camera is and which photo is how open, for a distance into the tour.
  function tourStateAt(distanceInScreens) {
    let remaining = distanceInScreens;
    for (const step of steps) {
      if (remaining > step.length && step !== steps[steps.length - 1]) {
        remaining -= step.length;
        continue;
      }
      const t = clamp(remaining / step.length, 0, 1);
      if (step.kind === "intro") {
        return { focus: MAP_CENTER, zoom: 1, pin: null, photo: null, openAmount: 0 };
      }
      if (step.kind === "fly") {
        const e = easeInOut(t);
        const from = step.from || MAP_CENTER;
        const focus = { x: from.x + (step.to.x - from.x) * e, y: from.y + (step.to.y - from.y) * e };
        let zoom;
        if (step.from) {
          // Pull back partway in the middle of the flight, then zoom in on the new place.
          const pullBack = Math.max(1, zoomIn * 0.5);
          zoom = zoomIn - (zoomIn - pullBack) * Math.sin(Math.PI * e);
        } else {
          zoom = 1 + (zoomIn - 1) * e;
        }
        return { focus, zoom, pin: t > 0.5 ? step.to : step.from, photo: null, openAmount: 0 };
      }
      if (step.kind === "photo") {
        const local = t * step.length;
        let openAmount;
        if (local < TOUR.openLength) {
          openAmount = easeOutCubic(local / TOUR.openLength);
        } else if (local < TOUR.openLength + TOUR.holdLength) {
          openAmount = 1;
        } else {
          openAmount = 1 - easeOutCubic((local - TOUR.openLength - TOUR.holdLength) / TOUR.closeLength);
        }
        return { focus: step.photo.pin, zoom: zoomIn, pin: step.photo.pin, photo: step.photo, openAmount, index: step.index };
      }
      // outro
      const e = easeInOut(t);
      return {
        focus: { x: step.from.x + (MAP_CENTER.x - step.from.x) * e, y: step.from.y + (MAP_CENTER.y - step.from.y) * e },
        zoom: zoomIn + (1 - zoomIn) * e,
        pin: e < 0.5 ? step.from : null,
        photo: null,
        openAmount: 0
      };
    }
    return { focus: MAP_CENTER, zoom: 1, pin: null, photo: null, openAmount: 0 };
  }

  let lastCamera = "";
  let lastPin = null;
  let lastPhoto = null;
  let lastProgress = -1;

  // Playback: the timeline position moves toward the stop the visitor is at (or snapping to), on its own clock.
  let position = null;      // where the timeline is now (in screens); null until the first frame
  let goalStop = 0;
  let moveFrom = 0;
  let moveTo = 0;
  let moveStart = 0;
  let moveDuration = 1;
  let isSnapping = true;
  let leavingUntil = 0;     // while scrolling out past the first or last stop, snapping stays off

  function updateTour(now) {
    const scrolled = window.scrollY - sectionTop;

    // Snapping is on only while the tour is on screen (and not while the visitor is scrolling out of it), so the rest
    // of the page scrolls freely.
    const isInTour = isSnapping && now > leavingUntil && scrolled > -12 && scrolled < tourDistance + 12;
    document.documentElement.classList.toggle("has-tour-snap", isInTour);

    const stop = clamp(Math.round(scrolled / stepDistance), 0, stops.length - 1);
    if (position === null) {
      position = stops[stop];            // arriving mid-tour (a reload, a link): start right there
      goalStop = stop;
      moveTo = position;
      moveStart = now - 100000;
    } else if (stop !== goalStop) {
      goalStop = stop;
      moveFrom = position;
      moveTo = stops[stop];
      moveStart = now;
      moveDuration = clamp(Math.abs(moveTo - moveFrom) * TOUR.secondsPerScreen, TOUR.shortestMove, TOUR.longestMove) * 1000;
    }
    if (scrolled < -Site.viewportHeight || scrolled > tourDistance + Site.viewportHeight) {
      moveStart = now - moveDuration;   // off screen (a link jumped past, or the visitor is elsewhere): no need to play it
    }
    const t = clamp((now - moveStart) / moveDuration, 0, 1);
    position = moveFrom + (moveTo - moveFrom) * easeInOut(t);
    if (t >= 1) {
      position = moveTo;
    }
    const state = tourStateAt(position);

    // Camera: the map is drawn so the focus point sits at the middle of the map area, scaled by the zoom.
    const scale = fitScale * state.zoom;
    const centerX = drawingLeft + MAP_CENTER.x * fitScale;
    const centerY = drawingTop + MAP_CENTER.y * fitScale;
    const viewLeft = state.focus.x - centerX / scale;
    const viewTop = state.focus.y - centerY / scale;
    const camera = viewLeft.toFixed(2) + " " + viewTop.toFixed(2) + " " + (areaWidth / scale).toFixed(2) + " " + (areaHeight / scale).toFixed(2);
    if (camera !== lastCamera) {
      mapDrawing.setAttribute("viewBox", camera);
      pins.forEach((pin) => {
        const x = (pin.x - viewLeft) * scale;
        const y = (pin.y - viewTop) * scale;
        pin.screenX = x;
        pin.screenY = y + areaTop;
        pin.element.style.transform = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px)";
      });
      lastCamera = camera;
    }

    if (state.pin !== lastPin) {
      pins.forEach((pin) => pin.element.classList.toggle("is-current", pin === state.pin));
      lastPin = state.pin;
    }

    // The open photo grows out of its pin: at openAmount 0 it sits shrunk on the pin, at 1 it fills its open box.
    if (state.photo !== lastPhoto) {
      photos.forEach((photo) => photo.element.classList.toggle("is-active", photo === state.photo));
      if (lastPhoto) {
        lastPhoto.element.classList.remove("is-open");
        lastPhoto.element.style.opacity = "0";
      }
      lastPhoto = state.photo;
    }
    const openAmount = state.photo ? state.openAmount : 0;
    if (state.photo) {
      const photo = state.photo;
      const box = photo.openBox;
      const shrunk = TOUR.smallestPhoto;
      const size = shrunk + (1 - shrunk) * openAmount;
      const offsetX = (photo.pin.screenX - (box.left + box.width / 2)) * (1 - openAmount);
      const offsetY = (photo.pin.screenY - (box.top + box.height / 2)) * (1 - openAmount);
      photo.element.style.transform = "translate(" + offsetX.toFixed(1) + "px, " + offsetY.toFixed(1) + "px) scale(" + size.toFixed(4) + ")";
      photo.element.style.opacity = clamp(openAmount * 4, 0, 1).toFixed(3);
      photo.element.classList.toggle("is-open", openAmount > 0.995);
    }
    mapArea.style.opacity = (1 - 0.88 * openAmount).toFixed(3);   // fade the map (and the other pins' labels) behind an open photo

    const progress = Math.round(position / totalLength * 1000) / 1000;
    if (progress !== lastProgress) {
      progressFill.style.transform = "scaleX(" + progress + ")";
      lastProgress = progress;
    }
  }

  /* ---------- Wheels and keys: one gesture, one stop ----------
     So inside the tour, a wheel gesture and the arrow, Page Up/Down, and space keys move exactly one stop, or one move into or out of the
     tour at its ends. */
  const WHEEL = {
    quiet: 180,        // ms without wheel events that ends a gesture
    notchGap: 150,     // ms: the quickest one mouse notch after another still counts as its own step
    flickGap: 260,     // ms: the soonest after a step a trackpad surge can count as a new flick
    surge: 1.5,        // a new flick: the wheel speeds up to at least this many times the last event...
    surgeMinimum: 14   // Min pixels traversed.
  };
  let wheelGestureEnds = 0;
  let wheelStepped = false;
  let lastStepTime = -Infinity;
  let lastWheelSize = 0;
  let lastWheelDirection = 0;

  // The stop the page is gliding to after a step, while it's still on its way.
  let headingTo = null;
  let headingUntil = 0;

  // The next stop in a direction: one stop on from where the page rests (or is already heading), or, when it's
  // between stops (arriving from outside the tour), the first stop it reaches.
  function nextStop(direction) {
    if (headingTo !== null && performance.now() < headingUntil) {
      return headingTo + direction;
    }
    const at = (window.scrollY - sectionTop) / stepDistance;
    if (Math.abs(at - Math.round(at)) < 0.03) {
      return Math.round(at) + direction;
    }
    return direction > 0 ? Math.ceil(at) : Math.floor(at);
  }

  function isTourOnScreen() {
    const scrolled = window.scrollY - sectionTop;
    return isSnapping && scrolled > -12 && scrolled < tourDistance + 12;
  }

  // Where one gesture in a direction (1 or -1) takes the page, in pixels from the tour's top, or null when it isn't the
  // tour's section. 
  function gestureTarget(direction) {
    const scrolled = window.scrollY - sectionTop;
    if (direction > 0 && scrolled < -12 && scrolled >= -stepDistance) {
      return 0;
    }
    if (direction < 0 && scrolled > tourDistance + 12 && scrolled <= tourDistance + stepDistance) {
      return tourDistance;
    }
    if (!isTourOnScreen()) {
      return null;
    }
    const next = nextStop(direction);
    if (next < 0 || next > stops.length - 1) {
      leavingUntil = performance.now() + 900;   // snapping stays off while the page scrolls out
      document.documentElement.classList.remove("has-tour-snap");
      return next < 0 ? -Site.viewportHeight : tourDistance + Site.viewportHeight;
    }
    return next * stepDistance;
  }

  function moveForGesture(direction) {
    const target = gestureTarget(direction);
    if (target === null) {
      return false;
    }
    const isStop = target >= 0 && target <= tourDistance;
    headingTo = isStop ? Math.round(target / stepDistance) : null;
    headingUntil = performance.now() + 700;
    window.scrollTo({ top: sectionTop + target, behavior: "smooth" });
    return true;
  }

  // A mouse notch: whole lines (Firefox) or whole notches of 120 (Chrome, Edge, Safari); a trackpad sends any size.
  function isMouseNotch(event) {
    return event.deltaMode === 1 || (event.wheelDeltaY !== undefined && event.wheelDeltaY !== 0 && event.wheelDeltaY % 120 === 0);
  }

  window.addEventListener("wheel", (event) => {
    if (event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
      return;   // pinch zoom or sideways
    }
    const now = performance.now();
    const size = Math.abs(event.deltaY) * (event.deltaMode === 1 ? 16 : 1);
    const direction = Math.sign(event.deltaY);
    const sinceStep = now - lastStepTime;
    const isNewGesture = now > wheelGestureEnds
      || (isMouseNotch(event) && sinceStep > WHEEL.notchGap)
      || (direction !== lastWheelDirection && sinceStep > WHEEL.notchGap)
      || (size > lastWheelSize * WHEEL.surge && size >= WHEEL.surgeMinimum && sinceStep > WHEEL.flickGap);
    wheelGestureEnds = now + WHEEL.quiet;
    lastWheelSize = size;
    lastWheelDirection = direction;
    if (!isNewGesture && wheelStepped) {
      event.preventDefault();   // the rest of a gesture that already moved (trackpad momentum)
      return;
    }
    wheelStepped = moveForGesture(direction);
    if (wheelStepped) {
      lastStepTime = now;
      event.preventDefault();
    }
  }, { passive: false });

  const STEP_KEYS = { ArrowDown: 1, PageDown: 1, " ": 1, ArrowUp: -1, PageUp: -1 };
  window.addEventListener("keydown", (event) => {
    const direction = STEP_KEYS[event.key];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.target.closest && event.target.closest("input, textarea, select, button, a, [contenteditable]")) {
      return;   // keys meant for a control
    }
    if (moveForGesture(event.key === " " && event.shiftKey ? -1 : direction)) {
      event.preventDefault();
    }
  });

  // For testing: the scroll position (in pixels) of a photo's stop; whether the playback has reached its stop; and a
  // switch for snapping.
  Site.fieldPhotos = {
    photoCount: photos.length,
    scrollPositionForPhoto(index) {
      return Math.round(sectionTop + (index + 1) * stepDistance);
    },
    isAtStop() {
      return position === moveTo;
    },
    setSnapping(isOn) {
      isSnapping = isOn;
    }
  };

  // After scroll pauses (order 20), before anything that reads positions further down the page.
  Site.onMeasure(measureTour, 30);
  Site.onFrame(updateTour);
})(window.Site);
