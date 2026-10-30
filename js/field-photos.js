/*
 * field-photos.js
 * "Field photos": a map of the United States with a pin where each photo was taken.
 *
 * The camera is tied to scrolling. Scrolling down zooms the map onto each place in turn (in the order of the photos
 * in index.html) and that place's photos grow out of its pin together, then shrink back as the map flies on, and at
 * the end the map zooms back out to the whole country. A place with several photos (Boulder) opens them all at
 * once, so the map zooms in three times rather than six.
 *
 * Moving through it. The whole map, each place, and the whole map again are "moments".
 *   Inside: a finger drags the camera directly. On release it glides on to the next moment (a flick) or settles on
 *     the nearer one (a slow drag); never more than one moment per gesture. The browser doesn't scroll the page
 *     under a finger here (touch-action in css/field-photos.css), so nothing else moves while the map is held.
 *   Leaving: one more pull past either end carries the page out to the next scroll pause (below the map, the
 *     On the clock / Off the clock panels, held full screen).
 *   A wheel gesture or a key press moves one moment.
 *   Scrolling into the section is left to the browser (no entry fling catch).
 * With reduced motion the map and photos are simply shown one after the other.
 */
(function (Site) {
  "use strict";
  const { clamp } = Site;

  /* ---------- Settings you can tweak ---------- */

  // The timeline, in screen heights.
  const TOUR = {
    overviewHold: 0.35,     // the whole map, before the first flight and after the last
    flyShortest: 0.5,       // flying between places: a short hop...
    flyLongest: 1.0,        // ...up to this across the country
    openLength: 0.35,       // photos growing out of their pin
    openStagger: 0.12,      // in a group, each further photo starts this share of the opening later
    holdLength: 0.5,        // photos fully open, with captions
    closeLength: 0.3,       // photos shrinking back into the pin
    zoom: 1.7,              // how far the map zooms in on a place (1 = the whole country)
    zoomPhone: 2.1,         // the same on screens narrower than 760 px
    smallestPhoto: 0.05     // photo size inside its pin, as a fraction of its open size
  };

  // How moving through it feels.
  const FEEL = {
    dragGain: 1.8,          // a finger moves the timeline this many times its own distance
    flick: 0.3,             // px per ms: a release at least this fast goes on to the next moment
    advanceShare: 0.3,      // a slow drag that covers this share of the way to the next moment goes on to it
    exitDrag: 0.1,          // screens of timeline pulled past either end that count as leaving
    shortestGlide: 300,     // ms
    longestGlide: 750,      // ms, from moment to moment
    longestCarry: 1100,     // ms, carrying the page into or out of the tour
    wheelBand: 0.6,         // screens before either end where a wheel gesture or key heading in glides onto it
    settleDelay: 160        // ms of stillness before the page settles onto the nearest moment
  };

  const MAP_WIDTH = 1000;   // the map drawing's grid (its svg viewBox)
  const MAP_HEIGHT = 627;
  const MAP_CENTER = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };

  // Reduced motion only: on screens at least minimumWidth wide the photos stay in one row with the tallest.
  const STILL = { minimumWidth: 760, tallestShare: 0.36 };

  const root = document.documentElement;
  const section = document.querySelector(".field-photos");
  const stage = section.querySelector(".field-map-stage");
  const mapArea = section.querySelector(".field-map");
  const mapDrawing = section.querySelector(".usa-map");
  const photoList = section.querySelector(".field-photo-list");
  const progressFill = section.querySelector(".field-photos-progress-fill");
  const pins = Array.from(section.querySelectorAll(".map-pin")).map((element) => ({
    element,
    place: element.getAttribute("data-place"),
    x: parseFloat(element.style.getPropertyValue("--x")),
    y: parseFloat(element.style.getPropertyValue("--y")),
    screenX: 0,
    screenY: 0
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
      openBox: { left: 0, top: 0, width: 1, height: 1 },
      shown: -1
    };
  }).filter((photo) => photo.pin);

  if (!Site.motionEnabled || photos.length === 0) {
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

  /* ---------- Places: the photos of one pin, opened together ---------- */

  const places = [];
  photos.forEach((photo) => {
    const last = places[places.length - 1];
    if (last && last.pin === photo.pin) {
      last.photos.push(photo);
    } else {
      places.push({ pin: photo.pin, photos: [photo], caption: null });
    }
  });

  // A group says its place and year once, under the photos; each photo keeps its title.
  places.forEach((place) => {
    if (place.photos.length < 2) {
      return;
    }
    place.photos.forEach((photo) => photo.element.classList.add("is-grouped"));
    const placeName = place.photos[0].element.querySelector("figcaption span");
    const caption = document.createElement("p");
    caption.className = "field-group-caption";
    caption.setAttribute("aria-hidden", "true");   // each photo's own caption still names the place for screen readers
    caption.textContent = placeName ? placeName.textContent : "";
    photoList.appendChild(caption);
    place.caption = caption;
  });

  /* ---------- The timeline ---------- */

  function distanceBetween(first, second) {
    const a = first || MAP_CENTER;
    const b = second || MAP_CENTER;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // Short hops fly quickly; flights across the country take longer.
  function flyLength(from, to) {
    const share = clamp(distanceBetween(from, to) / 650, 0, 1);
    return TOUR.flyShortest + (TOUR.flyLongest - TOUR.flyShortest) * share;
  }

  const steps = [];
  const moments = [0];      // timeline positions (in screens) where the tour comes to rest
  let totalLength = 0;

  function addStep(step) {
    step.start = totalLength;
    steps.push(step);
    totalLength += step.length;
  }

  addStep({ kind: "hold", length: TOUR.overviewHold });
  let flyingFrom = null;    // null: the whole map
  places.forEach((place) => {
    addStep({ kind: "fly", length: flyLength(flyingFrom, place.pin), from: flyingFrom, to: place.pin });
    addStep({ kind: "open", length: TOUR.openLength * (1 + TOUR.openStagger * (place.photos.length - 1)), place });
    addStep({ kind: "open-hold", length: TOUR.holdLength, place });
    moments.push(totalLength - TOUR.holdLength / 2);
    addStep({ kind: "close", length: TOUR.closeLength, place });
    flyingFrom = place.pin;
  });
  addStep({ kind: "fly", length: flyLength(flyingFrom, null), from: flyingFrom, to: null });
  addStep({ kind: "hold", length: TOUR.overviewHold });
  moments.push(totalLength);
  const lastMoment = moments.length - 1;

  /* ---------- Measuring ---------- */

  // The large viewport (browser toolbars hidden). The map holds the screen at whichever height the browser shows,
  // so the section is long enough for the largest.
  const largeViewportProbe = document.createElement("div");
  largeViewportProbe.setAttribute("aria-hidden", "true");
  largeViewportProbe.style.cssText = "position:absolute;left:0;top:0;width:1px;height:100vh;height:100lvh;visibility:hidden;pointer-events:none;";
  document.body.appendChild(largeViewportProbe);

  let sectionTop = 0;
  let unit = 1;             // pixels of page per screen of timeline
  let tourDistance = 1;     // pixels of page from the first moment to the last
  let areaWidth = 1;
  let areaHeight = 1;
  let areaTop = 0;          // the map area's position inside the stage
  let fitScale = 1;         // screen pixels per map unit at zoom 1
  let drawingLeft = 0;      // where the whole map sits at zoom 1, inside the map area
  let drawingTop = 0;
  let zoomIn = TOUR.zoom;
  let isPhone = false;

  function measureTour() {
    unit = Site.viewportHeight;
    tourDistance = Math.round(totalLength * unit);
    const largeHeight = Math.max(unit, largeViewportProbe.offsetHeight || 0);
    section.style.height = (tourDistance + largeHeight) + "px";
    sectionTop = Site.documentTop(section);
    layoutStage();
  }

  // Sizes the map and every photo's open position to the stage. Runs again whenever the stage changes size (a phone's
  // toolbars sliding in or out change its height), without remeasuring the page.
  function layoutStage() {
    areaWidth = mapArea.clientWidth;
    areaHeight = mapArea.clientHeight;
    areaTop = mapArea.offsetTop;
    isPhone = Site.viewportWidth < 760;
    zoomIn = isPhone ? TOUR.zoomPhone : TOUR.zoom;

    // The whole map fits the area with a margin; the bottom margin leaves room for the progress line.
    const margin = isPhone ? 16 : 40;
    fitScale = Math.min((areaWidth - margin * 2) / MAP_WIDTH, (areaHeight - margin * 2 - 24) / MAP_HEIGHT);
    drawingLeft = (areaWidth - MAP_WIDTH * fitScale) / 2;
    drawingTop = (areaHeight - 24 - MAP_HEIGHT * fitScale) / 2;
    mapDrawing.style.width = areaWidth + "px";
    mapDrawing.style.height = areaHeight + "px";

    places.forEach(layoutPlace);
    lastCamera = "";
    lastRendered = NaN;
  }

  // Lays a place's photos out in rows (keeping their order), choosing the split into rows that shows them largest.
  // Captions are measured once the photos have their widths; if one needs more room than allowed, it's laid out again.
  function layoutPlace(place) {
    const firstGuess = place.photos.length > 1 ? (isPhone ? 56 : 44) : 64;
    layoutPlaceWith(place, firstGuess);
    const tallest = Math.max(...place.photos.map((photo) => {
      const caption = photo.element.querySelector("figcaption");
      return caption ? caption.offsetHeight + parseFloat(getComputedStyle(caption).marginTop || 0) : 0;
    }));
    if (tallest + 4 > firstGuess) {
      layoutPlaceWith(place, tallest + 4);
    }
  }

  function layoutPlaceWith(place, captionRoom) {
    const count = place.photos.length;
    const isGroup = count > 1;
    const sideMargin = isPhone ? 16 : 48;
    const gap = isPhone ? 10 : 18;
    const groupCaptionRoom = isGroup ? 28 : 0;
    const width = Math.min(areaWidth - sideMargin * 2, 1180);
    const height = areaHeight - 24 - 8 - groupCaptionRoom;   // the progress line, a little air at the top

    let best = null;
    // Every way to cut the photos into rows, in order: bit i set means a new row starts after photo i.
    for (let cuts = 0; cuts < (1 << (count - 1)); cuts++) {
      const rows = [[place.photos[0]]];
      for (let index = 1; index < count; index++) {
        if (cuts & (1 << (index - 1))) {
          rows.push([]);
        }
        rows[rows.length - 1].push(place.photos[index]);
      }
      // Each row as tall as fills the width; then everything scaled to fit the height.
      const rowHeights = rows.map((row) => (width - gap * (row.length - 1)) / row.reduce((sum, photo) => sum + photo.aspect, 0));
      const fixed = rows.length * captionRoom + (rows.length - 1) * gap;
      let scale = Math.min(1, (height - fixed) / rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0));
      // A single photo is no taller than its share of the screen (its --photo-height in index.html).
      if (!isGroup) {
        scale = Math.min(scale, place.photos[0].heightShare * Site.viewportHeight / rowHeights[0]);
      } else if (!isPhone) {
        scale = Math.min(scale, ...rowHeights.map((rowHeight) => Site.viewportHeight * 0.42 / rowHeight));
      }
      const area = rows.reduce((sum, row, rowIndex) => {
        const rowHeight = rowHeights[rowIndex] * scale;
        return sum + row.reduce((rowSum, photo) => rowSum + rowHeight * rowHeight * photo.aspect, 0);
      }, 0);
      if (!best || area > best.area * 1.001) {
        best = { rows, rowHeights: rowHeights.map((rowHeight) => rowHeight * scale), area };
      }
    }

    const gridHeight = best.rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0)
      + best.rows.length * captionRoom + (best.rows.length - 1) * gap;
    let top = areaTop + 8 + Math.max(0, (height - gridHeight) / 2);
    best.rows.forEach((row, rowIndex) => {
      const rowHeight = best.rowHeights[rowIndex];
      const rowWidth = row.reduce((sum, photo) => sum + rowHeight * photo.aspect, 0) + gap * (row.length - 1);
      let left = (areaWidth - rowWidth) / 2;
      row.forEach((photo) => {
        const box = photo.openBox;
        box.width = rowHeight * photo.aspect;
        box.height = rowHeight;
        box.left = left;
        box.top = top;
        photo.element.style.width = box.width + "px";
        photo.element.style.left = box.left + "px";
        photo.element.style.top = box.top + "px";
        photo.element.style.transformOrigin = "50% " + (box.height / 2) + "px";
        left += box.width + gap;
      });
      top += rowHeight + captionRoom + gap;
    });
    if (place.caption) {
      place.caption.style.top = (top - gap + 2) + "px";
    }
  }

  /* ---------- Where the camera is, for a position on the timeline ---------- */

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // Returns the camera (focus point and zoom), the highlighted pin, and which place's photos are how open (0 to 1,
  // before each photo's own easing).
  function tourStateAt(position) {
    const step = steps.find((candidate) => position < candidate.start + candidate.length) || steps[steps.length - 1];
    const t = clamp((position - step.start) / step.length, 0, 1);
    if (step.kind === "hold") {
      return { focus: MAP_CENTER, zoom: 1, pin: null, place: null, open: 0 };
    }
    if (step.kind === "fly") {
      const e = easeInOut(t);
      const from = step.from || MAP_CENTER;
      const to = step.to || MAP_CENTER;
      const focus = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
      // Zoom evenly (in proportion), and on a long flight between two places pull back toward the whole country.
      const fromZoom = step.from ? zoomIn : 1;
      const toZoom = step.to ? zoomIn : 1;
      let zoom = fromZoom * Math.pow(toZoom / fromZoom, e);
      if (step.from && step.to) {
        const pullBack = (zoomIn - 1) * clamp(distanceBetween(step.from, step.to) / 600, 0, 1) * 0.9;
        zoom = Math.max(1, zoom - pullBack * Math.sin(Math.PI * e));
      }
      return { focus, zoom, pin: e < 0.5 ? step.from : step.to, place: null, open: 0 };
    }
    const place = step.place;
    const open = step.kind === "open" ? t : step.kind === "open-hold" ? 1 : 1 - t;
    return { focus: place.pin, zoom: zoomIn, pin: place.pin, place, open };
  }

  /* ---------- Drawing a frame ---------- */

  let lastCamera = "";
  let lastPin = null;
  let lastPlace = null;
  let lastProgress = -1;
  let lastRendered = NaN;
  let shownStretch = 0;     // past either end: how far the map has eased back, for display

  function render(position, give) {
    if (position === lastRendered && give === shownStretch) {
      return;
    }
    lastRendered = position;
    shownStretch = give;
    const state = tourStateAt(position);

    // Camera: the focus point sits at the middle of the map area, scaled by the zoom (a little less while stretched).
    const zoom = state.zoom * (1 - 0.06 * give);
    const scale = fitScale * zoom;
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

    if (state.place !== lastPlace) {
      if (lastPlace) {
        lastPlace.photos.forEach((photo) => {
          photo.element.classList.remove("is-active", "is-open");
          photo.element.style.opacity = "0";
          photo.shown = -1;
        });
        if (lastPlace.caption) {
          lastPlace.caption.classList.remove("is-open");
        }
      }
      if (state.place) {
        state.place.photos.forEach((photo) => photo.element.classList.add("is-active"));
      }
      lastPlace = state.place;
    }

    // Each photo grows out of the pin: shrunk on the pin at 0, filling its open box at 1. In a group each starts a
    // little after the one before, and they close in reverse.
    let mostOpen = 0;
    if (state.place) {
      const placePhotos = state.place.photos;
      const stagger = placePhotos.length > 1 ? TOUR.openStagger : 0;
      const span = 1 + stagger * (placePhotos.length - 1);
      let allOpen = true;
      placePhotos.forEach((photo, index) => {
        const amount = easeOutCubic(clamp((state.open * span - stagger * index), 0, 1));
        mostOpen = Math.max(mostOpen, amount);
        allOpen = allOpen && amount > 0.995;
        if (Math.abs(amount - photo.shown) < 0.0005) {
          return;
        }
        photo.shown = amount;
        const box = photo.openBox;
        const size = TOUR.smallestPhoto + (1 - TOUR.smallestPhoto) * amount;
        const offsetX = (state.place.pin.screenX - (box.left + box.width / 2)) * (1 - amount);
        const offsetY = (state.place.pin.screenY - (box.top + box.height / 2)) * (1 - amount);
        photo.element.style.transform = "translate(" + offsetX.toFixed(1) + "px, " + offsetY.toFixed(1) + "px) scale(" + size.toFixed(4) + ")";
        photo.element.style.opacity = clamp(amount * 4, 0, 1).toFixed(3);
        photo.element.classList.toggle("is-open", amount > 0.995);
      });
      if (state.place.caption) {
        state.place.caption.classList.toggle("is-open", allOpen);
      }
    }
    mapArea.style.opacity = (1 - 0.85 * mostOpen).toFixed(3);   // the map fades behind open photos...
    section.classList.toggle("is-showing-photos", mostOpen > 0.6);   // ...and its pin labels go (css/field-photos.css)

    const progress = Math.round(clamp(position / totalLength, 0, 1) * 1000) / 1000;
    if (progress !== lastProgress) {
      progressFill.style.transform = "scaleX(" + progress + ")";
      lastProgress = progress;
    }
  }

  /* ---------- Positions ---------- */

  // While a finger (or the glide after it) moves the tour, it sets the timeline position itself; otherwise the
  // position follows the page's scroll position.
  let driven = null;
  let stretch = 0;          // past either end while a finger pulls: how far, in screens (eased for display)
  let isActive = true;      // false turns all gesture handling off (for tests)

  function positionOfPage(scrollY) {
    return (scrollY - sectionTop) / unit;
  }

  function pageOfPosition(position) {
    return sectionTop + clamp(position, 0, totalLength) * unit;
  }

  function isInTour(scrollY) {
    return scrollY >= sectionTop - 2 && scrollY <= sectionTop + tourDistance + 2;
  }

  // The moment a release goes to. direction: +1 or -1 for a flick, 0 for a slow release; from: where the gesture began.
  function chooseMoment(position, from, direction) {
    if (direction !== 0) {
      const ahead = moments.filter((moment) => (moment - position) * direction > 0.01);
      if (ahead.length > 0) {
        return direction > 0 ? ahead[0] : ahead[ahead.length - 1];
      }
      return direction > 0 ? moments[lastMoment] : moments[0];
    }
    let below = moments[0];
    let above = moments[lastMoment];
    moments.forEach((moment) => {
      if (moment <= position + 1e-6) {
        below = moment;
      }
    });
    for (let index = lastMoment; index >= 0; index--) {
      if (moments[index] >= position - 1e-6) {
        above = moments[index];
      }
    }
    if (above - below < 1e-6) {
      return below;
    }
    const share = (position - below) / (above - below);
    if (position >= from) {
      return share >= FEEL.advanceShare ? above : below;
    }
    return share <= 1 - FEEL.advanceShare ? below : above;
  }

  // Where the page goes on leaving: the nearest scroll pause on that side, if it's close (below the map, the
  // On the clock / Off the clock panels); otherwise just past the section.
  function placeOutside(direction) {
    const frames = Object.values(Site.pauseFrames).filter((frame) => frame.active);
    const reach = 2.5 * unit;
    if (direction > 0) {
      const end = sectionTop + tourDistance;
      const next = frames.filter((frame) => frame.pinStart > end && frame.pinStart - end < reach)
        .sort((first, second) => first.pinStart - second.pinStart)[0];
      return next ? next.pinStart : sectionTop + section.offsetHeight;
    }
    const previous = frames.filter((frame) => frame.pinEnd < sectionTop && sectionTop - frame.pinEnd < reach)
      .sort((first, second) => second.pinEnd - first.pinEnd)[0];
    return previous ? previous.pinEnd : sectionTop - unit;
  }

  /* ---------- Glides ----------
     A glide moves a value from where it is to where it's going, starting at the speed it was given and coming to
     rest exactly there, along a curve that never overshoots. Page glides move the page; timeline glides move the
     timeline (and keep the page in step). */
  let glide = null;

  function stopGlide() {
    if (glide) {
      cancelAnimationFrame(glide.frameId);
      glide = null;
    }
  }

  // velocity: units per ms. restDuration: ms, used when there is no speed to start from.
  function startGlide(from, to, velocity, restDuration, longest, write, onDone) {
    stopGlide();
    const distance = to - from;
    if (Math.abs(distance) < 1e-6) {
      write(to);
      if (onDone) {
        onDone();
      }
      return;
    }
    const speed = velocity * Math.sign(distance) > 0 ? Math.abs(velocity) : 0;
    const duration = speed > 0
      ? clamp(2 * Math.abs(distance) / speed, FEEL.shortestGlide, longest)
      : clamp(restDuration, FEEL.shortestGlide, longest);
    const tangent = Math.sign(distance) * Math.min(speed * duration, 3 * Math.abs(distance));
    const startTime = performance.now();
    const current = { frameId: 0 };
    const frame = (now) => {
      if (root.classList.contains("is-jumping")) {
        glide = null;    // a link is jumping the page elsewhere (js/core.js): let it
        driven = null;
        return;
      }
      const t = clamp((now - startTime) / duration, 0, 1);
      const t2 = t * t;
      const t3 = t2 * t;
      write(t >= 1 ? to : (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * tangent + (3 * t2 - 2 * t3) * to);
      if (t < 1) {
        current.frameId = requestAnimationFrame(frame);
        return;
      }
      glide = null;
      if (onDone) {
        onDone();
      }
    };
    current.frameId = requestAnimationFrame(frame);
    glide = current;
  }

  function writePage(scrollY) {
    window.scrollTo({ top: Math.round(scrollY), behavior: "instant" });
  }

  // Keeps the page at the timeline's position. The map is pinned anywhere inside the tour, so this can't be seen; it
  // only keeps the page ready for whatever comes next.
  function keepPageInStep(position) {
    const goal = Math.round(pageOfPosition(position));
    if (Math.abs(window.scrollY - goal) > 1) {
      writePage(goal);
    }
  }

  function glidePage(goal, velocity) {
    driven = null;
    const distance = Math.abs(goal - window.scrollY) / unit;
    startGlide(window.scrollY, goal, velocity, 350 + 300 * distance, FEEL.longestCarry, writePage, null);
  }

  function glideTimeline(goal, velocity) {
    const distance = Math.abs(goal - driven);
    startGlide(driven, goal, velocity, 320 + 160 * distance, FEEL.longestGlide, (position) => {
      driven = position;
      keepPageInStep(position);
    }, null);
  }

  /* ---------- Touch ---------- */

  let touch = null;         // the current one-finger touch

  // The finger's speed over its last 100 ms, in px per ms (positive: finger moving up, page moving down).
  function releaseSpeed(samples, endTime) {
    const recent = samples.filter((sample) => endTime - sample.time <= 100);
    if (recent.length < 2 || endTime - recent[recent.length - 1].time > 60) {
      return 0;   // the finger had stopped before it lifted
    }
    const first = recent[0];
    const last = recent[recent.length - 1];
    return (first.y - last.y) / Math.max(1, last.time - first.time);
  }

  window.addEventListener("touchstart", (event) => {
    if (!isActive || event.touches.length !== 1) {
      touch = null;
      return;
    }
    const finger = event.touches[0];
    const onTour = driven !== null || isInTour(window.scrollY);
    stopGlide();   // a finger catches a glide, wherever it is
    touch = { onTour, startX: finger.clientX, startY: finger.clientY, lastY: finger.clientY, moved: false,
      samples: [{ y: finger.clientY, time: event.timeStamp }], from: 0, pulled: null };
    if (onTour) {
      driven = clamp(driven !== null ? driven : positionOfPage(window.scrollY), 0, totalLength);
      touch.from = driven;
    }
  }, { passive: true });

  window.addEventListener("touchmove", (event) => {
    if (!touch || event.touches.length !== 1) {
      return;
    }
    const finger = event.touches[0];
    touch.lastY = finger.clientY;
    touch.moved = touch.moved || Math.abs(finger.clientY - touch.startY) > 10;
    touch.samples.push({ y: finger.clientY, time: event.timeStamp });
    if (touch.samples.length > 12) {
      touch.samples.shift();
    }
    if (!touch.onTour) {
      return;
    }
    // The finger drives the camera. Past either end the timeline gives a little, as a hint that pulling on leaves.
    const pulled = touch.from + (touch.startY - finger.clientY) * FEEL.dragGain / unit;
    touch.pulled = pulled;
    driven = clamp(pulled, 0, totalLength);
    const beyond = pulled < 0 ? -pulled : Math.max(0, pulled - totalLength);
    stretch = beyond / (beyond + 0.15);
    keepPageInStep(driven);
  }, { passive: true });

  // While the tour holds the screen, a finger never scrolls the page. css/field-photos.css already says so with
  // touch-action; this listener backs it up. It's attached only near the tour, so elsewhere the browser never waits on
  // it before scrolling.
  function holdPage(event) {
    if (touch && touch.onTour && event.cancelable) {
      event.preventDefault();
    }
  }

  function endTouch(event) {
    if (!touch || event.touches.length > 0) {
      if (event.touches.length === 0) {
        touch = null;
      }
      return;
    }
    const ended = touch;
    touch = null;
    stretch = 0;
    const speed = releaseSpeed(ended.samples, event.timeStamp);
    if (ended.onTour) {
      releaseOnTour(ended, speed);
    }
    // Swipes that start outside the section are left to native scroll (no entry fling catch).
  }

  window.addEventListener("touchend", endTouch, { passive: true });
  window.addEventListener("touchcancel", endTouch, { passive: true });

  function releaseOnTour(ended, speed) {
    const direction = Math.abs(speed) >= FEEL.flick ? Math.sign(speed) : 0;
    const pulled = ended.pulled !== null ? ended.pulled : driven;
    const startedAtEnd = Math.abs(ended.from - totalLength) < 0.01;
    const startedAtStart = Math.abs(ended.from) < 0.01;
    // Out past either end: carry the page on to the next place to rest.
    if (pulled > totalLength + FEEL.exitDrag || (direction > 0 && startedAtEnd && ended.moved)) {
      leave(1, Math.max(0, speed));
      return;
    }
    if (pulled < -FEEL.exitDrag || (direction < 0 && startedAtStart && ended.moved)) {
      leave(-1, Math.min(0, speed));
      return;
    }
    if (!ended.moved) {
      // A tap (on a pin, a link, anywhere): if it caught a glide partway, finish settling; otherwise nothing moves.
      const goal = chooseMoment(driven, driven, 0);
      if (Math.abs(goal - driven) * unit < 2) {
        driven = null;
      } else {
        glideTimeline(goal, 0);
      }
      return;
    }
    const goal = chooseMoment(clamp(pulled, 0, totalLength), ended.from, direction);
    glideTimeline(goal, speed * FEEL.dragGain / unit);
  }

  function leave(direction, speed) {
    const edge = direction > 0 ? totalLength : 0;
    driven = null;
    writePage(pageOfPosition(edge));
    glidePage(placeOutside(direction), speed);
  }

  /* ---------- The page scrolling by other means ----------
     When scrolling stops partway between moments (scrollbar, keyboard, screen reader, or residual
     native momentum inside the section) the page settles onto the nearest one. Entry into the
     section is not intercepted — native scroll carries in. */
  let previousScrollY = window.scrollY;
  let scrollDirection = 0;
  let settleTimer = 0;

  window.addEventListener("scroll", () => {
    const scrollY = window.scrollY;
    const wasAt = previousScrollY;
    previousScrollY = scrollY;
    if (scrollY !== wasAt) {
      scrollDirection = Math.sign(scrollY - wasAt);
    }
    if (!isActive || glide || touch || driven !== null || root.classList.contains("is-jumping")) {
      return;
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleOntoMoment, FEEL.settleDelay);
  }, { passive: true });

  let mouseButtonDown = false;
  window.addEventListener("pointerdown", (event) => { mouseButtonDown = event.pointerType === "mouse"; }, { passive: true });
  window.addEventListener("pointerup", () => { mouseButtonDown = false; }, { passive: true });

  function settleOntoMoment() {
    if (!isActive || glide || touch || driven !== null || mouseButtonDown) {
      return;
    }
    const scrollY = window.scrollY;
    if (scrollY <= sectionTop + 2 || scrollY >= sectionTop + tourDistance - 2) {
      return;   // outside the tour, or resting on one of its ends
    }
    const position = positionOfPage(scrollY);
    const goal = chooseMoment(position, position - scrollDirection * 0.001, 0);
    if (Math.abs(pageOfPosition(goal) - scrollY) > 2) {
      glidePage(pageOfPosition(goal), 0);
    }
  }

  /* ---------- Wheels and keys: one gesture, one moment ----------
     A gesture is one mouse notch, or one trackpad flick with its momentum. Momentum only slows, so a surge or a change
     of direction starts a new gesture right away. Within FEEL.wheelBand of either end, a gesture heading in glides
     onto the tour; farther out the page scrolls normally. */
  const WHEEL = {
    quiet: 180,        // ms of no wheel events that ends a gesture
    notchGap: 90,      // ms between mouse notches that each count
    surge: 1.3,        // a new flick: speeding up to this many times the last event...
    surgeMinimum: 10   // ...and at least this many pixels
  };
  let wheelGestureEnds = 0;
  let wheelStepped = false;
  let lastStepTime = -Infinity;
  let lastWheelSize = 0;
  let lastWheelDirection = 0;
  let isSlowing = false;

  // One gesture's move. Returns false when it isn't the tour's to handle.
  function moveOneMoment(direction) {
    if (!isActive) {
      return false;
    }
    if (glide) {
      return true;   // still gliding: this gesture is spent on it
    }
    driven = null;
    const position = positionOfPage(window.scrollY);
    if (position < -0.003) {
      if (direction > 0 && position >= -FEEL.wheelBand) {
        glidePage(sectionTop, 0);
        return true;
      }
      return false;
    }
    if (position > totalLength + 0.003) {
      if (direction < 0 && position <= totalLength + FEEL.wheelBand) {
        glidePage(sectionTop + tourDistance, 0);
        return true;
      }
      return false;
    }
    const next = direction > 0
      ? moments.find((moment) => moment > position + 0.003)
      : moments.slice().reverse().find((moment) => moment < position - 0.003);
    glidePage(next === undefined ? placeOutside(direction) : pageOfPosition(next), 0);
    return true;
  }

  // Mouse notches come in whole lines or multiples of 120; trackpads send any size.
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
    if (size < lastWheelSize) {
      isSlowing = true;
    }
    const isNewGesture = now > wheelGestureEnds
      || (isMouseNotch(event) && sinceStep > WHEEL.notchGap)
      || (direction !== lastWheelDirection && sinceStep > WHEEL.notchGap)
      || (isSlowing && size > lastWheelSize * WHEEL.surge && size >= WHEEL.surgeMinimum);
    if (isNewGesture) {
      isSlowing = false;
    }
    wheelGestureEnds = now + WHEEL.quiet;
    lastWheelSize = size;
    lastWheelDirection = direction;
    if (!isNewGesture && wheelStepped) {
      event.preventDefault();   // momentum from a gesture that already moved
      return;
    }
    wheelStepped = moveOneMoment(direction);
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
    if (moveOneMoment(event.key === " " && event.shiftKey ? -1 : direction)) {
      event.preventDefault();
    }
  });

  /* ---------- Every frame ---------- */

  let isOnTour = false;
  let isHoldingPage = false;

  function updateTour() {
    const scrollY = window.scrollY;

    // The page has caught up with the timeline: hand it back to the page. If the page was moved away some other way
    // (a link, the status bar), let go too.
    if (driven !== null && !touch && !glide) {
      const goal = Math.round(pageOfPosition(driven));
      if (Math.abs(scrollY - goal) <= 2 || (!isInTour(scrollY) && Math.abs(scrollY - goal) > unit)) {
        driven = null;
      } else {
        writePage(goal);
      }
    }

    // While the tour holds the screen the browser leaves fingers to it (touch-action), and near it the backup
    // listener is attached.
    const onTour = isActive && (driven !== null || Boolean(touch && touch.onTour) || isInTour(scrollY));
    if (onTour !== isOnTour) {
      root.classList.toggle("is-on-field-tour", onTour);
      isOnTour = onTour;
    }
    const near = isActive && (onTour || (scrollY > sectionTop - 1.5 * unit && scrollY < sectionTop + tourDistance + 1.5 * unit));
    if (near !== isHoldingPage) {
      if (near) {
        window.addEventListener("touchmove", holdPage, { passive: false });
      } else {
        window.removeEventListener("touchmove", holdPage, { passive: false });
      }
      isHoldingPage = near;
    }

    const position = driven !== null ? driven : clamp(positionOfPage(Site.scrollY), 0, totalLength);
    const shown = shownStretch + (stretch - shownStretch) * 0.35;
    render(position, Math.abs(shown - stretch) < 0.001 ? stretch : shown);
  }

  // For testing.
  Site.fieldPhotos = {
    photoCount: photos.length,
    placeCount: places.length,
    momentCount: moments.length,
    momentPosition(index) {
      return Math.round(pageOfPosition(moments[index]));
    },
    scrollPositionForPhoto(index) {
      const place = places.findIndex((candidate) => candidate.photos.includes(photos[index]));
      return Math.round(pageOfPosition(moments[place + 1]));
    },
    position() {
      return driven !== null ? driven : positionOfPage(window.scrollY);
    },
    nearestMoment() {
      const position = this.position();
      let best = 0;
      moments.forEach((moment, index) => {
        if (Math.abs(moment - position) < Math.abs(moments[best] - position)) {
          best = index;
        }
      });
      return best;
    },
    isAtRest() {
      return !glide && !touch && driven === null;
    },
    setSnapping(isOn) {
      isActive = isOn;
      if (!isOn) {
        stopGlide();
        driven = null;
      }
    }
  };

  if ("ResizeObserver" in window) {
    let lastSize = "";
    new ResizeObserver(() => {
      const size = mapArea.clientWidth + "x" + mapArea.clientHeight;
      if (size !== lastSize) {
        lastSize = size;
        layoutStage();
      }
    }).observe(mapArea);
  }

  // After scroll pauses (order 20), before anything that reads positions further down the page.
  Site.onMeasure(measureTour, 30);
  Site.onFrame(updateTour);
})(window.Site);
