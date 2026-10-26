/*
 * build-photo.js
 * "My current build": the photo that grows from a framed window to full screen as you scroll,
 * then the clickable part points on the PC.
 *
 * How long the section stays pinned is set in css/build-photo.css (the .build-photo height).
 */
(function (Site) {
  "use strict";
  const { clamp, easeOut } = Site;

  /* ---------- Settings you can tweak ---------- */

  const ZOOM = {
    finishAt: 0.5,         // fraction of the pinned scroll where the photo reaches full screen
    pointsAt: 0.55,        // fraction where the part points fade in (keep just above finishAt)
    startWidth: 0.82,      // starting frame width, as a fraction of the screen
    startWidthPhone: 0.9,  // same, on screens narrower than 760 px
    startHeight: 0.76,     // starting frame height
    startZoom: 1.2         // starting photo zoom (1.2 = 120%), settling to 100%
  };

  // The photo's pixel size and the point to keep centered when it's cropped to fit the screen.
  const PHOTO = { width: 2200, height: 1650, focusX: 0.47, focusY: 0.57 };

  const CARD_EDGE_MARGIN = 12;   // minimum gap, in pixels, between a part card and the edge of the screen

  /* ---------- Elements ---------- */

  const buildPhoto = document.querySelector(".build-photo");
  const stage = buildPhoto.querySelector(".stage");
  const frame = buildPhoto.querySelector(".frame");   // the window that grows
  const cover = buildPhoto.querySelector(".cover");   // the photo and part points inside it
  const hotspots = Array.from(buildPhoto.querySelectorAll(".hotspot"));

  let buildPhotoTop = 0;
  let pinnedDistance = 1;   // how far the page scrolls while the photo stays pinned
  let lastFrameTransform = "";
  let lastCoverTransform = "";
  let wasFullScreen = false;
  let wasExpanded = false;

  /* ---------- Zoom ---------- */

  // Sizes the photo to cover the screen around its focus point, and flips the cards of points near the right edge.
  function measureBuildPhoto() {
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const fitScale = Math.max(stageWidth / PHOTO.width, stageHeight / PHOTO.height);
    const photoWidth = PHOTO.width * fitScale;
    const photoHeight = PHOTO.height * fitScale;
    const photoLeft = clamp(stageWidth / 2 - PHOTO.focusX * photoWidth, stageWidth - photoWidth, 0);
    const photoTop = clamp(stageHeight / 2 - PHOTO.focusY * photoHeight, stageHeight - photoHeight, 0);

    cover.style.left = photoLeft + "px";
    cover.style.top = photoTop + "px";
    cover.style.width = photoWidth + "px";
    cover.style.height = photoHeight + "px";
    cover.style.transformOrigin = (stageWidth / 2 - photoLeft).toFixed(1) + "px " + (stageHeight / 2 - photoTop).toFixed(1) + "px";
    lastFrameTransform = "";
    lastCoverTransform = "";

    buildPhotoTop = Site.documentTop(buildPhoto);
    pinnedDistance = Math.max(1, buildPhoto.offsetHeight - Site.viewportHeight);

    hotspots.forEach((hotspot) => {
      const hotspotX = photoLeft + parseFloat(hotspot.style.left) / 100 * photoWidth;
      hotspot.classList.toggle("is-flipped", hotspotX > stageWidth * 0.55);
    });
  }

  // Uses transforms only, which the graphics card animates without repainting the photo.
  // The frame scales up while the photo inside scales down by the same amount.
  function updateBuildPhoto() {
    const progress = clamp((Site.scrollY - buildPhotoTop) / pinnedDistance, 0, 1);
    const zoomProgress = easeOut(clamp(progress / ZOOM.finishAt, 0, 1));
    const startFrameWidth = Site.viewportWidth < 760 ? ZOOM.startWidthPhone : ZOOM.startWidth;
    const frameScaleX = 1 - (1 - zoomProgress) * (1 - startFrameWidth);
    const frameScaleY = 1 - (1 - zoomProgress) * (1 - ZOOM.startHeight);
    const photoScale = 1 + (ZOOM.startZoom - 1) * (1 - zoomProgress);

    const frameTransform = "scale(" + frameScaleX.toFixed(4) + "," + frameScaleY.toFixed(4) + ")";
    const coverTransform = "scale(" + (photoScale / frameScaleX).toFixed(4) + "," + (photoScale / frameScaleY).toFixed(4) + ")";
    if (frameTransform !== lastFrameTransform) {
      frame.style.transform = frameTransform;
      lastFrameTransform = frameTransform;
    }
    if (coverTransform !== lastCoverTransform) {
      cover.style.transform = coverTransform;
      lastCoverTransform = coverTransform;
    }

    const isFullScreen = zoomProgress > 0.995;   // square the corners once it fills the screen
    if (isFullScreen !== wasFullScreen) {
      buildPhoto.classList.toggle("is-full-screen", isFullScreen);
      wasFullScreen = isFullScreen;
    }
    const isExpanded = progress > ZOOM.pointsAt;   // show the part points and caption
    if (isExpanded !== wasExpanded) {
      buildPhoto.classList.toggle("is-expanded", isExpanded);
      wasExpanded = isExpanded;
    }
  }

  /* ---------- Part points: hover on desktop, tap on phones ---------- */

  // Keeps a part's card fully on screen by moving below the marker, or above it
  // slides sideways until it fits.
  function placeCard(hotspot) {
    const card = hotspot.querySelector(".hotspot-card");
    const markerBox = hotspot.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    const navHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-height")) || 64;
    const minimumX = Math.max(stageBox.left, 0) + CARD_EDGE_MARGIN;
    const maximumX = Math.min(stageBox.right, window.innerWidth) - CARD_EDGE_MARGIN;
    const minimumY = Math.max(stageBox.top, 0) + navHeight + CARD_EDGE_MARGIN;
    let maximumY = Math.min(stageBox.bottom, window.innerHeight) - CARD_EDGE_MARGIN;

    // Stay above the "My current build" caption
    const caption = buildPhoto.querySelector(".frame-caption");
    if (caption) {
      maximumY = Math.min(maximumY, caption.getBoundingClientRect().top - CARD_EDGE_MARGIN);
    }
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;

    // Where the card lands with no adjustment.
    const naturalLeft = markerBox.left + card.offsetLeft;
    const naturalTop = markerBox.top + card.offsetTop - cardHeight / 2;
    let newLeft = naturalLeft;
    let newTop = naturalTop;

    if (naturalLeft < minimumX || naturalLeft + cardWidth > maximumX) {
      const markerCenterX = markerBox.left + markerBox.width / 2;
      newLeft = clamp(markerCenterX - cardWidth / 2, minimumX, Math.max(minimumX, maximumX - cardWidth));
      newTop = markerBox.bottom + 6;
      if (newTop + cardHeight > maximumY) {
        newTop = markerBox.top - 6 - cardHeight;
      }
    }
    newTop = clamp(newTop, minimumY, Math.max(minimumY, maximumY - cardHeight));
    hotspot.style.setProperty("--card-shift-x", (newLeft - naturalLeft).toFixed(1) + "px");
    hotspot.style.setProperty("--card-shift-y", (newTop - naturalTop).toFixed(1) + "px");
  }

  function closeHotspots(exceptHotspot) {
    hotspots.forEach((hotspot) => {
      if (hotspot === exceptHotspot) {
        return;
      }
      hotspot.classList.remove("is-open");
      hotspot.querySelector(".hotspot-button").setAttribute("aria-expanded", "false");
    });
  }

  hotspots.forEach((hotspot) => {
    const button = hotspot.querySelector(".hotspot-button");
    button.addEventListener("click", () => {
      const shouldOpen = !hotspot.classList.contains("is-open");
      closeHotspots(hotspot);
      if (shouldOpen) {
        placeCard(hotspot);
      }
      hotspot.classList.toggle("is-open", shouldOpen);
      button.setAttribute("aria-expanded", String(shouldOpen));
    });
    hotspot.addEventListener("pointerenter", () => { placeCard(hotspot); });
    hotspot.addEventListener("focusin", () => { placeCard(hotspot); });
  });

  window.addEventListener("resize", () => {
    hotspots.forEach((hotspot) => {
      if (hotspot.classList.contains("is-open")) {
        placeCard(hotspot);
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest || !event.target.closest(".hotspot")) {
      closeHotspots(null);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeHotspots(null);
    }
  });

  Site.onMeasure(measureBuildPhoto);
  if (Site.motionEnabled) {
    Site.onFrame(updateBuildPhoto);
  }
})(window.Site);
