/*
 * field-photos.js
 * "Field photos": a map of the United States with a pin where each photo was taken.
 * Scrolling down flies the map to each place, grows each photo out of its pin, shows the caption once the photo
 * is fully open, then shrinks it back into the pin before moving on. Only ordinary vertical scrolling drives it.
 * With reduced motion the map and photos are simply shown one after the other from field-photos.css.
 */
(function (Site) {
  "use strict";
  const { clamp } = Site;

  /* ---------- Settings you can tweak ---------- */

  // Lengths are in screen heights of scrolling.
  const TOUR = {
    introLength: 0.3,       // the whole map, before flying to the first place
    flyLength: 0.5,         // flying from one place to another
    openLength: 0.28,       // a photo growing out of its pin
    holdLength: 0.3,        // the photo fully open, with its caption
    closeLength: 0.22,      // the photo shrinking back into its pin
    outroLength: 0.35,      // zooming back out to the whole map at the end
    zoom: 2.2,              // how far the map zooms in on a place (1 = the whole map)
    zoomPhone: 2.8,         // the same on screens narrower than 760 px
    smallestPhoto: 0.05     // photo size when it sits inside its pin, as a fraction of its open size
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

  /* ---------- Measuring ---------- */

  let sectionTop = 0;
  let tourDistance = 1;     // pixels of scrolling the whole tour takes
  let areaWidth = 1;
  let areaHeight = 1;
  let areaTop = 0;          // the map area's position inside the stage
  let fitScale = 1;         // screen pixels per map unit at zoom 1
  let drawingLeft = 0;      // where the whole map sits at zoom 1, inside the map area
  let drawingTop = 0;
  let zoomIn = TOUR.zoom;

  function measureTour() {
    const screenHeight = Site.viewportHeight;
    tourDistance = totalLength * screenHeight;
    section.style.height = (tourDistance + screenHeight) + "px";
    sectionTop = Site.documentTop(section);

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

  function updateTour() {
    const distance = clamp(Site.scrollY - sectionTop, 0, tourDistance);
    const state = tourStateAt(distance / Site.viewportHeight);

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

    const progress = Math.round(distance / tourDistance * 1000) / 1000;
    if (progress !== lastProgress) {
      progressFill.style.transform = "scaleX(" + progress + ")";
      lastProgress = progress;
    }
  }

  /* ---------- Settling onto a photo ---------- */

  // When scrolling comes to rest while a photo is partly open (still growing or already shrinking), the page
  // glides onto it fully open, caption showing. When no photo is showing (the whole map, or flying between
  // places), nothing pulls. Waits this long after the last scroll movement, so momentum finishes first.
  const SETTLE_DELAY = 160;
  let settleTimer = 0;
  let isSnapping = true;

  function settleOntoOpenPhoto() {
    const distance = window.scrollY - sectionTop;
    if (!isSnapping || distance < 0 || distance > tourDistance) {
      return;
    }
    const state = tourStateAt(distance / Site.viewportHeight);
    if (!state.photo || state.openAmount <= 0.001 || state.openAmount >= 0.999) {
      return;   // no photo showing, or it's already fully open
    }
    const goal = Math.round(sectionTop + openScreensFor(state.index) * Site.viewportHeight);
    if (Math.abs(goal - window.scrollY) > 1) {
      window.scrollTo({ top: goal, behavior: "smooth" });
    }
  }

  window.addEventListener("scroll", () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleOntoOpenPhoto, SETTLE_DELAY);
  }, { passive: true });

  // For testing: the scroll position (in pixels) where a photo is fully open, halfway through its hold; and a
  // switch for settling, so a test can look at a photo mid-growth.
  Site.fieldPhotos = {
    photoCount: photos.length,
    scrollPositionForPhoto(index) {
      return Math.round(sectionTop + openScreensFor(index) * Site.viewportHeight);
    },
    setSnapping(isOn) {
      isSnapping = isOn;
    }
  };

  // After scroll pauses (order 20), before anything that reads positions further down the page.
  Site.onMeasure(measureTour, 30);
  Site.onFrame(updateTour);
})(window.Site);
